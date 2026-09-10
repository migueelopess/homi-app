import { QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';

// Freshness model: Supabase Realtime (useRealtimeSync) invalidates the caches
// the moment any row changes, and we invalidate everything when the PWA comes
// back to the foreground. That makes an aggressive staleTime safe — pages
// render instantly from cache and refetch in the background, instead of
// showing a spinner on every navigation.
export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: true,
			refetchOnReconnect: true,
			staleTime: 5 * 60 * 1000,
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
