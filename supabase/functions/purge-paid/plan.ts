// Decides what a payment lets us delete for one child. Pure, so it can be
// tested from `npm test` (Node runs this file directly) as well as used by
// the edge function.
//
// A payment settles every task decided before it, and the parents asked that
// paying be the cleanup: once paid, the rows and their photos can go. What
// must stay is everything that is not settled money, or that something else
// still relies on:
//
//   * undecided tasks (pending / sent back) — they were not in the payment
//   * failures (not_done) — they count towards punishments, not money
//   * rows fulfilling a recent accepted delegation — the overnight check
//     reads them for 30 days and would otherwise call the delegation broken
//     (two failures each); the monthly prize is computed from them too
//   * bonus rows and prizes of any week/month that still has rows — remove one
//     while its week still has work in it and it is handed out again
//
// Kept in step with isTaskPaid / isChore in src/lib/taskHelpers.js.

export const WEEKLY_BONUS_NAME = "Bónus Semanal";

export type TaskRow = {
  id: number;
  person: string;
  task_name: string;
  date: string;
  end_time: string | null;
  week_key: string | null;
  completion_type: string;
  approval_status: string | null;
  approved_at: string | null;
  created_date: string | null;
  delegation_id: string | null;
  scheduled_task_id: number | null;
  occasional_task_id: number | null;
  photo_url: string | null;
};

export type DelegationRow = {
  id: string;
  to_person: string | null;
  status: string;
  task_name: string;
  task_date: string;
  end_time: string | null;
};

export type PurgePlan = {
  chores: TaskRow[];        // paid chores
  adjustments: TaskRow[];   // paid fines / carried balances
  bonuses: TaskRow[];       // paid weekly bonuses / zero blocks of now-empty weeks
};

// Decided, and decided before the last payment. Undecided rows never count.
export function isPaid(row: TaskRow, lastPaidAt: string | null): boolean {
  if (!lastPaidAt) return false;
  if (row.approval_status === "pending" || row.approval_status === "needs_revision") return false;
  if (row.approval_status && row.approval_status !== "approved") return false;
  const decidedAt = row.approved_at || row.created_date;
  return !!decidedAt && new Date(decidedAt) <= new Date(lastPaidAt);
}

function fulfilsRecentDelegation(row: TaskRow, delegations: DelegationRow[], protectFrom: string): boolean {
  return delegations.some((d) =>
    d.status === "accepted" &&
    d.to_person === row.person &&
    d.task_date === row.date &&
    d.task_date >= protectFrom &&
    (row.delegation_id
      ? row.delegation_id === d.id
      // Name + deadline only for rows that carry no identity at all (written
      // before identities existed) — a child's own same-named task at the
      // same hour has its scheduled/occasional id and is not the delegation.
      : !row.scheduled_task_id && !row.occasional_task_id &&
        row.task_name === d.task_name && (row.end_time ?? "") === (d.end_time ?? ""))
  );
}

/**
 * @param rows        every `tasks` row of one child
 * @param delegations accepted delegations to that child
 * @param lastPaidAt  that child's most recent payments.paid_at
 * @param protectFrom earliest delegation date still relied upon ("YYYY-MM-DD")
 */
export function planPurge(rows: TaskRow[], delegations: DelegationRow[], lastPaidAt: string | null, protectFrom: string): PurgePlan {
  if (!lastPaidAt) return { chores: [], adjustments: [], bonuses: [] };

  const chores = rows.filter((r) =>
    !["not_done", "bonus", "adjustment"].includes(r.completion_type) &&
    isPaid(r, lastPaidAt) &&
    !fulfilsRecentDelegation(r, delegations, protectFrom)
  );
  const adjustments = rows.filter((r) => r.completion_type === "adjustment" && isPaid(r, lastPaidAt));

  const gone = new Set([...chores, ...adjustments].map((r) => r.id));
  const remaining = rows.filter((r) => !gone.has(r.id));

  // A weekly bonus (or zero block) may only go once nothing else is left in its
  // week: an empty week is skipped by the bonus logic, a non-empty one would
  // simply get its bonus again.
  const bonuses = rows.filter((r) =>
    r.task_name === WEEKLY_BONUS_NAME &&
    isPaid(r, lastPaidAt) &&
    !remaining.some((o) => o.id !== r.id && o.week_key === r.week_key && o.completion_type !== "bonus")
  );

  return { chores, adjustments, bonuses };
}
