import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';

// Which caches a change in each table invalidates. The values are key
// PREFIXES: ['taskCancellations'] reaches both ['taskCancellations','all'] and
// ['taskCancellations','byDate',...], which is the only way one writer can
// refresh every reader.
//
// task_reminders was missing here, so a reminder a parent sent never reached
// the child's screen — and the child then registered the task at full value
// instead of half.
const TABLE_KEYS = {
  tasks: [['tasks'], ['pendingTasks']],
  scheduled_tasks: [['scheduledTasks']],
  occasional_tasks: [['occasionalTasks']],
  task_delegations: [['taskDelegations']],
  task_extensions: [['taskExtensions']],
  task_cancellations: [['taskCancellations']],
  task_reminders: [['taskReminders']],
  payments: [['payments']],
};

/**
 * Keeps the UI in sync with the database by subscribing to Supabase Realtime
 * and invalidating the matching React Query caches on any change.
 *
 * The subscription is treated as unreliable on purpose. A phone that sleeps,
 * switches between wifi and data, or sits in the background loses the
 * websocket, and Realtime does not always recover it — which used to leave the
 * app silently deaf to changes until it was force-closed and reopened. So the
 * channel is rebuilt whenever the socket reports an error or timeout, and
 * whenever the app returns to the foreground or the network comes back *and*
 * the channel is genuinely down.
 */
export function useRealtimeSync() {
  const queryClient = useQueryClient();
  const channelRef = useRef(null);
  const retryRef = useRef(null);
  // The first subscribe happens alongside the initial page load, which has just
  // fetched everything — invalidating there would double every cold start.
  const hasSubscribedRef = useRef(false);
  // 'pending' | 'live' | 'dead'. The channel's own `state` is not enough: it
  // sits at 'closed' while the socket is still opening, which reads exactly
  // like a dead channel and triggered a needless rebuild every single time the
  // phone was unlocked.
  const healthRef = useRef('dead');

  useEffect(() => {
    let disposed = false;

    const teardown = () => {
      healthRef.current = 'dead';
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

      for (const [table, queryKeys] of Object.entries(TABLE_KEYS)) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
          for (const queryKey of queryKeys) queryClient.invalidateQueries({ queryKey });
        });
      }

      healthRef.current = 'pending';

      channel.subscribe((status) => {
        if (disposed) return;
        if (status === 'SUBSCRIBED') {
          healthRef.current = 'live';
          // Only after a *re*connect: we may have missed changes while the
          // socket was down. On the very first connect the pages have just
          // loaded their data anyway.
          if (hasSubscribedRef.current) queryClient.invalidateQueries();
          hasSubscribedRef.current = true;
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          healthRef.current = 'dead';
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

    // Rebuild only when the socket is actually gone. Reconnecting on every
    // return to the foreground meant tearing down a perfectly healthy channel
    // — and, because each fresh subscribe assumes it missed something,
    // refetching every query each time the phone was unlocked.
    const reconnectIfDead = () => {
      if (healthRef.current !== 'dead') return;
      connect();
    };

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      reconnectIfDead();
    };
    const onOnline = () => reconnectIfDead();

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
