import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';

const TABLE_KEYS = {
  tasks: ['tasks'],
  scheduled_tasks: ['scheduledTasks'],
  occasional_tasks: ['occasionalTasks'],
  task_delegations: ['taskDelegations'],
  task_extensions: ['taskExtensions'],
  task_cancellations: ['taskCancellations'],
  payments: ['payments'],
};

/**
 * Keeps the UI in sync with the database by subscribing to Supabase Realtime
 * and invalidating the matching React Query caches on any change.
 *
 * The subscription is treated as unreliable on purpose. A phone that sleeps,
 * switches between wifi and data, or sits in the background loses the
 * websocket, and Realtime does not always recover it — which used to leave the
 * app silently deaf to changes until it was force-closed and reopened. So we
 * rebuild the channel whenever the app comes back to the foreground, whenever
 * the network returns, and whenever the socket reports an error or timeout.
 */
export function useRealtimeSync() {
  const queryClient = useQueryClient();
  const channelRef = useRef(null);
  const retryRef = useRef(null);

  useEffect(() => {
    let disposed = false;

    const teardown = () => {
      if (retryRef.current) {
        clearTimeout(retryRef.current);
        retryRef.current = null;
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };

    const connect = () => {
      if (disposed) return;
      teardown();

      // A fresh channel name each time: reusing one that the server still
      // believes is joined can be silently rejected.
      const channel = supabase.channel(`app-realtime-${Date.now()}`);

      for (const [table, queryKey] of Object.entries(TABLE_KEYS)) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
          queryClient.invalidateQueries({ queryKey });
        });
      }

      channel.subscribe((status) => {
        if (disposed) return;
        if (status === 'SUBSCRIBED') {
          // We may have missed changes while disconnected.
          queryClient.invalidateQueries();
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (retryRef.current) return; // a retry is already pending
          retryRef.current = setTimeout(() => {
            retryRef.current = null;
            connect();
          }, 3000);
        }
      });

      channelRef.current = channel;
    };

    connect();

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      // Cheap and reliable: assume the socket died while we were away.
      connect();
    };
    const onOnline = () => connect();

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      teardown();
    };
  }, [queryClient]);
}
