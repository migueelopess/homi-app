import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { TaskService, TaskCancellationService } from '@/api/entities';
import { INVALIDATE } from '@/lib/queries';
import {
  PEOPLE,
  WEEKLY_BONUS,
  BONUS_TASK_NAME,
  BONUS_COMPLETION_TYPE,
  isBonusTask,
  isAwaitingDecision,
  applyCancellations,
  getCurrentWeekKey,
  getWeekEndDate,
  getWeekStartDate,
  getLocalDateStr,
} from './taskHelpers';

// Only recent history is still actionable; anything older has either been
// awarded already or cleaned away.
const MAX_WEEKS = 8;

// Decides, for each of `weekKeys`, who should hold a weekly bonus and who
// should not. Pure — the same input always yields the same plan.
function planBonuses(tasks, weekKeys) {
  const toCreate = [];
  const toDelete = [];

  for (const weekKey of weekKeys) {
    for (const person of PEOPLE) {
      const personWeekTasks = tasks.filter(
        t => t.person === person && t.week_key === weekKey && !isBonusTask(t)
      );
      if (personWeekTasks.length === 0) continue;
      // Wait for parents to decide on every photo before we materialize.
      if (personWeekTasks.some(isAwaitingDecision)) continue;

      const shouldHaveBonus = personWeekTasks.every(t => t.completion_type !== 'not_done');
      const existingBonus = tasks.find(
        t => t.person === person && t.week_key === weekKey && isBonusTask(t)
      );

      if (shouldHaveBonus && !existingBonus) {
        toCreate.push({ person, weekKey });
      } else if (!shouldHaveBonus && existingBonus) {
        toDelete.push(existingBonus.id);
      }
    }
  }

  return { toCreate, toDelete };
}

// Persists weekly bonuses as real task rows once a week ends.
// Self-healing: if a not_done task is later created for a past week,
// any previously-awarded bonus for that (person, week) is removed.
//
// The cached task list is capped, so a week sitting across that cap looks like
// it contains only completed work — which would award €5 nobody earned. The
// cache is therefore used only to notice that something *might* need doing;
// every actual write is decided again from a complete read of exactly the weeks
// involved.
export function useMaterializeBonuses({ tasks, enabled = true }) {
  const queryClient = useQueryClient();
  const isProcessingRef = useRef(false);

  useEffect(() => {
    if (!enabled || isProcessingRef.current) return;
    if (!Array.isArray(tasks) || tasks.length === 0) return;

    const currentWeekKey = getCurrentWeekKey();

    const pastWeeks = [...new Set(
      tasks
        .filter(t => !isBonusTask(t) && t.week_key && t.week_key < currentWeekKey)
        .map(t => t.week_key)
    )].sort().slice(-MAX_WEEKS);
    if (pastWeeks.length === 0) return;

    // Cheap first pass off the cache: if there is plainly nothing to do, stop
    // here rather than hitting the network on every data change.
    const draft = planBonuses(tasks, pastWeeks);
    if (draft.toCreate.length === 0 && draft.toDelete.length === 0) return;

    isProcessingRef.current = true;
    (async () => {
      try {
        const from = getLocalDateStr(getWeekStartDate(pastWeeks[0]));
        const to = getLocalDateStr(getWeekEndDate(pastWeeks[pastWeeks.length - 1]));
        const [fresh, cancellations] = await Promise.all([
          TaskService.listByDateRange(from, to),
          TaskCancellationService.list(),
        ]);

        // Waived occurrences must not block a bonus, exactly as everywhere else.
        const { toCreate, toDelete } = planBonuses(
          applyCancellations(fresh, cancellations),
          pastWeeks,
        );
        if (toCreate.length === 0 && toDelete.length === 0) return;

        for (const { person, weekKey } of toCreate) {
          const endDate = getWeekEndDate(weekKey);
          await TaskService.create({
            person,
            task_name: BONUS_TASK_NAME,
            completion_type: BONUS_COMPLETION_TYPE,
            value: WEEKLY_BONUS,
            date: getLocalDateStr(endDate),
            week_key: weekKey,
            month_key: `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`,
            approval_status: 'approved',
          });
        }
        for (const id of toDelete) {
          await TaskService.delete(id);
        }
        queryClient.invalidateQueries({ queryKey: INVALIDATE.tasks });
      } catch (err) {
        console.error('Failed to materialize weekly bonuses:', err);
      } finally {
        isProcessingRef.current = false;
      }
    })();
  }, [tasks, enabled, queryClient]);
}
