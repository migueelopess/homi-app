import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryPersister } from '@/lib/query-client';

/**
 * Does what force-closing and reopening the app does, without leaving the page:
 *
 *  1. asks the service worker whether a newer build has been deployed
 *  2. throws away the cache persisted in localStorage, so no stale snapshot
 *     can ever be restored from it later
 *  3. refetches everything from the database
 *  4. reloads only if new app code is actually waiting — a reload is the one
 *     thing a data refresh cannot substitute for, since the running JS is
 *     already in memory
 *
 * Returns an async function; it resolves once the data is back, so a
 * pull-to-refresh spinner can wait on it.
 */
export function useFullRefresh() {
  const queryClient = useQueryClient();
  const inFlight = useRef(null);

  return useCallback(() => {
    // Collapse overlapping calls (double pull, or a pull during auto-refresh).
    if (inFlight.current) return inFlight.current;

    const run = async () => {
      let newVersionPending = false;

      if ('serviceWorker' in navigator) {
        try {
          const registration = await navigator.serviceWorker.getRegistration();
          if (registration) {
            await registration.update();
            // sw.js calls skipWaiting(), so a new worker moves through
            // installing → activated on its own; either state means the code
            // on screen is now out of date.
            newVersionPending = !!(registration.installing || registration.waiting);
          }
        } catch {
          // Offline, or no SW — the data refresh below is still worth doing.
        }
      }

      try {
        await queryPersister.removeClient();
      } catch {
        // localStorage unavailable (private mode) — nothing persisted anyway.
      }

      // Mark every cache stale, then wait for the queries actually on screen.
      // Inactive ones refetch when their page is next opened.
      queryClient.invalidateQueries();
      try {
        await queryClient.refetchQueries({ type: 'active' });
      } catch {
        // A failed refetch surfaces through the queries' own error states.
      }

      if (newVersionPending) window.location.reload();
    };

    inFlight.current = run().finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }, [queryClient]);
}
