import { useEffect } from 'react';
import { TaskService, TaskDelegationService, TaskCancellationService, CleanupLogService } from '@/api/entities';
import { sendPushNotification } from '@/api/supabaseClient';
import {
  getWeekKey, getLocalDateStr, sameTaskSlot, countFailures, applyCancellations,
  PENALTIES, isDelegationWaived, BROKEN_DELEGATION_WEIGHT,
} from './taskHelpers';

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

      // --- Broken delegations ------------------------------------------
      // A task taken on from a sibling and then never done. Nobody used to
      // be penalized for this: the delegator is skipped above (they handed
      // it off) and the acceptor was never checked, because the scheduled
      // task still belongs to the delegator. That made "accept, then
      // abandon" the most profitable move in the app. It now costs a
      // double failure.
      const todayStr = getLocalDateStr(today);
      for (const d of delegations) {
        if (d.status !== 'accepted' || d.to_person !== person) continue;
        if (!d.task_date || d.task_date >= todayStr) continue;
        if (lastCleanup && d.task_date <= lastCleanup) continue;
        if (isDelegationWaived(d, cancellations)) continue;

        // Any existing row for this slot means it was either delivered or
        // already marked as missed — nothing to do either way.
        const alreadyRecorded = tasks.some(
          t => t.person === person &&
               t.task_name === d.task_name &&
               t.date === d.task_date &&
               sameTaskSlot(t.end_time, d.end_time)
        );
        if (alreadyRecorded) continue;

        const brokenDate = new Date(d.task_date + 'T00:00:00');
        await TaskService.create({
          person,
          task_name: d.task_name,
          completion_type: 'not_done',
          value: 0,
          date: d.task_date,
          end_time: d.end_time ?? null,
          week_key: getWeekKey(brokenDate),
          month_key: d.task_date.slice(0, 7),
          approval_status: 'approved',
          failure_weight: BROKEN_DELEGATION_WEIGHT,
        });
        createdFailures += BROKEN_DELEGATION_WEIGHT;

        sendPushNotification({
          person: '__parents__',
          title: '🤝 Delegação não cumprida',
          body: `${person} aceitou "${d.task_name}" de ${d.from_person} e não fez (vale 2 falhas)`,
          url: '/pais',
          tag: `broken-delegation-${d.id}`,
        });
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