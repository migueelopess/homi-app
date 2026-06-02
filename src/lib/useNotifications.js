import { useEffect, useRef } from 'react';
import { getLocalDateStr, sameTaskSlot } from './taskHelpers';

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

export function useNotifications({ scheduledTasks, todayTasks, person, occasionalTasks = [] }) {
  const timersRef = useRef([]);

  useEffect(() => {
    if (!person) return;
    if (typeof Notification === 'undefined') return;

    // Don't auto-request permission here — push subscription handles it

    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    const todayKey = getTodayKey();
    const today = getLocalDateStr();

    // Scheduled tasks notifications
    const myScheduledTasks = scheduledTasks.filter(
      (t) => t.person === person && t.days_of_week?.includes(todayKey)
    );

    myScheduledTasks.forEach((task) => {
      if (!task.end_time) return;
      const isDone = todayTasks.some((t) => t.task_name === task.task_name && t.date === today && sameTaskSlot(t.end_time, task.end_time));
      if (isDone) return;

      const [h, m] = task.end_time.split(':').map(Number);

      const reminderTime = new Date();
      reminderTime.setHours(h, m - 15, 0, 0);
      const t1 = scheduleNotification(`⏰ Lembra-te: ${task.task_name}`, `Tens 15 minutos para completar esta tarefa!`, reminderTime.getTime());
      if (t1) timersRef.current.push(t1);

      const deadlineTime = new Date();
      deadlineTime.setHours(h, m, 0, 0);
      const t2 = scheduleNotification(`⚠️ Prazo: ${task.task_name}`, `O prazo para esta tarefa terminou!`, deadlineTime.getTime());
      if (t2) timersRef.current.push(t2);
    });

    // Occasional tasks notifications (today's tasks)
    const myOccasionalToday = occasionalTasks.filter(
      (t) => t.person === person && t.date === today && !t.completed
    );

    myOccasionalToday.forEach((task) => {
      if (!task.end_time) return;
      const [h, m] = task.end_time.split(':').map(Number);

      const reminderTime = new Date();
      reminderTime.setHours(h, m - 15, 0, 0);
      const t1 = scheduleNotification(`⏰ Lembra-te: ${task.task_name}`, `Tens 15 minutos para completar esta tarefa especial!`, reminderTime.getTime());
      if (t1) timersRef.current.push(t1);

      const deadlineTime = new Date();
      deadlineTime.setHours(h, m, 0, 0);
      const t2 = scheduleNotification(`⚠️ Prazo: ${task.task_name}`, `O prazo para esta tarefa especial terminou!`, deadlineTime.getTime());
      if (t2) timersRef.current.push(t2);
    });

    return () => timersRef.current.forEach(clearTimeout);
  }, [scheduledTasks, todayTasks, person, occasionalTasks]);
}

export function getPendingTasks(scheduledTasks, todayTasks, person, occasionalTasks = []) {
  if (!person) return [];
  const todayKey = getTodayKey();
  const today = getLocalDateStr();

  const pendingScheduled = scheduledTasks.filter((task) => {
    if (task.person !== person) return false;
    if (!task.days_of_week?.includes(todayKey)) return false;
    const isDone = todayTasks.some((t) => t.task_name === task.task_name && t.date === today && sameTaskSlot(t.end_time, task.end_time));
    return !isDone;
  });

  const pendingOccasional = occasionalTasks.filter((task) => {
    if (task.person !== person) return false;
    if (task.completed) return false;
    return task.date === today; // only today, not overdue
  });

  return [...pendingScheduled, ...pendingOccasional.map(t => ({ ...t, _occasional: true }))];
}