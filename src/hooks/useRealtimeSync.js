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

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
