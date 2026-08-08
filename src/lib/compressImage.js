// Shrinks a camera photo before it ever touches the network.
//
// A phone camera produces 3–8 MB per shot. That is the real reason submitting
// a task used to crawl or die on weak wifi: the payload, not the request. A
// proof-of-chores photo only has to be legible, so 1280px on the long edge at
// JPEG 0.7 is plenty — typically 150–350 KB, i.e. 10–40x less to upload.
//
// Never throws: if anything about the resize fails (odd codec, memory, an
// ancient browser) the original file is returned and the upload still happens.

const MAX_EDGE = 1280;
const QUALITY = 0.7;
// Below this it is already small enough that re-encoding may make it bigger.
const SKIP_BELOW_BYTES = 300 * 1024;

export async function compressImage(file) {
  if (!file || !file.type?.startsWith('image/')) return file;
  if (file.size <= SKIP_BELOW_BYTES) return file;

  try {
    const bitmap = await decode(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY)
    );
    // Re-encoding can backfire on already-optimised images — keep the smaller.
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], replaceExt(file.name), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

// `imageOrientation: 'from-image'` applies the EXIF rotation, so photos taken
// sideways are not stored upside down. Falls back to an <img> decode where
// createImageBitmap is missing or refuses the file.
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // fall through
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function replaceExt(name = 'foto') {
  return `${String(name).replace(/\.[^./\\]+$/, '')}.jpg`;
}
