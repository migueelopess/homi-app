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
  completionMoment, isWithinDeadline, getTaskValue,
  isBonusTask, isWeeklyBonus, isBonusBlock, BONUS_TASK_NAME, DELEGATION_BONUS_TASK_NAME,
  isChore, isAdjustment, formatMoney, checkWeeklyBonus, calculateEarnings, FINE_AMOUNT, FINE_TASK_NAME,
  DELEGATION_CHAMPION_BONUS, completionTypeFor,
  isDelegationOpen, minutesLeftToAccept, delegationNeedsParents, DELEGATION_STATUS,
  isDelegationOpenFor, siblingAnswers, siblingsOf, DELEGATION_ACCEPT_WINDOW_LABEL, isTaskPaid,
  getWeekStartDate, getWeekEndDate, getWeekKey, getLocalDateStr,
  effectiveDeadline, requestedUntil, extensionFor, extensionRequestFor, pendingExtensionRequests,
  extensionRequestOrdinal, correctedForExtension, completionValue, untilLabel,
} from '../src/lib/taskHelpers.js';

import { planPurge } from '../supabase/functions/purge-paid/plan.ts';

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


// ===== Fixed-value tasks =====
t('Limpeza mensal pays 17.50', getTaskValue('Limpeza mensal', 'on_time_no_reminder'), 17.5);
t('Limpeza semanal pays 6.50', getTaskValue('Limpeza semanal', 'on_time_no_reminder'), 6.5);
t('a rejected Limpeza mensal pays nothing', getTaskValue('Limpeza mensal', 'not_done'), 0);
t('Fatura IQA still pays 0.50', getTaskValue('Fatura IQA', 'on_time_no_reminder'), 0.5);
t('an ordinary task still pays 1.00', getTaskValue('Despejar lixo', 'on_time_no_reminder'), 1);

// ===== Bonus rows =====
{
  const weekly = { task_name: BONUS_TASK_NAME, value: 5 };
  const prize = { task_name: DELEGATION_BONUS_TASK_NAME, value: 5 };
  const block = { task_name: BONUS_TASK_NAME, value: 0 };
  t('the delegation prize is a bonus', isBonusTask(prize));
  t('the delegation prize is NOT the weekly bonus (it was deleted every open)', isWeeklyBonus(prize), false);
  t('the weekly bonus is the weekly bonus', isWeeklyBonus(weekly));
  t('a zero-value weekly row blocks the week and still counts as its bonus', isWeeklyBonus(block) && isBonusBlock(block));
  t('a real bonus is not a block', isBonusBlock(weekly), false);
}

// ===== Delegated tasks are never late for the one who took them =====
{
  const at = new Date(2026, 9, 12, 19, 35); // 19:35, deadline was 19:00
  t('my own task done after its deadline is late',
    completionTypeFor({ endTime: '19:00', at }), 'late');
  t('a delegated task done after the original deadline is on time',
    completionTypeFor({ endTime: '19:00', at, delegated: true }), 'on_time_no_reminder');
  t('a delegated task still honours a parent reminder',
    completionTypeFor({ endTime: '19:00', at, delegated: true, hasReminder: true }), 'on_time_with_reminder');
  t('an old extension (no new time) still makes my own late task on time',
    completionTypeFor({ endTime: '19:00', at, extension: { until_time: null } }), 'on_time_no_reminder');
  t('my own task before its deadline is on time',
    completionTypeFor({ endTime: '19:00', at: new Date(2026, 9, 12, 18, 50) }), 'on_time_no_reminder');
}

// ===== More time: the child asks, the parents give a new deadline =====
{
  const day = '2026-10-21';
  const at = (h, m) => new Date(2026, 9, 21, h, m);

  // The new deadline replaces the old one — both ways.
  t('more time until 20:00: done at 19:35 is on time',
    completionTypeFor({ endTime: '19:00', at: at(19, 35), extension: { until_time: '20:00' } }), 'on_time_no_reminder');
  t('more time until 20:00: done at 20:10 is still late',
    completionTypeFor({ endTime: '19:00', at: at(20, 10), extension: { until_time: '20:00' } }), 'late');
  t('more time with a parent reminder pays the reminder rate',
    completionTypeFor({ endTime: '19:00', at: at(19, 35), hasReminder: true, extension: { until_time: '20:00' } }), 'on_time_with_reminder');
  t('no extension: the task keeps its own deadline', effectiveDeadline('19:00', null), '19:00');
  t('"until the end of the day" has no deadline', effectiveDeadline('19:00', { until_time: null }), null);

  // What a child is asking for.
  t('+1 h asked before the deadline counts from the deadline', requestedUntil('19:00', 60, at(18, 10)), '20:00');
  t('+1 h asked after the deadline counts from now', requestedUntil('19:00', 60, at(19, 40)), '20:40');
  t('more time never crosses midnight', requestedUntil('23:30', 120, at(23, 0)), '23:59');
  t('"até ao fim do dia" asks for no time', requestedUntil('19:00', null, at(18, 0)), null);
  t('label for a time', untilLabel('20:00'), 'até às 20:00');
  t('label for the rest of the day', untilLabel(null), 'até ao fim do dia');

  // Matching a task: person, day, name and exact slot.
  const req = { id: 'x1', person: 'Pedro', task_name: 'Máquina da louça', task_date: day, end_time: '19:00',
                until_time: '20:00', status: 'pending', created_at: '2026-10-21T17:00:00Z' };
  t('a request is found for its own task', extensionRequestFor([req], 'Pedro', 'Máquina da louça', '19:00', day)?.id, 'x1');
  t('not for the same task at another hour', extensionRequestFor([req], 'Pedro', 'Máquina da louça', '13:00', day), null);
  t('not for a sibling', extensionRequestFor([req], 'Inês', 'Máquina da louça', '19:00', day), null);
  t('not on another day', extensionRequestFor([req], 'Pedro', 'Máquina da louça', '19:00', '2026-10-22'), null);

  const lookup = (extensions, requests) => extensionFor({
    extensions, requests, person: 'Pedro', taskName: 'Máquina da louça', endTime: '19:00', date: day });
  t('a pending request gives no extra time', lookup([], [req]), null);
  t('a refused request gives no extra time', lookup([], [{ ...req, status: 'refused' }]), null);
  t('a granted request counts before extensions are refetched',
    lookup([], [{ ...req, status: 'granted' }])?.until_time, '20:00');
  t('a real extension row wins over the request',
    lookup([{ person: 'Pedro', task_name: 'Máquina da louça', task_date: day, end_time: '19:00', until_time: '19:30' }],
           [{ ...req, status: 'granted' }])?.until_time, '19:30');

  // The parents' list: only today's still-open requests.
  t("today's pending request is waiting", pendingExtensionRequests([req], day).length, 1);
  t("yesterday's lapsed with its day", pendingExtensionRequests([req], '2026-10-22').length, 0);
  t('an answered one is not waiting', pendingExtensionRequests([{ ...req, status: 'granted' }], day).length, 0);

  // "3.º pedido esta semana" (2026-10-19 is a Monday, 10-18 the Sunday before)
  const week = [
    { ...req, id: 'a', task_date: '2026-10-18', created_at: '2026-10-18T10:00:00Z' },
    { ...req, id: 'b', task_date: '2026-10-19', created_at: '2026-10-19T10:00:00Z' },
    { ...req, id: 'c', task_date: '2026-10-20', created_at: '2026-10-20T10:00:00Z' },
    { ...req, id: 'd', person: 'Inês', task_date: '2026-10-20', created_at: '2026-10-20T11:00:00Z' },
    req,
  ];
  t('third request of the week (last week and siblings not counted)', extensionRequestOrdinal(week, req), 3);
  t('first request of the week', extensionRequestOrdinal(week, week[1]), 1);

  // Answered late: a photo already filed as late is corrected.
  const late = { completion_type: 'late', created_date: at(19, 35).toISOString() };
  t('late at 19:35, granted until 20:00 → on time', correctedForExtension(late, '20:00'), 'on_time_no_reminder');
  t('…with a reminder → the reminder rate', correctedForExtension(late, '20:00', true), 'on_time_with_reminder');
  t('late at 19:35, granted until 19:30 → stays late', correctedForExtension(late, '19:30'), null);
  t('granted until the end of the day → on time', correctedForExtension(late, null), 'on_time_no_reminder');
  t('an on-time row is never touched',
    correctedForExtension({ completion_type: 'on_time_no_reminder', created_date: late.created_date }, '20:00'), null);
  t('a failure is never turned into a completion',
    correctedForExtension({ completion_type: 'not_done', created_date: late.created_date }, null), null);

  // Value of the corrected row
  t('standard task on time pays €1', completionValue({ taskName: 'Máquina da louça', completionType: 'on_time_no_reminder' }), 1);
  t('occasional reward on time pays the reward', completionValue({ taskName: 'X', completionType: 'on_time_no_reminder', reward: 3 }), 3);
  t('occasional reward late pays a quarter', completionValue({ taskName: 'X', completionType: 'late', reward: 3 }), 0.75);
  t('own Sidney chore stays €0', completionValue({ taskName: 'Passear Sidney', completionType: 'on_time_no_reminder' }), 0);
}

// ===== Delegation requests: one hour to accept, then the parents decide =====
{
  const created = new Date(2026, 9, 12, 18, 0);
  const req = { id: 'r1', status: 'pending', created_at: created.toISOString(), from_person: 'Miguel',
                task_type: 'scheduled', scheduled_task_id: 9, task_name: 'Maquina', task_date: '2026-10-12', end_time: '19:00' };
  const at = (h, m) => new Date(2026, 9, 12, h, m);

  t('a request can be accepted inside the 3-hour window', isDelegationOpen(req, at(20, 59)));
  t('a request cannot be accepted once the 3 hours are up', isDelegationOpen(req, at(21, 0)), false);
  t('an accepted request is no longer open', isDelegationOpen({ ...req, status: 'accepted' }, at(18, 10)), false);
  t('minutes left are rounded up', minutesLeftToAccept(req, at(18, 20)), 160);
  t('minutes left never go negative', minutesLeftToAccept(req, at(22, 0)), 0);

  const day = '2026-10-12';
  const unanswered = { ...req, status: DELEGATION_STATUS.UNANSWERED };
  t('an unanswered request waits for the parents', delegationNeedsParents(unanswered, [], day));
  t('a pending request does not (yet)', delegationNeedsParents(req, [], day), false);
  t('a decided request does not', delegationNeedsParents({ ...req, status: 'parent_cancelled' }, [], day), false);
  const doneItself = { person: 'Miguel', date: '2026-10-12', task_name: 'Maquina', end_time: '19:00',
                       completion_type: 'on_time_no_reminder', scheduled_task_id: 9 };
  t('if the child did it after all, the parents are not asked', delegationNeedsParents(unanswered, [doneItself], day), false);
  t('a sibling doing their own same-named task does not count',
    delegationNeedsParents(unanswered, [{ ...doneItself, person: 'Pedro', scheduled_task_id: 33 }], day));
  t('a failure is not "done"', delegationNeedsParents(unanswered, [{ ...doneItself, completion_type: 'not_done' }], day));
  t("the next day it no longer waits — it was the child's, and is gone from the list",
    delegationNeedsParents(unanswered, [], '2026-10-13'), false);
}

// ===== Siblings accept or refuse =====
t('the window is described as 3 horas', DELEGATION_ACCEPT_WINDOW_LABEL, '3 horas');
{
  const created = new Date(2026, 9, 12, 18, 0);
  const at = new Date(2026, 9, 12, 18, 20);
  const req = { status: 'pending', created_at: created.toISOString(), from_person: 'Pedro', refused_by: ['Miguel'] };
  t('the siblings of Pedro are Ines and Miguel', siblingsOf('Pedro').join(','), 'Inês,Miguel');
  t('a sibling who refused no longer sees the request', isDelegationOpenFor(req, 'Miguel', at), false);
  t('the other sibling still can answer', isDelegationOpenFor(req, 'Inês', at));
  t('nobody answers their own request', isDelegationOpenFor(req, 'Pedro', at), false);
  t('a request with no refusals yet is open to both', isDelegationOpenFor({ ...req, refused_by: [] }, 'Miguel', at));
  t('older rows without refused_by still work', isDelegationOpenFor({ ...req, refused_by: undefined }, 'Miguel', at));
  const partial = siblingAnswers(req);
  t('answers: who refused', partial.refused.join(','), 'Miguel');
  t('answers: who stayed silent', partial.silent.join(','), 'Inês');
  t('answers: all refused', siblingAnswers({ ...req, refused_by: ['Miguel', 'Inês'] }).silent.length, 0);
}

// ===== What counts as paid =====
{
  const paidAt = '2026-10-11T22:56:00Z';
  t('approved before the payment: paid',
    isTaskPaid({ created_date: '2026-10-04T00:00:00Z', approved_at: '2026-10-05T10:00:00Z' }, paidAt));
  t('submitted before but approved after the payment: NOT paid',
    isTaskPaid({ created_date: '2026-10-04T00:00:00Z', approved_at: '2026-10-13T10:00:00Z' }, paidAt), false);
  t('still waiting for a decision: NOT paid',
    isTaskPaid({ created_date: '2026-10-04T00:00:00Z', approved_at: null, approval_status: 'needs_revision' }, paidAt), false);
  t('a bonus with no approval time uses its creation time',
    isTaskPaid({ created_date: '2026-10-11T20:00:00Z' }, paidAt));
  t('nothing is paid before the first payment', isTaskPaid({ created_date: '2026-10-04T00:00:00Z' }, null), false);
}

// ===== Paying is the cleanup (supabase/functions/purge-paid/plan.ts) =====
{
  const paidAt = '2026-10-11T22:56:00Z';
  let n = 0;
  const row = (over) => ({ id: ++n, person: 'Pedro', task_name: 'Mesa jantar', date: '2026-10-05', end_time: '19:00',
    week_key: '2026-W41', completion_type: 'on_time_no_reminder', approval_status: 'approved',
    approved_at: '2026-10-06T10:00:00Z', created_date: '2026-10-05T18:00:00Z', delegation_id: null,
    scheduled_task_id: 20, occasional_task_id: null, photo_url: null, ...over });

  const paid       = row({});
  const unpaid     = row({ approved_at: '2026-10-13T10:00:00Z', created_date: '2026-10-13T09:00:00Z', date: '2026-10-13', week_key: '2026-W42' });
  const lateApprov = row({ approved_at: '2026-10-13T10:00:00Z' }); // submitted before, approved after the payment
  const undecided  = row({ approval_status: 'needs_revision', approved_at: null });
  const failure    = row({ completion_type: 'not_done' });
  const delegRow   = row({ delegation_id: 'd-recent', date: '2026-10-05' });
  const oldDeleg   = row({ delegation_id: 'd-old', date: '2026-08-20', week_key: '2026-W34' });
  const legacyDeleg = row({ scheduled_task_id: null, date: '2026-10-05', end_time: '19:00' }); // pre-identity row
  const prize      = row({ task_name: 'Campeão das Delegações', completion_type: 'bonus', week_key: '2026-W40' });
  const bonusEmpty = row({ task_name: 'Bónus Semanal', completion_type: 'bonus', week_key: '2026-W39', value: 5 });
  const bonusBusy  = row({ task_name: 'Bónus Semanal', completion_type: 'bonus', week_key: '2026-W41', value: 5 });
  const fine       = row({ task_name: 'Multa (3 falhas)', completion_type: 'adjustment', week_key: '2026-W40' });
  const rows = [paid, unpaid, lateApprov, undecided, failure, delegRow, oldDeleg, legacyDeleg, prize, bonusEmpty, bonusBusy, fine];
  const delegations = [
    { id: 'd-recent', to_person: 'Pedro', status: 'accepted', task_name: 'Mesa jantar', task_date: '2026-10-05', end_time: '19:00' },
    { id: 'd-old', to_person: 'Pedro', status: 'accepted', task_name: 'Mesa jantar', task_date: '2026-08-20', end_time: '19:00' },
  ];
  const plan = planPurge(rows, delegations, paidAt, '2026-09-01');
  const gone = new Set([...plan.chores, ...plan.adjustments, ...plan.bonuses].map(r => r.id));

  t('purge: a paid chore goes', gone.has(paid.id));
  t('purge: an unpaid chore stays', gone.has(unpaid.id), false);
  t('purge: approved only after the payment stays', gone.has(lateApprov.id), false);
  t('purge: a task sent back for a fix stays', gone.has(undecided.id), false);
  t('purge: failures stay', gone.has(failure.id), false);
  t('purge: a row fulfilling a recent delegation stays', gone.has(delegRow.id), false);
  t('purge: a row fulfilling an old delegation goes', gone.has(oldDeleg.id));
  t('purge: a pre-identity row matching a recent delegation by name+hour stays', gone.has(legacyDeleg.id), false);
  t('purge: delegation prizes are never touched', gone.has(prize.id), false);
  t('purge: the bonus of a week left empty goes', gone.has(bonusEmpty.id));
  t('purge: the bonus of a week that still has rows stays (or it would be paid again)', gone.has(bonusBusy.id), false);
  t('purge: a paid fine goes', gone.has(fine.id));
  t('purge: nothing goes before the first payment', planPurge(rows, delegations, null, '2026-09-01').chores.length, 0);
}

// ===== Delegation prize =====
t('the monthly delegation prize is 10.00', DELEGATION_CHAMPION_BONUS, 10);

// ===== Fines and negative balances =====
{
  const fine = { person: 'Pedro', task_name: FINE_TASK_NAME, completion_type: 'adjustment', value: -FINE_AMOUNT,
                 approval_status: 'approved', week_key: '2026-W42' };
  const chore = { person: 'Pedro', task_name: 'Mesa jantar', completion_type: 'on_time_no_reminder', value: 1,
                  approval_status: 'approved', week_key: '2026-W42' };
  t('a fine is an adjustment', isAdjustment(fine));
  t('a fine is not a chore', isChore(fine), false);
  t('a fine is not a bonus', isBonusTask(fine), false);
  t('an ordinary task is a chore', isChore(chore));
  t('a fine can take the balance below zero', calculateEarnings([chore, fine]), -9);
  t('a week with only a fine earns no weekly bonus', checkWeeklyBonus([fine], 'Pedro', '2026-W42'), false);
  t('a fine neither blocks nor grants a perfect week', checkWeeklyBonus([chore, fine], 'Pedro', '2026-W42'));
  t('debts are shown with a minus sign', formatMoney(-10), '−€10.00');
  t('positive money is shown plain', formatMoney(4), '€4.00');
}

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

// ---- 5. freshness comes from polling, not Realtime -------------------------
// Realtime postgres_changes was removed because the free instance could not
// carry it (see src/lib/query-client.js). Re-adding a subscription without
// upgrading the compute brings the 19:00 "database timeout"s back, so this
// fails loudly if one reappears.
{
  const subscribers = files.filter(f => /\.on\(\s*['"]postgres_changes['"]/.test(readFileSync(f, 'utf8')))
    .map(f => f.replace(SRC, 'src'));
  t('nothing subscribes to Realtime postgres_changes' + detail(subscribers), subscribers.length === 0);

  const qc = readFileSync(join(SRC, 'lib', 'query-client.js'), 'utf8');
  const qs = readFileSync(join(SRC, 'lib', 'queries.js'), 'utf8');
  const polled = (name) => new RegExp(`export const ${name} = [^;]*?refetchInterval: LIVE_INTERVAL_MS`, 's').test(qs);
  t('tasks, approvals and delegations poll while the app is open',
    ['tasksQuery', 'pendingTasksQuery', 'delegationsQuery'].every(polled));
  t('nothing polls in the background', /refetchIntervalInBackground:\s*false/.test(qc));
  t('nothing polls globally', !/^\s*refetchInterval:/m.test(qc));
}

console.log(`
${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
