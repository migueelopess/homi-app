import { QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';

// Freshness model: polling, not Realtime.
//
// Supabase Realtime (postgres_changes) was switched off on purpose. On the
// free instance — 426 MB of RAM shared by Postgres, the API, auth and storage —
// it cost a logical-replication decoder, a subscription per table per phone
// checked against RLS on every change, and ~43% of all database time, around
// the clock. The box was living in swap, and the 19:00 rush, when most
// deadlines fall, tipped it into 20-30 second stalls and "database timeout"s.
//
// Instead, whatever is on screen refreshes every minute while the app is
// visible (never in the background), and immediately on returning to the app if
// it is more than 30 s old. Pages still paint instantly from cache.
export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: true,
			refetchOnReconnect: true,
			refetchInterval: 60 * 1000,
			refetchIntervalInBackground: false,
			staleTime: 30 * 1000,
			gcTime: 24 * 60 * 60 * 1000, // keep data around so persistence works
			// Ride out a short backend blip instead of surfacing an error. A 4xx
			// is the app's own fault (bad request, no permission) and will never
			// succeed on a second go; a 5xx, a timeout or a dead socket often
			// will, so those get a few tries with growing gaps.
			retry: (failureCount, error) => {
				const status = error?.status ?? error?.originalError?.status ?? 0;
				if (status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
				return failureCount < 3;
			},
			retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 8000),
		},
	},
});

// Persist the cache to localStorage so a cold start paints real data
// immediately (then revalidates in the background).
export const queryPersister = createSyncStoragePersister({
	storage: window.localStorage,
	key: 'homi_query_cache',
	throttleTime: 2000,
});

// Bump to discard everyone's persisted cache after breaking data-shape changes.
export const QUERY_CACHE_BUSTER = 'v1';
