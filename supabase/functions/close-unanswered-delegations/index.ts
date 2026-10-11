import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Closes requests for help that no sibling accepted within the hour, and asks
// the parents to decide.
//
// A child delegates a task they cannot do; siblings have one hour to take it.
// When nobody does, the request moves to `unanswered` and the parents are told
// — they then either cancel the task (no failure) or decide it was the child's
// to do after all (see src/components/parents/UnansweredDelegations.jsx).
//
// Runs from pg_cron every 10 minutes, but the cron command only calls this when
// a pending request is already past its hour, so most ticks never get here.
// Kept in step with DELEGATION_ACCEPT_WINDOW_MINUTES in src/lib/taskHelpers.js.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const ACCEPT_WINDOW_MINUTES = 60;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};

type Delegation = {
  id: string;
  from_person: string;
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

// Did the child end up doing it themselves within the hour? Then nobody needs
// to decide anything. Matched on the occurrence's identity, with the old
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

    const cutoff = new Date(Date.now() - ACCEPT_WINDOW_MINUTES * 60 * 1000).toISOString();

    const { data: overdue, error } = await supabase
      .from("task_delegations")
      .select("id, from_person, task_type, scheduled_task_id, occasional_task_id, task_name, task_date, end_time")
      .eq("status", "pending")
      .lt("created_at", cutoff);
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

    // Each update re-checks `pending`, so a sibling accepting in the very last
    // second wins and the request is simply left alone.
    const closed: Delegation[] = [];
    for (const d of unanswered) {
      const { data: row } = await supabase
        .from("task_delegations")
        .update({ status: "unanswered", closed_at: now })
        .eq("id", d.id).eq("status", "pending")
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
      await push(
        "__parents__",
        `🙋 ${d.from_person} precisa de uma decisão`,
        `${d.from_person} não consegue fazer "${d.task_name}"${when} e nenhum irmão aceitou. Cancelas a tarefa ou tinha de a fazer?`,
        "/pais",
        `delegation-unanswered-${d.id}`,
      );
      await push(
        d.from_person,
        `⌛ Ninguém aceitou: ${d.task_name}`,
        "Passou a hora e nenhum irmão aceitou. Os pais vão decidir se a cancelam.",
        "/",
        `delegation-unanswered-${d.id}`,
      );
    }

    console.log("[close-unanswered-delegations]", JSON.stringify({
      closed: closed.map((d) => d.id), done_anyway: doneAnyway.map((d) => d.id),
    }));

    return new Response(JSON.stringify({ closed: closed.length, done_anyway: doneAnyway.length }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } });
  } catch (err) {
    console.error("close-unanswered-delegations failed:", err);
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
});
