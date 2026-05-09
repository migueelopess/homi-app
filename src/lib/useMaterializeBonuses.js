import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { TaskService } from '@/api/entities';
import {
  PEOPLE,
  WEEKLY_BONUS,
  BONUS_TASK_NAME,
  BONUS_COMPLETION_TYPE,
  isBonusTask,
  getCurrentWeekKey,
  getWeekEndDate,
  getLocalDateStr,
} from './taskHelpers';

// Persists weekly bonuses as real task rows once a week ends.
// Self-healing: if a not_done task is later created for a past week,
// any previously-awarded bonus for that (person, week) is removed.
export function useMaterializeBonuses({ tasks, enabled = true }) {
  const queryClient = useQueryClient();
  const isProcessingRef = useRef(false);

  useEffect(() => {
    if (!enabled || isProcessingRef.current) return;
    if (!Array.isArray(tasks) || tasks.length === 0) return;

    const currentWeekKey = getCurrentWeekKey();

    const pastWeeks = new Set();
    for (const t of tasks) {
      if (!isBonusTask(t) && t.week_key && t.week_key < currentWeekKey) {
        pastWeeks.add(t.week_key);
      }
    }
    if (pastWeeks.size === 0) return;

    const toCreate = [];
    const toDelete = [];
    for (const weekKey of pastWeeks) {
      for (const person of PEOPLE) {
        const personWeekTasks = tasks.filter(
          t => t.person === person && t.week_key === weekKey && !isBonusTask(t)
        );
        if (personWeekTasks.length === 0) continue;
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

    if (toCreate.length === 0 && toDelete.length === 0) return;

    isProcessingRef.current = true;
    (async () => {
      try {
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
          });
        }
        for (const id of toDelete) {
          await TaskService.delete(id);
        }
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
      } catch (err) {
        console.error('Failed to materialize weekly bonuses:', err);
      } finally {
        isProcessingRef.current = false;
      }
    })();
  }, [tasks, enabled, queryClient]);
}
