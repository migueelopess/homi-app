import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Tells the parents about requests for help nobody has accepted after 3 hours.
//
// A child delegates a task they cannot do; siblings can accept it any time
// that day. After 3 hours with no "yes" — or from 22:00, for a request made
// late — the parents are told (`parents_notified_at`) and can cancel the task
// or decide it was the child's to do after all (see
// src/components/parents/UnansweredDelegations.jsx). The request stays open
// meanwhile: telling the parents no longer closes it to the siblings, which is
// what it used to do. One left open at the end of the day is waived by
// mark-missed-tasks. (The name is from when this closed requests.)
//
// Runs from pg_cron every 10 minutes, but the cron command only calls this when
// such a request exists, so most ticks never get here. Kept in step with
// DELEGATION_PARENTS_NOTICE_MINUTES in src/lib/taskHelpers.js, and with the
// cron gate (migration 028).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const NOTICE_MINUTES = 180;
// From this hour every open request of the day is told to the parents, so one
// made in the evening still reaches them before the day ends.
const LATE_HOUR = 22;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};

// Kept in step with PEOPLE in src/lib/taskHelpers.js
const PEOPLE = ["Inês", "Pedro", "Miguel"];

type Delegation = {
  id: string;
  from_person: string;
  refused_by: string[] | null;
  task_type: string;
  scheduled_task_id: number | null;
  occasional_task_id: number | null;
  task_name: string;
  task_date: string;
  end_time: string | null;
};

async function push(person: string, title: string, body: string, url: string, tag: string) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-push-notification`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ person, title, body, url, tag }),
    });
  } catch (err) {
    // A notification that fails must never stop the requests being closed.
    console.error("close-unanswered-delegations: push failed", err);
  }
}

// Did the child end up doing it themselves? Then nobody needs to decide
// anything. Matched on the occurrence's identity, with the old
// name + deadline fallback for rows written before identities existed.
async function wasDoneAnyway(d: Delegation): Promise<boolean> {
  const { data, error } = await supabase
    .from("tasks")
    .select("task_name, end_time, completion_type, scheduled_task_id, occasional_task_id, delegation_id")
    .eq("person", d.from_person)
    .eq("date", d.task_date);
  if (error) throw error;
  const key = d.task_type === "occasional" ? `o:${d.occasional_task_id}` : `s:${d.scheduled_task_id}`;
  return (data ?? []).some((t) => {
    if (t.completion_type === "not_done") return false;
    const rowKey = t.delegation_id ? `d:${t.delegation_id}`
      : t.occasional_task_id ? `o:${t.occasional_task_id}`
      : t.scheduled_task_id ? `s:${t.scheduled_task_id}` : null;
    if (rowKey) return rowKey === key;
    return t.task_name === d.task_name && (t.end_time ?? "") === (d.end_time ?? "");
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });

  try {
    let dryRun = false;
    try { dryRun = (await req.json())?.dry_run === true; } catch { /* cron call, no body */ }

    const cutoff = new Date(Date.now() - NOTICE_MINUTES * 60 * 1000).toISOString();
    const lisbon = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
    }).formatToParts(new Date());
    const part = (t: string) => lisbon.find((p) => p.type === t)?.value ?? "";
    const today = `${part("year")}-${part("month")}-${part("day")}`;
    const late = parseInt(part("hour"), 10) >= LATE_HOUR;

    let query = supabase
      .from("task_delegations")
      .select("id, from_person, refused_by, task_type, scheduled_task_id, occasional_task_id, task_name, task_date, end_time")
      .eq("status", "pending")
      .is("parents_notified_at", null)
      .eq("task_date", today);
    if (!late) query = query.lt("created_at", cutoff);
    const { data: overdue, error } = await query;
    if (error) throw error;

    const unanswered: Delegation[] = [];
    const doneAnyway: Delegation[] = [];
    for (const d of (overdue ?? []) as Delegation[]) {
      (await wasDoneAnyway(d) ? doneAnyway : unanswered).push(d);
    }

    if (dryRun) {
      return new Response(JSON.stringify({ dry_run: true, unanswered, done_anyway: doneAnyway }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const now = new Date().toISOString();

    // Each update re-checks `pending` and that nobody told the parents yet, so
    // a sibling accepting in the very last second wins, and the last sibling's
    // refusal (which tells the parents itself) is not announced twice.
    const closed: Delegation[] = [];
    for (const d of unanswered) {
      const { data: row } = await supabase
        .from("task_delegations")
        .update({ parents_notified_at: now })
        .eq("id", d.id).eq("status", "pending").is("parents_notified_at", null)
        .select("id").maybeSingle();
      if (row) closed.push(d);
    }
    for (const d of doneAnyway) {
      await supabase
        .from("task_delegations")
        .update({ status: "expired", closed_at: now })
        .eq("id", d.id).eq("status", "pending");
    }

    for (const d of closed) {
      const when = d.end_time ? ` (até às ${d.end_time})` : "";
      // When every sibling refused, the app told the parents at the last
      // refusal; the ones that reach this point had someone still silent.
      const refused = d.refused_by ?? [];
      const silent = PEOPLE.filter((p) => p !== d.from_person && !refused.includes(p));
      const answers = refused.length === 0
        ? "Nenhum irmão aceitou ainda"
        : silent.length === 0
          ? "Os irmãos recusaram"
          : `${refused.join(" e ")} recusou e ${silent.join(" e ")} ainda não respondeu`;
      await push(
        "__parents__",
        `🙋 ${d.from_person} precisa de uma decisão`,
        `${d.from_person} não consegue fazer "${d.task_name}"${when}. ${answers} (ainda podem aceitar). Cancelas a tarefa ou tinha de a fazer?`,
        "/pais",
        `delegation-unanswered-${d.id}`,
      );
      await push(
        d.from_person,
        `⌛ Ninguém aceitou ainda: ${d.task_name}`,
        "Os pais foram avisados. Os irmãos ainda podem aceitar — e se ninguém aceitar, não conta como falha.",
        "/",
        `delegation-unanswered-${d.id}`,
      );
    }

    console.log("[close-unanswered-delegations]", JSON.stringify({
      parents_told: closed.map((d) => d.id), done_anyway: doneAnyway.map((d) => d.id),
    }));

    return new Response(JSON.stringify({ parents_told: closed.length, done_anyway: doneAnyway.length }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } });
  } catch (err) {
    console.error("close-unanswered-delegations failed:", err);
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
});
