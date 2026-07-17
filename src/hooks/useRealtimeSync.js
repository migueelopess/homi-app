import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';

/**
 * Subscribes to Supabase Realtime on the main tables and
 * invalidates the matching React Query caches on any change.
 * This keeps the UI in sync across all open clients automatically.
 */
export function useRealtimeSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel('app-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scheduled_tasks' }, () => {
        queryClient.invalidateQueries({ queryKey: ['scheduledTasks'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'occasional_tasks' }, () => {
        queryClient.invalidateQueries({ queryKey: ['occasionalTasks'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_delegations' }, () => {
        queryClient.invalidateQueries({ queryKey: ['taskDelegations'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_extensions' }, () => {
        queryClient.invalidateQueries({ queryKey: ['taskExtensions'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_cancellations' }, () => {
        queryClient.invalidateQueries({ queryKey: ['taskCancellations'] });
      })
      .subscribe();

    // Realtime is paused while the PWA is backgrounded, so changes made in
    // the meantime were never pushed to us. On return to the foreground,
    // mark everything stale — active queries refetch in the background
    // (cached data stays on screen, no spinners).
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        queryClient.invalidateQueries();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
