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
			retry: 1,
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
