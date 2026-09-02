export const PEOPLE = ['Inês', 'Pedro', 'Miguel'];

export const COMPLETION_TYPES = {
  on_time_no_reminder: { label: 'A tempo + Sem lembrete', value: 1.00, emoji: '🌟', color: 'text-primary' },
  on_time_with_reminder: { label: 'A tempo (com 1 lembrete)', value: 0.50, emoji: '⏰', color: 'text-accent' },
  late: { label: 'Feita com atraso', value: 0.25, emoji: '⚠️', color: 'text-destructive' },
  not_done: { label: 'Não feita', value: 0, emoji: '❌', color: 'text-destructive' },
  // Display-only state for an occurrence the parents waived (cancelled). It is
  // never written to the DB — `applyCancellations` relabels matching not_done
  // rows in memory so all completion_type-based logic (failures, bonus,
  // earnings) treats a waived task as "not a failure" rather than a miss.
  cancelled: { label: 'Cancelada pelos pais', value: 0, emoji: '🚫', color: 'text-muted-foreground' },
};

export const WEEKLY_BONUS = 5.00;

// Reserved task name used to persist the weekly bonus as a regular task row
export const BONUS_TASK_NAME = 'Bónus Semanal';
export const BONUS_COMPLETION_TYPE = 'bonus';

// ---------------------------------------------------------------
// Delegations
// ---------------------------------------------------------------

// Monthly prize for whoever completed the most tasks they took on from a
// sibling. Sized to match the weekly bonus: worth chasing, without
// distorting the €1-per-task economy.
export const DELEGATION_CHAMPION_BONUS = 5.00;
export const DELEGATION_BONUS_TASK_NAME = 'Campeão das Delegações';

// Breaking a task you accepted from a sibling costs double: you cleared
// their failure by taking it on, then did not deliver.
export const BROKEN_DELEGATION_WEIGHT = 2;

// After breaking an accepted delegation, a child cannot take on new ones
// for this many days — so accepting stays a real commitment.
export const DELEGATION_COOLDOWN_DAYS = 1;

// Both bonus kinds are stored as task rows and must be excluded wherever
// we count "real" tasks (weekly bonus eligibility, stats, failures).
export function isBonusTask(task) {
  return task?.task_name === BONUS_TASK_NAME
      || task?.task_name === DELEGATION_BONUS_TASK_NAME;
}

export const PENALTIES = {
  'Inês': 'Telemóvel/TV',
  'Pedro': 'Monitores',
  'Miguel': 'Carro',
};

export const PERSON_AVATARS = {
  'Inês': '👩',
  'Pedro': '🧒',
  'Miguel': '👨',
};

export const TASK_ICONS = {
  'Máquina da louça': '🫧',
  'Mesa almoço': '🥗',
  'Mesa pequeno-almoço': '☕',
  'Mesa jantar': '🍽️',
  'Apanhar e Dobrar roupa': '🧺',
  'Estender roupa': '👕',
  'Lavandaria': '🧼',
  'Despejar lixo': '🗑️',
  'Meias (10x)': '🧦',
  'Higiene Sidney': '🛁',
  'Passear Sidney': '🦮',
  'Escovar Sidney': '🪮',
  'Limpeza mensal': '🧹',
  'Limpeza semanal': '🧽',
  'Arrumar quarto': '🛏️',
  'Fatura IQA': '🧾',
  'Bónus Semanal': '🏆',
  'Campeão das Delegações': '🤝',
};

export const COMMON_TASKS = [
  'Máquina da louça',
  'Mesa almoço',
  'Mesa pequeno-almoço',
  'Mesa jantar',
  'Apanhar e Dobrar roupa',
  'Estender roupa',
  'Lavandaria',
  'Despejar lixo',
  'Meias (10x)',
  'Higiene Sidney',
  'Passear Sidney',
  'Escovar Sidney',
  'Limpeza mensal',
  'Limpeza semanal',
  'Arrumar quarto',
  'Fatura IQA',
];

export function getTaskIcon(taskName) {
  return TASK_ICONS[taskName] || '✅';
}

// Same-named tasks can occur several times in a day at different times (e.g. a
// noon and an evening "Máquina da louça"). We use the deadline (end_time) as the
// "slot" that tells those occurrences apart, so completing/cancelling/extending
// or reminding one no longer affects the others.
//
// Matching is exact, "no deadline" included. This used to treat a record with
// no end_time as a wildcard matching every slot — so a chore registered from
// the Registar page (those carry no deadline at all) ticked off any scheduled
// task of the same name, and hid the real one from the missed-task check.
export function sameTaskSlot(recordEndTime, taskEndTime) {
  return (recordEndTime ?? '') === (taskEndTime ?? '');
}

// ---------------------------------------------------------------
// Occurrence identity
// ---------------------------------------------------------------
//
// Name + deadline is still not enough to tell two occurrences apart. In this
// family "Arrumar quarto" 19:00 and "Meias (10x)" 20:00 exist for all three
// children and "Passear Sidney" 20:00 for two of them — so the moment one
// delegates their copy to a sibling who already has their own, the two are
// identical on (person, name, date, end_time) and a single photo settled both.
//
// Every row in `tasks` therefore records *which* occurrence it settles, via
// `delegation_id` / `occasional_task_id` / `scheduled_task_id`. A chore
// registered from the Registar page carries none of the three: it is its own
// thing and settles nothing.
export const scheduledOccurrence = (t) => ({
  key: `s:${t.id}`, task_name: t.task_name, end_time: t.end_time ?? null,
});
export const occasionalOccurrence = (t) => ({
  key: `o:${t.id}`, task_name: t.task_name, end_time: t.end_time ?? null,
});
// `fallbackEndTime` is the original task's deadline, for older delegation rows
// written before the delegation itself carried one.
export const delegationOccurrence = (d, fallbackEndTime = null) => ({
  key: `d:${d.id}`, task_name: d.task_name, end_time: d.end_time ?? fallbackEndTime,
});

// The occurrence a `tasks` row settles, or null when it settles none — an
// ad-hoc chore, or a row written by an app version that predates these columns
// and is still cached on someone's device.
export function taskSlotKey(task) {
  if (!task) return null;
  if (task.delegation_id) return `d:${task.delegation_id}`;
  if (task.occasional_task_id) return `o:${task.occasional_task_id}`;
  if (task.scheduled_task_id) return `s:${task.scheduled_task_id}`;
  return null;
}

// The identity columns to stamp on a new `tasks` row. Exactly one is set (or
// none, for an ad-hoc chore), and a delegation always wins: the acceptor is
// settling the delegation, not their own copy of a same-named task.
/** @param {{ delegationId?: any, occasionalTaskId?: any, scheduledTaskId?: any }} [source] */
export function slotColumns(source = {}) {
  const { delegationId, occasionalTaskId, scheduledTaskId } = source;
  if (delegationId) return { delegation_id: delegationId, occasional_task_id: null, scheduled_task_id: null };
  if (occasionalTaskId) return { delegation_id: null, occasional_task_id: occasionalTaskId, scheduled_task_id: null };
  if (scheduledTaskId) return { delegation_id: null, occasional_task_id: null, scheduled_task_id: scheduledTaskId };
  return { delegation_id: null, occasional_task_id: null, scheduled_task_id: null };
}

// The occurrence descriptor of any row that carries the identity columns —
// a `tasks` row or a `task_cancellations` tombstone.
export const occurrenceOf = (row) => ({
  key: taskSlotKey(row),
  task_name: row.task_name,
  end_time: row.end_time ?? null,
});

// Every identity a delegation can be waived through: its own, and the
// scheduled/occasional task it was carved out of. Cancelling the original for
// the sibling who delegated it must also let the sibling who accepted it off.
export function delegationSlotKeys(delegation) {
  const keys = new Set([`d:${delegation.id}`]);
  if (delegation.scheduled_task_id) keys.add(`s:${delegation.scheduled_task_id}`);
  if (delegation.occasional_task_id) keys.add(`o:${delegation.occasional_task_id}`);
  return keys;
}

// True if `task` (a completion or a failure) settles `occurrence`.
//
// When both sides carry an identity we compare only that — exact, and immune
// to two children sharing a task name and deadline. When either side has none
// we fall back to name + exact slot, so rows already in the database and
// devices still running an older cached build keep behaving correctly.
export function settlesSlot(task, occurrence) {
  const key = taskSlotKey(task);
  if (key && occurrence.key) return key === occurrence.key;
  return task.task_name === occurrence.task_name
    && sameTaskSlot(task.end_time, occurrence.end_time);
}

// True if the parents cancelled this exact task occurrence (same person, day
// and time slot). A cancelled occurrence must never count as a failure —
// regardless of whether the not_done row was created before or after the
// cancellation. `task` is a row from the `tasks` table; `cancellations` are
// rows from `task_cancellations`.
export function isTaskCancelled(task, cancellations = []) {
  if (!cancellations.length) return false;
  const occurrence = occurrenceOf(task);
  return cancellations.some(c =>
    c.person === task.person &&
    c.task_date === task.date &&
    settlesSlot(c, occurrence)
  );
}

// Returns a copy of `tasks` where every cancelled not_done occurrence is
// relabeled to the 'cancelled' completion type (value 0). Everything in the
// app keys off completion_type, so doing this once at load time makes
// failures, the weekly bonus, earnings and penalties all treat a waived task
// correctly — without each consumer needing to know about cancellations.
// Nothing here is persisted; it's purely an in-memory view of the data.
export function applyCancellations(tasks, cancellations = []) {
  if (!cancellations.length) return tasks;
  return tasks.map(t =>
    t.completion_type === 'not_done' && isTaskCancelled(t, cancellations)
      ? { ...t, completion_type: 'cancelled', value: 0 }
      : t
  );
}

export function getLocalDateStr(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// ISO week number (1-53), weeks start on Monday
export function getWeekOfYear(date) {
  const d = new Date(date);
  const thursday = new Date(d);
  thursday.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3);
  return Math.round((thursday - firstThursday) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

// Returns a unique key for a given week: "YYYY-WNN" e.g. "2026-W17"
// Uses ISO 8601 weeks (Monday–Sunday). Year is the ISO year (may differ from calendar year in early Jan/late Dec).
export function getWeekKey(date) {
  const d = new Date(date);
  const thursday = new Date(d);
  thursday.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const isoYear = thursday.getFullYear();
  const weekNum = getWeekOfYear(d);
  return `${isoYear}-W${String(weekNum).padStart(2, '0')}`;
}

export function getCurrentWeekKey() {
  return getWeekKey(new Date());
}

// Returns the Monday (first day) of an ISO week given its key e.g. "2026-W17"
export function getWeekStartDate(weekKey) {
  const end = getWeekEndDate(weekKey);
  const start = new Date(end);
  start.setDate(end.getDate() - 6);
  return start;
}

// Returns the Sunday (last day) of an ISO week given its key e.g. "2026-W17"
export function getWeekEndDate(weekKey) {
  const [yearStr, weekStr] = weekKey.split('-W');
  const year = parseInt(yearStr, 10);
  const weekNum = parseInt(weekStr, 10);
  const jan4 = new Date(year, 0, 4);
  const jan4DayOfWeek = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4DayOfWeek);
  const targetSunday = new Date(week1Monday);
  targetSunday.setDate(week1Monday.getDate() + (weekNum - 1) * 7 + 6);
  return targetSunday;
}

// The time facts of a completion, fixed at the instant the proof photo was
// taken rather than whenever the upload finally lands.
//
// On weak wifi an upload takes tens of seconds and may be retried twice. Deriving
// these at write time meant a chore photographed at 18:58 could be filed as
// "late" at 19:01, and one photographed at 23:59 could be filed under the next
// day — leaving the day it actually belonged to looking like a failure, and
// putting it in the wrong week for that week's bonus.
export function completionMoment(at = new Date()) {
  return {
    date: getLocalDateStr(at),
    week_key: getWeekKey(at),
    month_key: `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`,
  };
}

// Was the chore done before its deadline? `at` is the photo's instant.
export function isWithinDeadline(endTime, at = new Date()) {
  if (!endTime) return true;
  const [h, m] = endTime.split(':').map(Number);
  const deadline = new Date(at);
  deadline.setHours(h, m, 0, 0);
  return at <= deadline;
}

export function getCurrentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Keep for backward compat
export function getWeekNumber(date) {
  return getWeekOfYear(date);
}

export function getCurrentWeekNumber() {
  return getWeekOfYear(new Date());
}

export const SIDNEY_TASKS = ['Higiene Sidney', 'Passear Sidney', 'Escovar Sidney'];

// Tasks with a fixed reward regardless of how/when they were done — as long as
// they still count as done. e.g. "Fatura IQA" (using the company NIF on a meal)
// is always worth €0.50, never the €1.00/€0.50 on-time tiers.
export const FIXED_TASK_VALUES = {
  'Fatura IQA': 0.50,
};

/**
 * What a completed task is worth.
 *
 * Looking after Sidney is expected of the family for free, so those chores
 * normally earn €0 — but a sibling who takes one on as a delegation is paid
 * for it on the standard scale (€1.00 on time, halved after a reminder,
 * quartered if late). Doing someone else's dog duty is a favour, and the pay
 * is what makes it worth accepting.
 *
 * @param {string} taskName
 * @param {string} completionType
 * @param {{ delegated?: boolean }} [options] `delegated` = this person took the
 *   task on from a sibling, rather than it being their own chore.
 */
export function getTaskValue(taskName, completionType, { delegated = false } = {}) {
  if (!delegated && SIDNEY_TASKS.includes(taskName)) return 0;
  const base = COMPLETION_TYPES[completionType]?.value ?? 0;
  // Only override positive (earning) completions — a missed/rejected fixed-value
  // task must still be worth 0.
  if (base > 0 && taskName in FIXED_TASK_VALUES) return FIXED_TASK_VALUES[taskName];
  return base;
}

// Headline reward shown when offering/accepting a delegation: what the task
// pays if the helper does it on time. An occasional task carries its own
// explicit reward; everything else follows the standard scale, including
// Sidney chores, which only pay once delegated.
export function getDelegationReward(delegation) {
  if (delegation?.task_type === 'occasional' && delegation.reward != null) {
    return Number(delegation.reward);
  }
  return getTaskValue(delegation?.task_name, 'on_time_no_reminder', { delegated: true });
}

// A completed task is "paid" once the parent paid the child for work done up
// to a later moment. The boundary is a timestamp (the payment instant), not a
// calendar day: a task finished at 19:00 is NOT covered by a payment made at
// 14:00 the same day, even though both share a date. `lastPaidAt` is the
// person's most recent payments.paid_at; `task.created_date` is when the task
// row was inserted (i.e. when the child submitted it).
export function isTaskPaid(task, lastPaidAt) {
  if (!lastPaidAt || !task?.created_date) return false;
  return new Date(task.created_date) <= new Date(lastPaidAt);
}

// Tasks pending approval don't yet count toward earnings.
// Rejected tasks were normalized to value=0 by TaskService.reject so they
// contribute 0 either way, but we still filter to be explicit.
export function isCountableForEarnings(task) {
  return !task.approval_status || task.approval_status === 'approved';
}

// A task whose reward is not yet decided: awaiting first approval ('pending')
// or sent back to the child to correct ('needs_revision'). Neither should count
// toward the weekly bonus or the amount owed to a child.
export function isAwaitingDecision(task) {
  return task?.approval_status === 'pending' || task?.approval_status === 'needs_revision';
}

export function calculateEarnings(tasks) {
  return tasks.reduce(
    (sum, t) => sum + (isCountableForEarnings(t) ? (t.value || 0) : 0),
    0
  );
}

export function getPersonTasks(tasks, person) {
  return tasks.filter(t => t.person === person);
}

export function getWeekTasks(tasks, weekKey) {
  return tasks.filter(t => t.week_key === weekKey);
}

export function getMonthTasks(tasks, monthKey) {
  return tasks.filter(t => t.date && t.date.startsWith(monthKey));
}

export function checkWeeklyBonus(tasks, person, weekKey) {
  const personWeekTasks = tasks.filter(
    t => t.person === person && t.week_key === weekKey && !isBonusTask(t)
  );
  if (personWeekTasks.length === 0) return false;
  // If any task is still awaiting approval or being corrected, bonus is undecided.
  if (personWeekTasks.some(isAwaitingDecision)) return false;
  return personWeekTasks.every(t => t.completion_type !== 'not_done');
}

// Outstanding failures for a child. Sums `failure_weight` rather than
// counting rows: a broken delegation is one row worth 2 failures.
export function countFailures(tasks, person) {
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);

  return tasks.reduce((sum, t) => {
    if (t.person !== person) return sum;
    if (t.completion_type !== 'not_done') return sum;
    if (t.penalty_applied_at) return sum;
    if (new Date(t.date + 'T12:00:00') < thirtyDaysAgo) return sum;
    return sum + (t.failure_weight ?? 1);
  }, 0);
}

// ---------------------------------------------------------------
// Delegation scoring
// ---------------------------------------------------------------

// True once the acceptor actually delivered: a task row exists for them on
// that exact slot and it wasn't missed or waived. A rejected task is
// normalized to not_done by TaskService.reject, so rejections correctly
// flip a delegation back to "broken".
export function isDelegationFulfilled(delegation, tasks = []) {
  // Matched on the delegation's own identity: the acceptor may well have their
  // own same-named task at the same hour, and doing that one is not delivering
  // on what they took over.
  const occurrence = delegationOccurrence(delegation);
  return tasks.some(t =>
    t.person === delegation.to_person &&
    t.date === delegation.task_date &&
    settlesSlot(t, occurrence) &&
    t.completion_type !== 'not_done' &&
    t.completion_type !== 'cancelled'
  );
}

// Parents waived this occurrence — it counts against nobody, whether the
// cancellation was recorded against the delegator or the acceptor.
export function isDelegationWaived(delegation, cancellations = []) {
  const keys = delegationSlotKeys(delegation);
  return cancellations.some(c => {
    if (c.task_date !== delegation.task_date) return false;
    if (c.person !== delegation.to_person && c.person !== delegation.from_person) return false;
    const key = taskSlotKey(c);
    if (key) return keys.has(key);
    // Tombstone written before cancellations carried an identity.
    return c.task_name === delegation.task_name && sameTaskSlot(c.end_time, delegation.end_time);
  });
}

// Per-person record of delegations taken on from a sibling.
//   completed — delivered
//   broken    — deadline passed with nothing to show
//   open      — accepted, still has time
/**
 * @param {any[]} [delegations]
 * @param {any[]} [tasks]
 * @param {{ monthKey?: string, cancellations?: any[] }} [options] `monthKey`
 *   ("YYYY-MM") narrows the window to a single month.
 */
export function getDelegationStats(delegations = [], tasks = [], { monthKey, cancellations = [] } = {}) {
  const today = getLocalDateStr();
  const stats = {};
  for (const p of PEOPLE) stats[p] = { accepted: 0, completed: 0, broken: 0, open: 0 };

  for (const d of delegations) {
    if (d.status !== 'accepted' || !d.to_person) continue;
    if (!stats[d.to_person]) continue;
    if (monthKey && !String(d.task_date || '').startsWith(monthKey)) continue;
    if (isDelegationWaived(d, cancellations)) continue;

    const s = stats[d.to_person];
    s.accepted++;
    if (isDelegationFulfilled(d, tasks)) s.completed++;
    else if (d.task_date < today) s.broken++;
    else s.open++;
  }
  return stats;
}

// Most completed wins; ties go to whoever broke fewer promises.
export function rankDelegations(stats) {
  return PEOPLE
    .map(person => ({ person, ...stats[person] }))
    .sort((a, b) =>
      b.completed - a.completed ||
      a.broken - b.broken ||
      a.person.localeCompare(b.person)
    );
}

// Everyone tied at the top wins the prize — an exact tie shouldn't mean
// nobody gets rewarded. Empty when no one completed a single delegation.
export function getDelegationChampions(stats) {
  const ranked = rankDelegations(stats);
  const best = ranked[0];
  if (!best || best.completed === 0) return [];
  return ranked.filter(r => r.completed === best.completed && r.broken === best.broken);
}

// Cooling-off period after breaking an accepted delegation. Blocks the days
// following the missed one: broken on day D → barred through D + COOLDOWN,
// free again on D + COOLDOWN + 1.
export function getAcceptBlock(delegations = [], tasks = [], person, cancellations = []) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = getLocalDateStr();
  let until = null;

  for (const d of delegations) {
    if (d.status !== 'accepted' || d.to_person !== person) continue;
    if (!d.task_date || d.task_date >= todayStr) continue;
    if (isDelegationWaived(d, cancellations)) continue;
    if (isDelegationFulfilled(d, tasks)) continue;

    const freeAgain = new Date(d.task_date + 'T00:00:00');
    freeAgain.setDate(freeAgain.getDate() + DELEGATION_COOLDOWN_DAYS + 1);
    if (freeAgain > today && (!until || freeAgain > until)) until = freeAgain;
  }

  return { blocked: !!until, until };
}