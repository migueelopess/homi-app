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
  'Despejar lixo': '🗑️',
  'Meias (10x)': '🧦',
  'Higiene Sidney': '🛁',
  'Passear Sidney': '🦮',
  'Escovar Sidney': '🪮',
  'Limpeza mensal': '🧹',
  'Limpeza semanal': '🧽',
  'Arrumar o quarto': '🛏️',
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
  'Despejar lixo',
  'Meias (10x)',
  'Higiene Sidney',
  'Passear Sidney',
  'Escovar Sidney',
  'Limpeza mensal',
  'Limpeza semanal',
  'Arrumar o quarto',
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
// `recordEndTime` is the end_time stored on a completion/reminder/extension/
// cancellation row; `taskEndTime` is the occurrence we're matching against.
// Records created before slot tracking existed have no end_time — those fall
// back to name-only matching so historical data keeps working.
export function sameTaskSlot(recordEndTime, taskEndTime) {
  if (recordEndTime == null || recordEndTime === '') return true;
  return recordEndTime === (taskEndTime ?? '');
}

// True if the parents cancelled this exact task occurrence (same person, day
// and time slot). A cancelled occurrence must never count as a failure —
// regardless of whether the not_done row was created before or after the
// cancellation. `task` is a row from the `tasks` table; `cancellations` are
// rows from `task_cancellations`.
export function isTaskCancelled(task, cancellations = []) {
  if (!cancellations.length) return false;
  return cancellations.some(c =>
    c.person === task.person &&
    c.task_name === task.task_name &&
    c.task_date === task.date &&
    sameTaskSlot(c.end_time, task.end_time)
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

export function getTaskValue(taskName, completionType) {
  if (SIDNEY_TASKS.includes(taskName)) return 0;
  const base = COMPLETION_TYPES[completionType]?.value ?? 0;
  // Only override positive (earning) completions — a missed/rejected fixed-value
  // task must still be worth 0.
  if (base > 0 && taskName in FIXED_TASK_VALUES) return FIXED_TASK_VALUES[taskName];
  return base;
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
  return tasks.some(t =>
    t.person === delegation.to_person &&
    t.task_name === delegation.task_name &&
    t.date === delegation.task_date &&
    sameTaskSlot(t.end_time, delegation.end_time) &&
    t.completion_type !== 'not_done' &&
    t.completion_type !== 'cancelled'
  );
}

// Parents waived this occurrence — it counts against nobody, whether the
// cancellation was recorded against the delegator or the acceptor.
export function isDelegationWaived(delegation, cancellations = []) {
  return cancellations.some(c =>
    c.task_name === delegation.task_name &&
    c.task_date === delegation.task_date &&
    sameTaskSlot(c.end_time, delegation.end_time) &&
    (c.person === delegation.to_person || c.person === delegation.from_person)
  );
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