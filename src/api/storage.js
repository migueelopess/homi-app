import { supabase } from './supabaseClient';
import { compressImage } from '@/lib/compressImage';

const BUCKET = 'task-photos';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 25000;
const BACKOFF_MS = [1000, 2500];

/** Thrown when the photo could not be uploaded after every attempt. */
export class UploadError extends Error {
  constructor(message, { retryable = true, cause } = {}) {
    super(message);
    this.name = 'UploadError';
    this.retryable = retryable;
    this.cause = cause;
  }
}

/**
 * Uploads a task photo, built for a house with patchy wifi.
 *
 * - the image is shrunk first, so there is far less to send
 * - each attempt has a hard timeout and is genuinely aborted, instead of
 *   hanging forever behind a spinner with no way out but restarting the app
 * - transient failures (dropped connection, timeout, 5xx, rate limit) are
 *   retried with backoff; permission errors are not, because they never
 *   succeed on a second go
 * - the object path is generated once and reused across attempts, so if an
 *   attempt actually landed before we gave up on it, the retry sees the file
 *   already there and treats that as success rather than uploading twice
 *
 * @param {File|Blob} file
 * @param {(stage: { phase: 'compressing'|'uploading', attempt: number, attempts: number }) => void} [onProgress]
 * @returns {Promise<string>} public URL of the stored photo
 */
export async function uploadTaskPhoto(file, onProgress) {
  onProgress?.({ phase: 'compressing', attempt: 0, attempts: ATTEMPTS });
  const payload = await compressImage(file);

  const ext = payload.type === 'image/jpeg' ? 'jpg' : (guessExt(payload, file) || 'jpg');
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const endpoint = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`;

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || SUPABASE_ANON_KEY;

  let lastError;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    onProgress?.({ phase: 'uploading', attempt, attempts: ATTEMPTS });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_ANON_KEY,
          'Content-Type': payload.type || 'application/octet-stream',
          'x-upsert': 'false',
          'cache-control': '3600',
        },
        body: payload,
        signal: controller.signal,
      });

      if (res.ok) return publicUrl(path);

      // The path is unique to this call, so "already exists" can only mean a
      // previous attempt of ours got through after we stopped waiting.
      if (res.status === 409 && attempt > 1) return publicUrl(path);

      if (!isRetryableStatus(res.status)) {
        throw new UploadError(await describeHttp(res), { retryable: false });
      }
      lastError = new UploadError(await describeHttp(res));
    } catch (err) {
      if (err instanceof UploadError && !err.retryable) throw err;
      lastError = err?.name === 'AbortError'
        ? new UploadError('A ligação está demasiado lenta.', { cause: err })
        : new UploadError('Sem ligação à internet.', { cause: err });
    } finally {
      clearTimeout(timer);
    }

    if (attempt < ATTEMPTS) {
      await sleep(BACKOFF_MS[attempt - 1] ?? 2500);
    }
  }

  throw new UploadError(
    lastError?.message || 'Não foi possível enviar a foto.',
    { retryable: true, cause: lastError }
  );
}

function publicUrl(path) {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

// 408 request timeout, 429 rate limit, 5xx server side — all worth another go.
function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

async function describeHttp(res) {
  let detail = '';
  try {
    const body = await res.text();
    detail = body?.slice(0, 200) || '';
  } catch {
    // body already consumed or unreadable — the status is enough
  }
  if (res.status === 401 || res.status === 403) {
    return 'Sessão expirada. Volta a entrar na app.';
  }
  return `Falha ao enviar a foto (${res.status}). ${detail}`.trim();
}

function guessExt(payload, original) {
  const fromType = payload.type?.split('/')[1];
  if (fromType) return fromType.replace('jpeg', 'jpg');
  const name = original?.name || '';
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
