import { useEffect } from 'react';
import {
  TaskService, ScheduledTaskService, TaskDelegationService,
  TaskCancellationService, CleanupLogService, MissedCheckService,
} from '@/api/entities';
import { sendPushNotification } from '@/api/supabaseClient';
import {
  getWeekKey, getLocalDateStr, sameTaskSlot, countFailures, applyCancellations,
  PENALTIES, isDelegationWaived, BROKEN_DELEGATION_WEIGHT,
  scheduledOccurrence, delegationOccurrence, settlesSlot,
} from './taskHelpers';

// Module-level Set — persists across component remounts within the same app session
const _checkedPersons = new Set();

// Used only for a child with no checkpoint yet (a new person, or a wiped log).
const DEFAULT_LOOKBACK_DAYS = 7;
// Ceiling on a single catch-up, so a long-dormant account cannot fire off
// hundreds of writes on one app open. Anything older is left alone.
const MAX_CATCHUP_DAYS = 60;
// countFailures works over a 30-day window, so the snapshot must cover it too —
// otherwise the "3 failures" alert fires off an undercount.
const FAILURE_WINDOW_DAYS = 30;

// Registers scheduled tasks that were never done as 'not_done'.
//
// Scanning is driven by a per-child checkpoint (missed_check_log), not a fixed
// window. With a fixed lookback, a child who stayed out of the app for longer
// than the window had the older days silently fall out of range and never be
// checked — so staying away was the cheapest way to dodge penalties. Resuming
// where the last run stopped means a gap of any length is caught up exactly
// once, and the checkpoint only moves after a run that actually succeeded.
//
// Every decision is made against data read straight from the DB, never against
// the React Query cache. Marking a task as missed is destructive (it costs the
// child money and counts toward a punishment), and a stale cache made completed
// work look undone.
export function useMarkMissedTasks({ person, enabled }) {
  useEffect(() => {
    if (!enabled || !person) return;
    if (_checkedPersons.has(person)) return;
    _checkedPersons.add(person);

    const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    async function checkMissed() {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      const yesterdayStr = getLocalDateStr(yesterday);

      // Where to resume from. A missing checkpoint (new child) falls back to
      // the old fixed lookback rather than the beginning of time.
      let checkedThrough = null;
      try {
        checkedThrough = await MissedCheckService.getCheckedThrough(person);
      } catch (e) {
        console.error('markMissedTasks: could not read checkpoint', e);
      }

      let scanStart;
      if (checkedThrough) {
        scanStart = new Date(`${checkedThrough}T00:00:00`);
        scanStart.setDate(scanStart.getDate() + 1);
      } else {
        scanStart = new Date(today);
        scanStart.setDate(today.getDate() - DEFAULT_LOOKBACK_DAYS);
      }

      const earliestAllowed = new Date(today);
      earliestAllowed.setDate(today.getDate() - MAX_CATCHUP_DAYS);
      if (scanStart < earliestAllowed) scanStart = earliestAllowed;

      // The snapshot must cover both what we are about to scan and the 30 days
      // the failure count is based on, whichever reaches further back.
      const failureWindowStart = new Date(today);
      failureWindowStart.setDate(today.getDate() - FAILURE_WINDOW_DAYS);
      const snapshotFrom = scanStart < failureWindowStart ? scanStart : failureWindowStart;
      const snapshotFromStr = getLocalDateStr(snapshotFrom);

      // Authoritative snapshot of the decision window. If this fails we must
      // not proceed: assuming "no rows" would mark everything as missed.
      let windowTasks;
      let scheduled;
      try {
        [windowTasks, scheduled] = await Promise.all([
          TaskService.listByDateRange(snapshotFromStr, getLocalDateStr(today)),
          ScheduledTaskService.list(),
        ]);
      } catch (e) {
        console.error('markMissedTasks: aborting, could not read current state', e);
        _checkedPersons.delete(person); // let a later mount retry
        return;
      }
      if (!scheduled || scheduled.length === 0) return;

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
      const beforeFailures = countFailures(applyCancellations(windowTasks, cancellations), person);
      let createdFailures = 0;

      // Rows created during this run, so a later day in the same loop sees them.
      // A record only settles the occurrence it was written against. Matching
      // on name + deadline alone let an ad-hoc chore registered from the
      // Registar page stand in for a scheduled one, so skipping the scheduled
      // task cost nothing.
      const recorded = windowTasks.filter(t => t.person === person);
      const hasRecord = (dateStr, occurrence) => recorded.some(
        t => t.date === dateStr && settlesSlot(t, occurrence)
      );

      const cursor = new Date(scanStart);
      while (cursor <= yesterday) {
        const date = new Date(cursor);
        cursor.setDate(cursor.getDate() + 1);
        const dateStr = getLocalDateStr(date);

        // Skip days that fall before or on the last cleanup date
        if (lastCleanup && dateStr <= lastCleanup) continue;

        const dayKey = DAY_KEYS[date.getDay()];

        const myTasksForDay = scheduled.filter(
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
                 c.task_date === dateStr &&
                 settlesSlot(c, scheduledOccurrence(scheduledTask))
          );
          if (wasCancelled) continue;

          if (!hasRecord(dateStr, scheduledOccurrence(scheduledTask))) {
            try {
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
                scheduled_task_id: scheduledTask.id,
              });
            } catch (err) {
              // 23505 = another device recorded this same slot first. The DB
              // index is the final word on "one failure per slot"; nothing to
              // do and definitely nothing to notify about.
              if (err?.code === '23505') continue;
              throw err;
            }
            recorded.push({
              task_name: scheduledTask.task_name,
              date: dateStr,
              end_time: scheduledTask.end_time ?? null,
              scheduled_task_id: scheduledTask.id,
            });
            createdFailures++;

            // Only for yesterday: a catch-up over a long absence would
            // otherwise fire off dozens of notifications at once.
            if (dateStr === yesterdayStr) {
              sendPushNotification({
                person: '__parents__',
                title: `❌ Tarefa não feita`,
                body: `${person} não completou: ${scheduledTask.task_name} (ontem)`,
                url: '/pais',
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
        // Outside the snapshot we can't tell whether it was delivered, so we
        // must not guess — anything older than the window is left alone.
        if (d.task_date < snapshotFromStr) continue;
        if (lastCleanup && d.task_date <= lastCleanup) continue;
        if (isDelegationWaived(d, cancellations)) continue;

        // Any existing row for this slot means it was either delivered or
        // already marked as missed — nothing to do either way.
        if (hasRecord(d.task_date, delegationOccurrence(d))) continue;

        const brokenDate = new Date(d.task_date + 'T00:00:00');
        try {
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
            delegation_id: d.id,
          });
        } catch (err) {
          if (err?.code === '23505') continue;
          throw err;
        }
        recorded.push({ task_name: d.task_name, date: d.task_date, end_time: d.end_time ?? null, delegation_id: d.id });
        createdFailures += BROKEN_DELEGATION_WEIGHT;

        sendPushNotification({
          person: '__parents__',
          title: '🤝 Delegação não cumprida',
          body: `${person} aceitou "${d.task_name}" de ${d.from_person} e não fez (vale 2 falhas)`,
          url: '/pais',
          tag: `broken-delegation-${d.id}`,
        });
      }

      // Everything above completed, so these days never need checking again.
      // If this write fails the next run simply repeats the same range, which
      // is harmless: existing rows are detected and the unique index refuses
      // duplicates anyway.
      try {
        await MissedCheckService.setCheckedThrough(person, yesterdayStr);
      } catch (e) {
        console.error('markMissedTasks: could not advance checkpoint', e);
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

    checkMissed().catch((err) => {
      console.error('markMissedTasks failed:', err);
      _checkedPersons.delete(person); // allow a retry on the next mount
    });
  }, [enabled, person]);
}