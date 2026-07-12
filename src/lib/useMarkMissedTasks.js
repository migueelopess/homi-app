import { useEffect } from 'react';
import { TaskService, TaskDelegationService, TaskCancellationService, CleanupLogService } from '@/api/entities';
import { sendPushNotification } from '@/api/supabaseClient';
import { getWeekKey, getCurrentMonthKey, sameTaskSlot, countFailures, applyCancellations, PENALTIES } from './taskHelpers';

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

      // Fetch all cancellations so we (a) don't mark cancelled tasks as missed
      // and (b) exclude them when counting a child's outstanding failures.
      let cancellations = [];
      try {
        cancellations = await TaskCancellationService.list();
      } catch (e) {
        // If table doesn't exist yet, continue without
      }

      // Outstanding failures BEFORE this run — counted exactly like the child's
      // "X/3 falhas" card (not_done, no penalty applied, cancellations excluded).
      const beforeFailures = countFailures(applyCancellations(tasks, cancellations), person);
      let createdFailures = 0;

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

          // Skip tasks cancelled by parents for that date
          const wasCancelled = cancellations.some(
            c => c.person === person &&
                 c.task_name === scheduledTask.task_name &&
                 c.task_date === dateStr &&
                 sameTaskSlot(c.end_time, scheduledTask.end_time)
          );
          if (wasCancelled) continue;

          const alreadyRecorded = tasks.some(
            t => t.person === person && t.task_name === scheduledTask.task_name && t.date === dateStr &&
                 sameTaskSlot(t.end_time, scheduledTask.end_time)
          );

          if (!alreadyRecorded) {
            await TaskService.create({
              person,
              task_name: scheduledTask.task_name,
              completion_type: 'not_done',
              value: 0,
              date: dateStr,
              end_time: scheduledTask.end_time ?? null,
              week_key: getWeekKey(date),
              month_key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
              approval_status: 'approved',
            });
            createdFailures++;

            // Notify parents about missed task (only for yesterday)
            if (daysBack === 1) {
              const [y, mo, d] = dateStr.split('-');
              const dateLabel = daysBack === 1 ? 'ontem' : `${d}-${mo}-${y}`;
              sendPushNotification({
                person: '__parents__',
                title: `❌ Tarefa não feita`,
                body: `${person} não completou: ${scheduledTask.task_name} (${dateLabel})`,
                tag: `missed-${person}-${scheduledTask.task_name}-${scheduledTask.end_time || ''}-${dateStr}`,
              });
            }
          }
        }
      }

      // Alert parents once when the child crosses the 3-failure penalty
      // threshold in this run (2→3). Re-runs create no new failures, so it
      // won't fire again at 4, 5, ... — only after a penalty is applied and
      // 3 fresh failures accrue again.
      if (beforeFailures < 3 && beforeFailures + createdFailures >= 3) {
        sendPushNotification({
          person: '__parents__',
          title: `⚠️ ${person} chegou às 3 falhas`,
          body: `Já podes aplicar o castigo: ${PENALTIES[person] || 'castigo'}`,
          url: '/pais',
          tag: `penalty-threshold-${person}`,
        });
      }
    }

    checkMissed();
  }, [enabled, person, scheduledTasks.length]);
}