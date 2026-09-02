import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { TaskService, TaskCancellationService } from '@/api/entities';
import { INVALIDATE } from '@/lib/queries';
import {
  DELEGATION_CHAMPION_BONUS,
  DELEGATION_BONUS_TASK_NAME,
  BONUS_COMPLETION_TYPE,
  getDelegationStats,
  getDelegationChampions,
  isAwaitingDecision,
  applyCancellations,
  getWeekKey,
  getCurrentMonthKey,
  getLocalDateStr,
} from './taskHelpers';

// Awards the monthly delegation prize once a month is over, persisted as a
// task row (same approach as the weekly bonus) so it flows into earnings,
// payments and the ranking without any special-casing.
//
// Self-healing: the award is recomputed from the data every run, so a
// delegated task that gets rejected after the fact removes a prize that is
// no longer deserved — and grants it to whoever now leads.
export function useMaterializeDelegationChampion({ tasks, delegations, cancellations = [], enabled = true }) {
  const queryClient = useQueryClient();
  const isProcessingRef = useRef(false);

  useEffect(() => {
    if (!enabled || isProcessingRef.current) return;
    if (!Array.isArray(tasks) || !Array.isArray(delegations) || delegations.length === 0) return;

    const currentMonthKey = getCurrentMonthKey();

    const pastMonths = new Set();
    for (const d of delegations) {
      if (d.status !== 'accepted' || !d.task_date) continue;
      const monthKey = String(d.task_date).slice(0, 7);
      if (monthKey < currentMonthKey) pastMonths.add(monthKey);
    }
    if (pastMonths.size === 0) return;

    // The plan is drafted from the cached list, which is capped — good enough
    // to notice that something may need doing, never good enough to award €5
    // on. Anything this pass wants to change is re-decided below against a
    // complete read of the months involved.
    const draft = planChampions(tasks, delegations, cancellations, pastMonths);
    if (draft.toCreate.length === 0 && draft.toDelete.length === 0) return;

    isProcessingRef.current = true;
    (async () => {
      try {
        const months = [...pastMonths].sort();
        const from = `${months[0]}-01`;
        const [lastYear, lastMonth] = months[months.length - 1].split('-').map(Number);
        const to = getLocalDateStr(new Date(lastYear, lastMonth, 0));

        const [fresh, freshCancellations] = await Promise.all([
          TaskService.listByDateRange(from, to),
          TaskCancellationService.list(),
        ]);
        const { toCreate, toDelete } = planChampions(
          applyCancellations(fresh, freshCancellations),
          delegations,
          freshCancellations,
          pastMonths,
        );
        if (toCreate.length === 0 && toDelete.length === 0) return;

        for (const { person, monthKey } of toCreate) {
          const [year, month] = monthKey.split('-').map(Number);
          const endDate = new Date(year, month, 0); // last day of that month
          await TaskService.create({
            person,
            task_name: DELEGATION_BONUS_TASK_NAME,
            completion_type: BONUS_COMPLETION_TYPE,
            value: DELEGATION_CHAMPION_BONUS,
            date: getLocalDateStr(endDate),
            week_key: getWeekKey(endDate),
            month_key: monthKey,
            approval_status: 'approved',
          });
        }
        for (const id of toDelete) {
          await TaskService.delete(id);
        }
        queryClient.invalidateQueries({ queryKey: INVALIDATE.tasks });
      } catch (err) {
        console.error('Failed to materialize delegation champion bonus:', err);
      } finally {
        isProcessingRef.current = false;
      }
    })();
  }, [tasks, delegations, cancellations, enabled, queryClient]);
}

// Who should hold the monthly delegation prize for each of `monthKeys`, and
// which already-awarded rows no longer belong. Pure.
function planChampions(tasks, delegations, cancellations, monthKeys) {
  const toCreate = [];
  const toDelete = [];

  for (const monthKey of monthKeys) {
    const monthDelegations = delegations.filter(
      d => d.status === 'accepted' && String(d.task_date || '').startsWith(monthKey)
    );

    // Hold off while a parent still has to approve one of the delivered
    // tasks — approving or rejecting it can change who won.
    const undecided = monthDelegations.some(d =>
      tasks.some(t =>
        t.person === d.to_person &&
        t.task_name === d.task_name &&
        t.date === d.task_date &&
        isAwaitingDecision(t)
      )
    );
    if (undecided) continue;

    const stats = getDelegationStats(delegations, tasks, { monthKey, cancellations });
    const champions = getDelegationChampions(stats).map(c => c.person);

    const existing = tasks.filter(
      t => t.task_name === DELEGATION_BONUS_TASK_NAME && t.month_key === monthKey
    );

    for (const person of champions) {
      if (!existing.some(t => t.person === person)) toCreate.push({ person, monthKey });
    }
    for (const row of existing) {
      if (!champions.includes(row.person)) toDelete.push(row.id);
    }
  }

  return { toCreate, toDelete };
}
