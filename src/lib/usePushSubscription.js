import { useEffect, useState, useCallback } from 'react';
import { subscribeToPush, unsubscribeFromPush, getPushSubscriptionState } from '@/api/pushNotifications';

/**
 * Hook to manage Web Push subscription lifecycle.
 * Automatically subscribes when user is authenticated.
 * Provides manual subscribe/unsubscribe and status.
 */
export function usePushSubscription(user) {
  const [pushState, setPushState] = useState({
    supported: false,
    subscribed: false,
    person: null,
    loading: true,
  });

  const userId = user?.id;
  const person = user?.linked_name || user?.full_name;

  // Check current subscription state on mount
  useEffect(() => {
    let cancelled = false;

    async function checkState() {
      const state = await getPushSubscriptionState();
      if (!cancelled) {
        setPushState({ ...state, loading: false });
      }
    }

    checkState();
    return () => { cancelled = true; };
  }, []);

  // Registered for *this* person, not merely registered. A sibling signing in
  // on the same phone leaves the stored row pointing at whoever came before,
  // and they would keep receiving each other's notifications.
  const subscribedForMe = pushState.subscribed && pushState.person === person;

  // Auto-subscribe (or re-point an existing subscription) once the user is known
  useEffect(() => {
    if (!userId || !person || pushState.loading || !pushState.supported) return;
    if (subscribedForMe) return;

    // Only auto-subscribe if notification permission is already granted
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      subscribeToPush(userId, person).then((result) => {
        if (result.success) {
          setPushState((prev) => ({ ...prev, subscribed: true, person }));
        }
      });
    }
  }, [userId, person, pushState.loading, pushState.supported, subscribedForMe]);

  const subscribe = useCallback(async () => {
    if (!userId || !person) {
      console.warn('[usePushSubscription] subscribe called but no user/person', { userId, person });
      return { success: false, reason: 'no-user' };
    }

    setPushState((prev) => ({ ...prev, loading: true }));
    const result = await subscribeToPush(userId, person);
    setPushState((prev) => ({
      ...prev,
      subscribed: result.success,
      person: result.success ? person : prev.person,
      loading: false,
    }));
    return result;
  }, [userId, person]);

  const unsubscribe = useCallback(async () => {
    setPushState((prev) => ({ ...prev, loading: true }));
    await unsubscribeFromPush();
    setPushState((prev) => ({ ...prev, subscribed: false, person: null, loading: false }));
  }, []);

  return {
    pushSupported: pushState.supported,
    pushSubscribed: subscribedForMe,
    pushLoading: pushState.loading,
    subscribe,
    unsubscribe,
  };
}
