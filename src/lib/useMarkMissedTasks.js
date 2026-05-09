import { useEffect } from 'react';
import { TaskService, TaskDelegationService, CleanupLogService } from '@/api/entities';
import { sendPushNotification } from '@/api/supabaseClient';
import { getWeekKey, getCurrentMonthKey } from './taskHelpers';

// Module-level Set — persists across component remounts within the same app session
const _checkedPersons = new Set();

// Checks the last 7 days for scheduled tasks that were never done and registers them as 'not_done'
export function useMarkMissedTasks({ scheduledTasks, tasks, person, enabled }) {
  useEffect(() => {
    if (!enabled || !person || scheduledTasks.length === 0) return;
    if (_checkedPersons.has(person)) return;
    _checkedPersons.add(person);

    const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    async function checkMissed() {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Fetch the last cleanup date from Supabase (shared across all devices)
      let lastCleanup = null;
      try {
        lastCleanup = await CleanupLogService.getLastCleanupDate();
      } catch (e) {
        // If table doesn't exist yet, continue without
      }

      // Fetch all delegations to check if tasks were delegated away
      let delegations = [];
      try {
        delegations = await TaskDelegationService.list();
      } catch (e) {
        // If table doesn't exist yet, continue without
      }

      for (let daysBack = 1; daysBack <= 7; daysBack++) {
        const date = new Date(today);
        date.setDate(today.getDate() - daysBack);
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

        // Skip days that fall before or on the last cleanup date
        if (lastCleanup && dateStr <= lastCleanup) continue;

        const dayKey = DAY_KEYS[date.getDay()];

        const myTasksForDay = scheduledTasks.filter(
          t => t.person === person &&
               t.days_of_week?.includes(dayKey) &&
               // Only count as missed if the scheduled task existed before that day
               (!t.created_date || t.created_date.split('T')[0] <= dateStr)
        );

        for (const scheduledTask of myTasksForDay) {
          // Skip tasks that were delegated away (accepted by someone else)
          const wasDelegated = delegations.some(
            d => d.task_type === 'scheduled' &&
                 d.scheduled_task_id === scheduledTask.id &&
                 d.task_date === dateStr &&
                 d.from_person === person &&
                 d.status === 'accepted'
          );
          if (wasDelegated) continue;

          const alreadyRecorded = tasks.some(
            t => t.person === person && t.task_name === scheduledTask.task_name && t.date === dateStr
          );

          if (!alreadyRecorded) {
            await TaskService.create({
              person,
              task_name: scheduledTask.task_name,
              completion_type: 'not_done',
              value: 0,
              date: dateStr,
              week_key: getWeekKey(date),
              month_key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
              approval_status: 'approved',
            });

            // Notify parents about missed task (only for yesterday)
            if (daysBack === 1) {
              const [y, mo, d] = dateStr.split('-');
              const dateLabel = daysBack === 1 ? 'ontem' : `${d}-${mo}-${y}`;
              sendPushNotification({
                person: '__parents__',
                title: `❌ Tarefa não feita`,
                body: `${person} não completou: ${scheduledTask.task_name} (${dateLabel})`,
                tag: `missed-${person}-${scheduledTask.task_name}-${dateStr}`,
              });
            }
          }
        }
      }
    }

    checkMissed();
  }, [enabled, person, scheduledTasks.length]);
}