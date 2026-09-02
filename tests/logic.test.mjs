// Logic checks for the rules that decide money and punishment.
//
// Plain Node, no dependencies and no framework: run with `npm test`. These
// exist because every serious bug this app has had was in exactly this logic —
// which occurrence a photo settles, when a chore counts as on time, and which
// day it belongs to — and none of it is visible from the UI until a child is
// paid the wrong amount.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  settlesSlot, scheduledOccurrence, occasionalOccurrence, delegationOccurrence,
  slotColumns, isDelegationFulfilled, sameTaskSlot, occurrenceOf,
  isTaskCancelled, isDelegationWaived, applyCancellations,
  completionMoment, isWithinDeadline,
  getWeekStartDate, getWeekEndDate, getWeekKey, getLocalDateStr,
} from '../src/lib/taskHelpers.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

let pass = 0, fail = 0;
// Names the offenders only when there are any, so a passing run stays quiet.
const detail = (items) => (items.length ? ' — ' + items.join(' | ') : '');

const t = (name, actual, expected = true) => {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${actual}, want ${expected})`}`);
};

// ===== Occurrence identity =====
// Real rows from the family's schedule
const louca1900 = { id: 9,  person: 'Miguel', task_name: 'Máquina da louça', end_time: '19:00' };
const louca1230 = { id: 30, person: 'Miguel', task_name: 'Máquina da louça', end_time: '12:30' };
const quartoInes  = { id: 31, person: 'Inês',  task_name: 'Arrumar quarto', end_time: '19:00' };
const quartoPedro = { id: 33, person: 'Pedro', task_name: 'Arrumar quarto', end_time: '19:00' };

// Inês delegates HER "Arrumar quarto" 19:00 to Pedro, who has his own at 19:00.
const deleg = {
  id: 'uuid-1', task_type: 'scheduled', scheduled_task_id: 31,
  from_person: 'Inês', to_person: 'Pedro',
  task_name: 'Arrumar quarto', task_date: '2026-09-02', end_time: '19:00', status: 'accepted',
};

const row = (over) => ({ task_name: 'x', end_time: null, date: '2026-09-02',
  completion_type: 'on_time_no_reminder', person: 'Pedro', ...over });

// --- 1. the reported bug: ad-hoc chore vs scheduled occurrence -------------
const adhocLouca = row({ person: 'Miguel', task_name: 'Máquina da louça', end_time: null,
  ...slotColumns({}) });
t('ad-hoc "Máquina da louça" does NOT settle the 19:00 scheduled one',
  settlesSlot(adhocLouca, scheduledOccurrence(louca1900)), false);
t('ad-hoc "Máquina da louça" does NOT settle the 12:30 scheduled one',
  settlesSlot(adhocLouca, scheduledOccurrence(louca1230)), false);

// --- 2. the right scheduled occurrence still settles -----------------------
const doneLouca1900 = row({ person: 'Miguel', task_name: 'Máquina da louça', end_time: '19:00',
  ...slotColumns({ scheduledTaskId: 9 }) });
t('doing the 19:00 dishwasher settles the 19:00 one',
  settlesSlot(doneLouca1900, scheduledOccurrence(louca1900)), true);
t('doing the 19:00 dishwasher does NOT settle the 12:30 one',
  settlesSlot(doneLouca1900, scheduledOccurrence(louca1230)), false);

// --- 3. the delegation bug -------------------------------------------------
const pedroOwnQuarto = row({ task_name: 'Arrumar quarto', end_time: '19:00',
  ...slotColumns({ scheduledTaskId: 33 }) });
t('Pedro doing his OWN "Arrumar quarto" does NOT settle Inês\'s delegation',
  settlesSlot(pedroOwnQuarto, delegationOccurrence(deleg)), false);
t('Pedro doing his OWN "Arrumar quarto" settles his own occurrence',
  settlesSlot(pedroOwnQuarto, scheduledOccurrence(quartoPedro)), true);

const pedroDelegQuarto = row({ task_name: 'Arrumar quarto', end_time: '19:00',
  ...slotColumns({ delegationId: 'uuid-1' }) });
t('Pedro doing the DELEGATED one settles the delegation',
  settlesSlot(pedroDelegQuarto, delegationOccurrence(deleg)), true);
t('Pedro doing the DELEGATED one does NOT settle his own occurrence',
  settlesSlot(pedroDelegQuarto, scheduledOccurrence(quartoPedro)), false);
t('Pedro doing the DELEGATED one does NOT settle Inês\'s own occurrence',
  settlesSlot(pedroDelegQuarto, scheduledOccurrence(quartoInes)), false);

// --- 4. delegation ranking counts only real delivery ------------------------
t('delegation NOT fulfilled by Pedro doing his own task',
  isDelegationFulfilled(deleg, [pedroOwnQuarto]), false);
t('delegation fulfilled by Pedro doing the delegated task',
  isDelegationFulfilled(deleg, [pedroDelegQuarto]), true);
t('delegation NOT fulfilled when the row is a failure',
  isDelegationFulfilled(deleg, [{ ...pedroDelegQuarto, completion_type: 'not_done' }]), false);

// --- 5. backward compatibility (rows/clients with no identity) --------------
const legacyDone = row({ task_name: 'Arrumar quarto', end_time: '19:00' }); // no ids
t('legacy row with the right deadline still settles the scheduled task',
  settlesSlot(legacyDone, scheduledOccurrence(quartoPedro)), true);
const legacyAdhoc = row({ task_name: 'Arrumar quarto', end_time: null });
t('legacy row with NO deadline no longer settles a scheduled task',
  settlesSlot(legacyAdhoc, scheduledOccurrence(quartoPedro)), false);

// --- 6. sameTaskSlot is exact ----------------------------------------------
t('sameTaskSlot(null, "19:00") is false', sameTaskSlot(null, '19:00'), false);
t('sameTaskSlot(null, null) is true',     sameTaskSlot(null, null), true);
t('sameTaskSlot("19:00","19:00") is true', sameTaskSlot('19:00', '19:00'), true);

// --- 7. occasional identity -------------------------------------------------
const occ = { id: 77, task_name: 'Fatura IQA', end_time: '18:00' };
const doneOcc = row({ task_name: 'Fatura IQA', end_time: '18:00', ...slotColumns({ occasionalTaskId: 77 }) });
t('occasional completion settles its own occasional task',
  settlesSlot(doneOcc, occasionalOccurrence(occ)), true);
t('occasional completion does NOT settle a different occasional task',
  settlesSlot(doneOcc, occasionalOccurrence({ ...occ, id: 78 })), false);


// --- 8. cancellations waive one occurrence, not every namesake -------------
const missedOwn = row({ task_name: 'Arrumar quarto', end_time: '19:00', date: '2026-09-02',
  completion_type: 'not_done', ...slotColumns({ scheduledTaskId: 33 }) });
const missedDeleg = row({ task_name: 'Arrumar quarto', end_time: '19:00', date: '2026-09-02',
  completion_type: 'not_done', ...slotColumns({ delegationId: 'uuid-1' }) });

// A parent deletes only the delegated failure - the tombstone carries its id.
const tombstoneDeleg = { person: 'Pedro', task_name: 'Arrumar quarto', task_date: '2026-09-02',
  end_time: '19:00', ...slotColumns({ delegationId: 'uuid-1' }) };

t('tombstone waives the delegated failure',
  isTaskCancelled(missedDeleg, [tombstoneDeleg]), true);
t('tombstone does NOT also waive their own failure',
  isTaskCancelled(missedOwn, [tombstoneDeleg]), false);

// Cancelling Ines's original also lets Pedro off the delegation he took on.
const tombstoneOriginal = { person: 'Ines', task_name: 'Arrumar quarto', task_date: '2026-09-02',
  end_time: '19:00', ...slotColumns({ scheduledTaskId: 31 }) };
t('cancelling the original waives the delegation built on it',
  isDelegationWaived({ ...deleg, from_person: 'Ines' }, [tombstoneOriginal]), true);
t('cancelling an unrelated task does not waive the delegation',
  isDelegationWaived(deleg, [{ person: 'Pedro', task_name: 'Arrumar quarto',
    task_date: '2026-09-02', end_time: '19:00', ...slotColumns({ scheduledTaskId: 33 }) }]), false);

// A tombstone written before this change carries no identity and keeps waiving
// broadly - the safe direction.
const legacyTombstone = { person: 'Pedro', task_name: 'Arrumar quarto',
  task_date: '2026-09-02', end_time: '19:00' };
t('legacy tombstone still waives (broadly, as before)',
  isTaskCancelled(missedOwn, [legacyTombstone]) && isTaskCancelled(missedDeleg, [legacyTombstone]), true);

{
  const out = applyCancellations([missedOwn, missedDeleg], [tombstoneDeleg]);
  const own = out.find(x => x.scheduled_task_id === 33);
  const dlg = out.find(x => x.delegation_id === 'uuid-1');
  t('applyCancellations relabels only the waived row',
    own.completion_type === 'not_done' && dlg.completion_type === 'cancelled', true);
}

t('occurrenceOf reads the identity off a row',
  occurrenceOf(missedDeleg).key === 'd:uuid-1', true);


// ===== The moment a chore was done =====
// The scenario the family actually hits: photo taken in a weak-signal corner of
// the house, upload lands well after.
const photoAt   = new Date(2026, 8, 2, 18, 58, 0);  // 2 Sep, 18:58
const uploadAt  = new Date(2026, 8, 2, 19, 1, 30);  // lands at 19:01:30

t('photo before 19:00 is on time',        isWithinDeadline('19:00', photoAt), true);
t('the upload instant alone would be late', isWithinDeadline('19:00', uploadAt), false);
t('exactly on the deadline still counts',  isWithinDeadline('19:00', new Date(2026, 8, 2, 19, 0, 0)), true);
t('no deadline is always on time',         isWithinDeadline(null, uploadAt), true);

// Midnight: the upload crossing into the next day must not move the chore.
const lateNight = new Date(2026, 8, 2, 23, 59, 0);   // Wed 2 Sep
const afterMidnight = new Date(2026, 8, 3, 0, 0, 40); // Thu 3 Sep
t('chore photographed at 23:59 is filed on that day',
  completionMoment(lateNight).date, '2026-09-02');
t('the upload instant alone would file it a day later',
  completionMoment(afterMidnight).date, '2026-09-03');

// A Sunday-night chore must stay in the week whose bonus it counts for.
const sundayNight = new Date(2026, 8, 6, 23, 55, 0);  // Sun 6 Sep
const mondayEarly = new Date(2026, 8, 7, 0, 2, 0);    // Mon 7 Sep
t('Sunday 23:55 keeps the Sunday week key',
  completionMoment(sundayNight).week_key, getWeekKey(sundayNight));
t('and that week is NOT the one the late upload would land in',
  completionMoment(sundayNight).week_key !== completionMoment(mondayEarly).week_key, true);

t('month_key follows the photo too', completionMoment(lateNight).month_key, '2026-09');

// End of month, end of week, all at once.
const endOfMonth = new Date(2026, 7, 31, 23, 58, 0); // Mon 31 Aug
t('31 Aug 23:58 stays in August', completionMoment(endOfMonth).month_key, '2026-08');
t('31 Aug 23:58 date', completionMoment(endOfMonth).date, '2026-08-31');


// ===== Structure: one cache key per thing, one place to invalidate =====
// ---- 1. every ISO week key round-trips through start/end -------------------
for (const iso of ['2026-W01', '2026-W36', '2026-W53', '2025-W52']) {
  const start = getWeekStartDate(iso);
  const end = getWeekEndDate(iso);
  const days = Math.round((end - start) / 86400000);
  t(`${iso}: Monday→Sunday spans 6 days`, days === 6);
  t(`${iso}: start is a Monday`, start.getDay() === 1);
  t(`${iso}: getWeekKey(start) round-trips`, getWeekKey(start), iso);
  t(`${iso}: getWeekKey(end) round-trips`, getWeekKey(end), iso);
}

// ---- 2. the bonus range covers every day of every week it claims ------------
{
  const weeks = ['2026-W30', '2026-W31', '2026-W32'];
  const from = getLocalDateStr(getWeekStartDate(weeks[0]));
  const to = getLocalDateStr(getWeekEndDate(weeks[weeks.length - 1]));
  let allInside = true;
  for (const w of weeks) {
    const d = new Date(getWeekStartDate(w));
    for (let i = 0; i < 7; i++) {
      const s = getLocalDateStr(d);
      if (s < from || s > to) allInside = false;
      d.setDate(d.getDate() + 1);
    }
  }
  t(`bonus date range ${from}..${to} covers all 21 days of the 3 weeks`, allInside);
}

// ---- 3. no page defines a raw query key any more ----------------------------
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'ui') out.push(...walk(p)); }
    else if (/\.(js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}
const files = walk(SRC).filter(f => !f.endsWith(join('lib', 'queries.js')));
const rawKeys = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/queryKey:\s*\[[^\]]*\]/g)) {
    // Only reads are a problem; invalidate/reset use prefixes on purpose.
    const before = src.slice(Math.max(0, m.index - 120), m.index);
    if (!/invalidateQueries|resetQueries|refetchQueries/.test(before)) {
      rawKeys.push(`${f.replace(SRC, 'src')}: ${m[0]}`);
    }
  }
}
t('no page declares its own read query key' + detail(rawKeys), rawKeys.length === 0);

// ---- 4. every invalidation goes through the shared prefixes -----------------
const badInvalidations = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?:invalidateQueries|resetQueries)\(\{\s*queryKey:\s*(\[[^\]]*\])/g)) {
    if (!/INVALIDATE\./.test(m[1])) {
      badInvalidations.push(`${f.replace(SRC, 'src')}: ${m[1]}`);
    }
  }
}
t('every invalidation uses a shared prefix' + detail(badInvalidations), badInvalidations.length === 0);

// ---- 5. realtime covers every table the app reads ---------------------------
{
  const sync = readFileSync(join(SRC, 'hooks', 'useRealtimeSync.js'), 'utf8');
  const expected = ['tasks', 'scheduled_tasks', 'occasional_tasks', 'task_delegations',
                    'task_extensions', 'task_cancellations', 'task_reminders', 'payments'];
  const lines = sync.split(/\r?\n/).map(l => l.trim());
  const missing = expected.filter(tbl => !lines.some(l => l.startsWith(tbl + ':')));
  t('realtime subscribes to every table the app reads' + detail(missing), missing.length === 0);
}

console.log(`
${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
