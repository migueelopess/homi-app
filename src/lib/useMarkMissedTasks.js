import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { INVALIDATE } from '@/lib/queries';

// Runs at most once per app session; a failed attempt clears it so a later
// mount can retry.
let ranThisSession = false;

/**
 * Asks the server to bring the missed-task check up to date.
 *
 * The rule itself lives in the `mark-missed-tasks` edge function and runs on a
 * schedule, so failures appear for every child whether or not that child opens
 * the app — a parent no longer has to wait for one of them to launch Homi
 * before seeing that they are at three failures.
 *
 * This hook is only an extra nudge, for the case where the app is opened
 * between two scheduled runs. It deliberately holds no copy of the rule: the
 * check decides money and punishment, and having the same logic in two places
 * is how the two versions eventually disagree.
 *
 * Nothing here writes to the database, which also closes off the whole class of
 * bugs where a stale client cache made completed work look undone.
 */
export function useMarkMissedTasks({ enabled }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled || ranThisSession) return;
    ranThisSession = true;

    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('mark-missed-tasks');
        if (error) throw error;
        // Realtime already announces the new rows, but a client whose socket is
        // down would otherwise sit on a stale count.
        if (data?.created > 0) {
          queryClient.invalidateQueries({ queryKey: INVALIDATE.tasks });
        }
      } catch (err) {
        console.error('mark-missed-tasks: could not run the check', err);
        ranThisSession = false;
      }
    })();
  }, [enabled, queryClient]);
}
