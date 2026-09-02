import { useEffect, useRef } from 'react';
import {
  getLocalDateStr, scheduledOccurrence, occasionalOccurrence,
  delegationOccurrence, settlesSlot, isDelegationWaived,
} from './taskHelpers';

function getTodayKey() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
}

function scheduleNotification(title, body, fireAt) {
  const now = Date.now();
  const delay = fireAt - now;
  if (delay <= 0) return null;
  return setTimeout(() => {
    if (Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.ico' });
    }
  }, delay);
}

// Decides which of today's occurrences are still this person's to do.
//
// Two things silence an occurrence, and neither used to be considered here —
// so children were reminded about tasks the parents had waived and about tasks
// a sibling had already taken over:
//   * the parents cancelled it for today
//   * a sibling accepted it as a delegation
// A delegation that is still `pending` stays on the list on purpose: nobody has
// taken it on yet, so it remains this person's responsibility (and would be
// counted as their failure).
function buildTodayList({ scheduledTasks, todayTasks, person, occasionalTasks, delegations, cancellations }) {
  const todayKey = getTodayKey();
  const today = getLocalDateStr();
  const todayDelegations = delegations.filter(d => d.task_date === today);

  // A cancellation is recorded against whoever owned the occurrence, so for a
  // task taken over from a sibling we have to accept a tombstone written
  // against either of them.
  const isCancelled = (occurrence) => cancellations.some(
    c => c.task_date === today && c.person === person && settlesSlot(c, occurrence)
  );

  const handedOver = todayDelegations.filter(
    d => d.from_person === person && d.status === 'accepted'
  );

  // Matched on the occurrence, not on the name: an ad-hoc chore registered from
  // the Registar page must not silence the reminder for a scheduled task, and a
  // child's own task must not silence the one they took over from a sibling.
  const isDone = (occurrence) => todayTasks.some(
    t => t.date === today && settlesSlot(t, occurrence)
  );

  const scheduled = scheduledTasks.filter((task) => {
    if (task.person !== person) return false;
    if (!task.days_of_week?.includes(todayKey)) return false;
    if (handedOver.some(d => d.task_type === 'scheduled' && d.scheduled_task_id === task.id)) return false;
    if (isCancelled(scheduledOccurrence(task))) return false;
    return !isDone(scheduledOccurrence(task));
  });

  const occasional = occasionalTasks.filter((task) => {
    if (task.person !== person) return false;
    if (task.completed) return false;
    if (task.date !== today) return false;
    if (handedOver.some(d => d.task_type === 'occasional' && d.occasional_task_id === task.id)) return false;
    return !isCancelled(occasionalOccurrence(task));
  });

  // Tasks a sibling handed to this person and they accepted — theirs now, so
  // they get the reminders for them.
  const takenOn = todayDelegations
    .filter(d => d.to_person === person && d.status === 'accepted')
    .map((d) => {
      const original = d.task_type === 'scheduled'
        ? scheduledTasks.find(t => t.id === d.scheduled_task_id)
        : occasionalTasks.find(t => t.id === d.occasional_task_id);
      return { ...d, end_time: d.end_time || original?.end_time || null, _delegated: true };
    })
    .filter(d =>
      d.end_time &&
      !isDelegationWaived(d, cancellations) &&
      !isDone(delegationOccurrence(d))
    );

  return { scheduled, occasional, takenOn };
}

export function useNotifications({
  scheduledTasks,
  todayTasks,
  person,
  occasionalTasks = [],
  delegations = [],
  cancellations = [],
}) {
  const timersRef = useRef([]);

  useEffect(() => {
    if (!person) return;
    if (typeof Notification === 'undefined') return;

    // Don't auto-request permission here — push subscription handles it

    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    const { scheduled, occasional, takenOn } = buildTodayList({
      scheduledTasks, todayTasks, person, occasionalTasks, delegations, cancellations,
    });

    const schedulePair = (task, specialCopy, delegatedFrom = null) => {
      if (!task.end_time) return;
      const [h, m] = task.end_time.split(':').map(Number);

      // A task taken on from a sibling gets an earlier heads-up: it is not
      // part of this child's own routine, so it is the easiest to forget —
      // and dropping it costs them double failures.
      if (delegatedFrom) {
        const earlyTime = new Date();
        earlyTime.setHours(h, m - 30, 0, 0);
        const t0 = scheduleNotification(
          `🤝 Aceitaste: ${task.task_name}`,
          `Faltam 30 minutos — ficaste de fazer esta tarefa do ${delegatedFrom}.`,
          earlyTime.getTime()
        );
        if (t0) timersRef.current.push(t0);
      }

      const reminderTime = new Date();
      reminderTime.setHours(h, m - 15, 0, 0);
      const t1 = scheduleNotification(
        `⏰ Lembra-te: ${task.task_name}`,
        `Tens 15 minutos para completar esta tarefa${specialCopy ? ' especial' : ''}!`,
        reminderTime.getTime()
      );
      if (t1) timersRef.current.push(t1);

      const deadlineTime = new Date();
      deadlineTime.setHours(h, m, 0, 0);
      const t2 = scheduleNotification(
        `⚠️ Prazo: ${task.task_name}`,
        `O prazo para esta tarefa${specialCopy ? ' especial' : ''} terminou!`,
        deadlineTime.getTime()
      );
      if (t2) timersRef.current.push(t2);
    };

    scheduled.forEach((task) => schedulePair(task, false));
    occasional.forEach((task) => schedulePair(task, true));
    takenOn.forEach((task) => schedulePair(task, task.task_type === 'occasional', task.from_person));

    return () => timersRef.current.forEach(clearTimeout);
  }, [scheduledTasks, todayTasks, person, occasionalTasks, delegations, cancellations]);
}

export function getPendingTasks(
  scheduledTasks,
  todayTasks,
  person,
  occasionalTasks = [],
  delegations = [],
  cancellations = []
) {
  if (!person) return [];
  const { scheduled, occasional, takenOn } = buildTodayList({
    scheduledTasks, todayTasks, person, occasionalTasks, delegations, cancellations,
  });
  return [
    ...scheduled,
    ...occasional.map(t => ({ ...t, _occasional: true })),
    ...takenOn.map(t => ({ ...t, _occasional: t.task_type === 'occasional' })),
  ];
}
