import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Records the scheduled tasks nobody did as `not_done`, for every child, on a
// schedule — rather than only when that child happens to open the app.
//
// This used to run in the browser. A failure therefore only existed once the
// child themselves launched Homi, so a child who simply stayed out of the app
// accumulated nothing visible: the parents could not see that someone was
// already at three failures, and staying away was the cheapest way to look
// clean. Pedro once sat on nineteen undetected failures.
//
// The rule itself is unchanged, and deliberately only ever looks at days that
// are already over. A task whose deadline passed earlier *today* can still be
// done late (worth a quarter), so calling it missed before midnight would be
// wrong — and would leave two rows for one occurrence.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};

// Kept in step with src/lib/taskHelpers.js
const PEOPLE = ["Inês", "Pedro", "Miguel"];
const PENALTIES: Record<string, string> = {
  "Inês": "Telemóvel/TV",
  "Pedro": "Monitores",
  "Miguel": "Carro",
};
const BROKEN_DELEGATION_WEIGHT = 2;
const FAILURE_THRESHOLD = 3;

// Used only for a child with no checkpoint yet (a new person, or a wiped log).
const DEFAULT_LOOKBACK_DAYS = 7;
// Ceiling on a single catch-up, so a long-dormant account cannot fire off
// hundreds of writes at once. Anything older is left alone.
const MAX_CATCHUP_DAYS = 60;
// countFailures works over a 30-day window, so the snapshot must cover it too.
const FAILURE_WINDOW_DAYS = 30;

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// ── Dates ──────────────────────────────────────────────────────────────────
// All day arithmetic is done on "YYYY-MM-DD" strings anchored at UTC noon, so
// neither the server's timezone nor a DST switch can nudge a date across a day
// boundary. Only "what day is it right now" consults Europe/Lisbon.

function lisbonToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const asDate = (dateStr: string) => new Date(`${dateStr}T12:00:00Z`);

function addDays(dateStr: string, days: number): string {
  const d = asDate(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayKeyOf(dateStr: string): string {
  return DAY_KEYS[asDate(dateStr).getUTCDay()];
}

// ISO-8601 week, matching getWeekKey in src/lib/taskHelpers.js exactly
// (verified day by day across four years).
function weekKeyOf(dateStr: string): string {
  const d = asDate(dateStr);
  const dayIdx = (d.getUTCDay() + 6) % 7; // Monday = 0
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() - dayIdx + 3);
  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4, 12));
  const ftIdx = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftIdx + 3);
  const week = Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86400000)) + 1;
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

// ── Occurrence identity ────────────────────────────────────────────────────
// Mirrors settlesSlot / taskSlotKey in src/lib/taskHelpers.js. Name and
// deadline alone cannot tell two occurrences apart: three children share
// "Arrumar quarto" at 19:00, so a child's own task and one they took over from
// a sibling look identical without this.

type SlotSource = {
  scheduled_task_id?: number | null;
  occasional_task_id?: number | null;
  delegation_id?: string | null;
};
type Occurrence = { key: string | null; task_name: string; end_time: string | null };

function taskSlotKey(row: SlotSource): string | null {
  if (row.delegation_id) return `d:${row.delegation_id}`;
  if (row.occasional_task_id) return `o:${row.occasional_task_id}`;
  if (row.scheduled_task_id) return `s:${row.scheduled_task_id}`;
  return null;
}

const sameSlot = (a: string | null, b: string | null) => (a ?? "") === (b ?? "");

// True when `row` settles `occurrence`. Both sides identified → compare only
// that; otherwise fall back to name + exact deadline, for rows written before
// the identity columns existed.
function settlesSlot(row: SlotSource & { task_name: string; end_time: string | null }, occurrence: Occurrence): boolean {
  const key = taskSlotKey(row);
  if (key && occurrence.key) return key === occurrence.key;
  return row.task_name === occurrence.task_name && sameSlot(row.end_time, occurrence.end_time);
}

const scheduledOccurrence = (t: { id: number; task_name: string; end_time: string | null }): Occurrence =>
  ({ key: `s:${t.id}`, task_name: t.task_name, end_time: t.end_time ?? null });

const delegationOccurrence = (d: { id: string; task_name: string; end_time: string | null }): Occurrence =>
  ({ key: `d:${d.id}`, task_name: d.task_name, end_time: d.end_time ?? null });

// Every identity a delegation can be waived through: its own, and the task it
// was carved out of — cancelling the original must let the acceptor off too.
function delegationSlotKeys(d: Delegation): Set<string> {
  const keys = new Set([`d:${d.id}`]);
  if (d.scheduled_task_id) keys.add(`s:${d.scheduled_task_id}`);
  if (d.occasional_task_id) keys.add(`o:${d.occasional_task_id}`);
  return keys;
}

function isDelegationWaived(d: Delegation, cancellations: Cancellation[]): boolean {
  const keys = delegationSlotKeys(d);
  return cancellations.some((c) => {
    if (c.task_date !== d.task_date) return false;
    if (c.person !== d.to_person && c.person !== d.from_person) return false;
    const key = taskSlotKey(c);
    if (key) return keys.has(key);
    return c.task_name === d.task_name && sameSlot(c.end_time, d.end_time);
  });
}

// ── Rows ───────────────────────────────────────────────────────────────────

type TaskRow = {
  id?: number;
  person: string;
  task_name: string;
  date: string;
  end_time: string | null;
  completion_type: string;
  penalty_applied_at?: string | null;
  failure_weight?: number | null;
  scheduled_task_id?: number | null;
  occasional_task_id?: number | null;
  delegation_id?: string | null;
};

type Cancellation = {
  person: string;
  task_name: string;
  task_date: string;
  end_time: string | null;
  scheduled_task_id?: number | null;
  occasional_task_id?: number | null;
  delegation_id?: string | null;
};

type Delegation = {
  id: string;
  from_person: string;
  to_person: string | null;
  task_type: string;
  scheduled_task_id: number | null;
  occasional_task_id: number | null;
  task_name: string;
  task_date: string;
  end_time: string | null;
  status: string;
};

type ScheduledTask = {
  id: number;
  person: string;
  task_name: string;
  days_of_week: string[];
  end_time: string;
  created_date: string | null;
};

// A waived occurrence counts against nobody. Same relabelling the app does.
function isWaived(task: TaskRow, cancellations: Cancellation[]): boolean {
  const occurrence: Occurrence = {
    key: taskSlotKey(task),
    task_name: task.task_name,
    end_time: task.end_time,
  };
  return cancellations.some(
    (c) => c.person === task.person && c.task_date === task.date && settlesSlot(c, occurrence),
  );
}

// Outstanding failures for a child, counted exactly like their "X/3 falhas"
// card: not_done, no penalty discharged yet, waived ones excluded, weighted.
function countFailures(tasks: TaskRow[], person: string, cancellations: Cancellation[], todayStr: string): number {
  const windowStart = addDays(todayStr, -FAILURE_WINDOW_DAYS);
  let total = 0;
  for (const t of tasks) {
    if (t.person !== person) continue;
    if (t.completion_type !== "not_done") continue;
    if (t.penalty_applied_at) continue;
    if (t.date < windowStart) continue;
    if (isWaived(t, cancellations)) continue;
    total += t.failure_weight ?? 1;
  }
  return total;
}

async function notifyParents(title: string, body: string, tag: string) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-push-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ person: "__parents__", title, body, url: "/pais", tag }),
    });
  } catch (err) {
    // A notification that fails to send must never abort the run — the rows
    // are what matter, and the app shows them either way.
    console.error("mark-missed-tasks: push failed", err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    // `{"dry_run": true}` reports exactly what would be written and touches
    // nothing — the only safe way to inspect a run that costs children money.
    let dryRun = false;
    try {
      const body = await req.json();
      dryRun = body?.dry_run === true;
    } catch {
      // no body — a cron call
    }

    const todayStr = lisbonToday();
    const yesterdayStr = addDays(todayStr, -1);

    // Cheap first pass: when every child is already checked through yesterday
    // there is nothing to do, and this runs often enough that the common case
    // should cost one query.
    const { data: checkpointRows, error: checkpointErr } = await supabase
      .from("missed_check_log")
      .select("person, checked_through");
    if (checkpointErr) throw checkpointErr;

    const checkpoints = new Map<string, string>();
    for (const row of checkpointRows ?? []) checkpoints.set(row.person, row.checked_through);

    const pending = PEOPLE.filter((p) => (checkpoints.get(p) ?? "") < yesterdayStr);
    if (pending.length === 0) {
      return new Response(
        JSON.stringify({ checked_through: yesterdayStr, up_to_date: true, created: 0, dry_run: dryRun }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    // How far back this run reaches, across everyone still pending.
    const earliestAllowed = addDays(todayStr, -MAX_CATCHUP_DAYS);
    const scanStarts = new Map<string, string>();
    for (const person of pending) {
      const checkpoint = checkpoints.get(person);
      let start = checkpoint ? addDays(checkpoint, 1) : addDays(todayStr, -DEFAULT_LOOKBACK_DAYS);
      if (start < earliestAllowed) start = earliestAllowed;
      scanStarts.set(person, start);
    }
    const failureWindowStart = addDays(todayStr, -FAILURE_WINDOW_DAYS);
    const snapshotFrom = [...scanStarts.values(), failureWindowStart].sort()[0];

    // One authoritative read of everything the decision rests on. If any of
    // these fail we abort: assuming "no rows" would mark the world as missed.
    const [tasksRes, scheduledRes, delegationsRes, cancellationsRes, cleanupRes] = await Promise.all([
      supabase
        .from("tasks")
        .select("id, person, task_name, date, end_time, completion_type, penalty_applied_at, failure_weight, scheduled_task_id, occasional_task_id, delegation_id")
        .gte("date", snapshotFrom)
        .lte("date", todayStr),
      supabase.from("scheduled_tasks").select("id, person, task_name, days_of_week, end_time, created_date"),
      supabase.from("task_delegations").select("*"),
      supabase.from("task_cancellations").select("person, task_name, task_date, end_time, scheduled_task_id, occasional_task_id, delegation_id"),
      supabase.from("cleanup_log").select("cleaned_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);

    for (const res of [tasksRes, scheduledRes, delegationsRes, cancellationsRes]) {
      if (res.error) throw res.error;
    }

    const windowTasks = (tasksRes.data ?? []) as TaskRow[];
    const scheduled = (scheduledRes.data ?? []) as ScheduledTask[];
    const delegations = (delegationsRes.data ?? []) as Delegation[];
    const cancellations = (cancellationsRes.data ?? []) as Cancellation[];
    const lastCleanup: string | null = cleanupRes.data?.cleaned_at ?? null;

    if (scheduled.length === 0) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "no scheduled tasks" }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    }

    const summary: Record<string, number> = {};
    const wouldCreate: Array<Record<string, unknown>> = [];
    let totalCreated = 0;

    // The single place that writes a failure, so dry runs cannot leak past it.
    const recordFailure = async (row: Record<string, unknown>) => {
      if (dryRun) {
        wouldCreate.push(row);
        return "created" as const;
      }
      const { error } = await supabase.from("tasks").insert(row);
      if (error) {
        // 23505 = the unique index already holds a failure for this exact
        // occurrence. It is the final word; nothing to add.
        if (error.code === "23505") return "duplicate" as const;
        throw error;
      }
      return "created" as const;
    };

    for (const person of pending) {
      // Rows already recorded, plus the ones this run adds, so a later day in
      // the loop sees what an earlier one wrote.
      const recorded = windowTasks.filter((t) => t.person === person);
      const hasRecord = (dateStr: string, occurrence: Occurrence) =>
        recorded.some((t) => t.date === dateStr && settlesSlot(t, occurrence));

      const beforeFailures = countFailures(windowTasks, person, cancellations, todayStr);
      let createdFailures = 0;
      let createdRows = 0;

      // ── Scheduled tasks nobody did ──────────────────────────────────────
      let cursor = scanStarts.get(person)!;
      while (cursor <= yesterdayStr) {
        const dateStr = cursor;
        cursor = addDays(cursor, 1);

        // Everything up to and including the last cleanup was deliberately
        // wiped; recreating it would resurrect what the parents removed.
        if (lastCleanup && dateStr <= lastCleanup) continue;

        const dayKey = dayKeyOf(dateStr);
        const dueThatDay = scheduled.filter(
          (t) =>
            t.person === person &&
            t.days_of_week?.includes(dayKey) &&
            // Only missed if the routine already existed that day.
            (!t.created_date || t.created_date.split("T")[0] <= dateStr),
        );

        for (const task of dueThatDay) {
          const handedOff = delegations.some(
            (d) =>
              d.task_type === "scheduled" &&
              d.scheduled_task_id === task.id &&
              d.task_date === dateStr &&
              d.from_person === person &&
              d.status === "accepted",
          );
          if (handedOff) continue;

          const occurrence = scheduledOccurrence(task);

          const waived = cancellations.some(
            (c) => c.person === person && c.task_date === dateStr && settlesSlot(c, occurrence),
          );
          if (waived) continue;

          if (hasRecord(dateStr, occurrence)) continue;

          const outcome = await recordFailure({
            person,
            task_name: task.task_name,
            completion_type: "not_done",
            value: 0,
            date: dateStr,
            end_time: task.end_time ?? null,
            week_key: weekKeyOf(dateStr),
            month_key: dateStr.slice(0, 7),
            approval_status: "approved",
            scheduled_task_id: task.id,
          });
          if (outcome === "duplicate") continue;

          recorded.push({
            person,
            task_name: task.task_name,
            date: dateStr,
            end_time: task.end_time ?? null,
            completion_type: "not_done",
            scheduled_task_id: task.id,
          });
          createdFailures += 1;
          createdRows += 1;

          // Only yesterday's: catching up on a long absence would otherwise
          // fire off dozens of notifications at once.
          if (dateStr === yesterdayStr && !dryRun) {
            await notifyParents(
              "❌ Tarefa não feita",
              `${person} não completou: ${task.task_name} (ontem)`,
              `missed-${person}-${task.task_name}-${task.end_time || ""}-${dateStr}`,
            );
          }
        }
      }

      // ── Delegations accepted and then dropped ───────────────────────────
      // Nobody used to pay for these: the delegator is skipped above (they
      // handed it off) and the acceptor was never checked, because the routine
      // still belongs to the delegator. It costs a double failure.
      for (const d of delegations) {
        if (d.status !== "accepted" || d.to_person !== person) continue;
        if (!d.task_date || d.task_date >= todayStr) continue;
        // Outside the snapshot we cannot tell whether it was delivered.
        if (d.task_date < snapshotFrom) continue;
        if (lastCleanup && d.task_date <= lastCleanup) continue;
        if (isDelegationWaived(d, cancellations)) continue;
        if (hasRecord(d.task_date, delegationOccurrence(d))) continue;

        const outcome = await recordFailure({
          person,
          task_name: d.task_name,
          completion_type: "not_done",
          value: 0,
          date: d.task_date,
          end_time: d.end_time ?? null,
          week_key: weekKeyOf(d.task_date),
          month_key: d.task_date.slice(0, 7),
          approval_status: "approved",
          failure_weight: BROKEN_DELEGATION_WEIGHT,
          delegation_id: d.id,
        });
        if (outcome === "duplicate") continue;

        recorded.push({
          person,
          task_name: d.task_name,
          date: d.task_date,
          end_time: d.end_time ?? null,
          completion_type: "not_done",
          delegation_id: d.id,
        });
        createdFailures += BROKEN_DELEGATION_WEIGHT;
        createdRows += 1;

        if (!dryRun) await notifyParents(
          "🤝 Delegação não cumprida",
          `${person} aceitou "${d.task_name}" de ${d.from_person} e não fez (vale 2 falhas)`,
          `broken-delegation-${d.id}`,
        );
      }

      // Everything above went through, so these days never need checking
      // again. If this write fails the next run simply repeats the same range,
      // which is harmless: existing rows are detected and the unique index
      // refuses duplicates anyway.
      if (!dryRun) {
        const { error: checkpointWriteErr } = await supabase
          .from("missed_check_log")
          .upsert({ person, checked_through: yesterdayStr, updated_at: new Date().toISOString() }, { onConflict: "person" });
        if (checkpointWriteErr) {
          console.error(`mark-missed-tasks: could not advance checkpoint for ${person}`, checkpointWriteErr);
        }
      }

      // Tell the parents once, when this run pushes the child over the line.
      if (!dryRun && beforeFailures < FAILURE_THRESHOLD && beforeFailures + createdFailures >= FAILURE_THRESHOLD) {
        await notifyParents(
          `⚠️ ${person} chegou às ${FAILURE_THRESHOLD} falhas`,
          `Já podes aplicar o castigo: ${PENALTIES[person] || "castigo"}`,
          `penalty-threshold-${person}-${yesterdayStr}`,
        );
      }

      summary[person] = createdRows;
      totalCreated += createdRows;
    }

    console.log("[mark-missed-tasks]", JSON.stringify({ todayStr, yesterdayStr, summary }));

    return new Response(
      JSON.stringify({
        checked_through: yesterdayStr,
        created: totalCreated,
        by_person: summary,
        ...(dryRun ? { dry_run: true, would_create: wouldCreate } : {}),
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  } catch (err) {
    console.error("mark-missed-tasks failed:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  }
});
