import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { planPurge, type DelegationRow, type TaskRow } from "./plan.ts";

// Paying is the cleanup: called by the app right after the parents record a
// payment, it deletes what that payment settled — the rows, their photos, and
// the day-only data around them — so nobody has to press "Limpeza" to free
// space. Also runs every night as a safety net (an app that lost its connection
// right after paying), which is harmless: a second pass finds nothing.
//
// What is deleted and what is kept is decided in ./plan.ts. Body:
//   { persons?: string[], dry_run?: boolean }   — persons defaults to everyone

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Kept in step with src/lib/taskHelpers.js
const PEOPLE = ["Inês", "Pedro", "Miguel"];
// The overnight broken-delegation check looks back 30 days; a little margin.
const DELEGATION_LOOKBACK_DAYS = 35;
// Reminders, extensions and push de-duplication keys only matter on the day.
const DAY_DATA_KEEP_DAYS = 7;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};

function lisbonToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The monthly delegation prize for last month is only awarded once someone
// opens the app in the new month, so last month's delegations must survive at
// least until then.
function protectFrom(today: string): string {
  const lookback = addDays(today, -DELEGATION_LOOKBACK_DAYS);
  const [y, m] = today.split("-").map(Number);
  const prevMonthStart = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  return lookback < prevMonthStart ? lookback : prevMonthStart;
}

function photoPath(url: string | null): string | null {
  if (!url) return null;
  const marker = "/task-photos/";
  const i = url.indexOf(marker);
  return i === -1 ? null : url.substring(i + marker.length);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });

  try {
    let body: { persons?: string[]; dry_run?: boolean } = {};
    try { body = await req.json(); } catch { /* cron call, no body */ }
    const dryRun = body.dry_run === true;
    const persons = (body.persons?.length ? body.persons : PEOPLE).filter((p) => PEOPLE.includes(p));

    const today = lisbonToday();
    const keepDelegationsFrom = protectFrom(today);

    const { data: payments, error: payErr } = await supabase.from("payments").select("person, paid_at");
    if (payErr) throw payErr;
    const lastPaidAt: Record<string, string> = {};
    for (const p of payments ?? []) {
      if (p.paid_at && (!lastPaidAt[p.person] || p.paid_at > lastPaidAt[p.person])) lastPaidAt[p.person] = p.paid_at;
    }

    const summary: Record<string, { tarefas: number; ajustes: number; bonus: number; fotos: number }> = {};
    const toDelete: number[] = [];
    const photos: string[] = [];

    for (const person of persons) {
      if (!lastPaidAt[person]) continue;

      const [{ data: rows, error: rowsErr }, { data: delegations, error: delErr }] = await Promise.all([
        supabase.from("tasks")
          .select("id, person, task_name, date, end_time, week_key, completion_type, approval_status, approved_at, created_date, delegation_id, scheduled_task_id, occasional_task_id, photo_url")
          .eq("person", person),
        supabase.from("task_delegations")
          .select("id, to_person, status, task_name, task_date, end_time")
          .eq("to_person", person).eq("status", "accepted"),
      ]);
      if (rowsErr) throw rowsErr;
      if (delErr) throw delErr;

      const plan = planPurge((rows ?? []) as TaskRow[], (delegations ?? []) as DelegationRow[],
        lastPaidAt[person], keepDelegationsFrom);
      const all = [...plan.chores, ...plan.adjustments, ...plan.bonuses];
      for (const r of all) toDelete.push(r.id);
      const personPhotos = all.map((r) => photoPath(r.photo_url)).filter((p): p is string => !!p);
      photos.push(...personPhotos);
      summary[person] = {
        tarefas: plan.chores.length, ajustes: plan.adjustments.length,
        bonus: plan.bonuses.length, fotos: personPhotos.length,
      };
    }

    const dayCutoff = addDays(today, -DAY_DATA_KEEP_DAYS);

    if (dryRun) {
      return new Response(JSON.stringify({ dry_run: true, keep_delegations_from: keepDelegationsFrom, por_pessoa: summary,
        tarefas_a_apagar: toDelete.length, fotos_a_apagar: photos.length, dados_do_dia_antes_de: dayCutoff }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // 1. The rows. Photos only after the rows are gone: a photo without a row
    //    is harmless clutter, a row whose photo was deleted is a broken image.
    for (let i = 0; i < toDelete.length; i += 200) {
      const { error } = await supabase.from("tasks").delete().in("id", toDelete.slice(i, i + 200));
      if (error) throw error;
    }

    // 2. Their photos — never one that a remaining row still points at.
    let photosDeleted = 0;
    if (photos.length) {
      const { data: stillUsed } = await supabase.from("tasks").select("photo_url").not("photo_url", "is", null);
      const inUse = new Set((stillUsed ?? []).map((r) => photoPath(r.photo_url)));
      const free = photos.filter((p) => !inUse.has(p));
      for (let i = 0; i < free.length; i += 100) {
        const { data, error } = await supabase.storage.from("task-photos").remove(free.slice(i, i + 100));
        if (error) console.error("purge-paid: photo batch failed", error);
        else photosDeleted += data?.length ?? 0;
      }
    }

    // 3. Day-only data past its use, and finished occasional tasks nothing
    //    refers to any more. Global and idempotent — safe on every run.
    const del = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
      const { count, error } = await q;
      if (error) console.error("purge-paid:", error);
      return count ?? 0;
    };
    const reminders = await del(supabase.from("task_reminders").delete({ count: "exact" }).lt("task_date", dayCutoff));
    const extensions = await del(supabase.from("task_extensions").delete({ count: "exact" }).lt("task_date", dayCutoff));
    const pushKeys = await del(supabase.from("sent_push_notifications").delete({ count: "exact" })
      .lt("sent_at", `${dayCutoff}T00:00:00Z`));

    let occasional = 0;
    const { data: doneOcc } = await supabase.from("occasional_tasks").select("id")
      .eq("completed", true).lt("date", today);
    if (doneOcc?.length) {
      const ids = doneOcc.map((o) => o.id);
      const [{ data: refT }, { data: refD }] = await Promise.all([
        supabase.from("tasks").select("occasional_task_id").in("occasional_task_id", ids),
        supabase.from("task_delegations").select("occasional_task_id").in("occasional_task_id", ids),
      ]);
      const referenced = new Set([...(refT ?? []), ...(refD ?? [])].map((r) => r.occasional_task_id));
      const unreferenced = ids.filter((id) => !referenced.has(id));
      if (unreferenced.length) {
        occasional = await del(supabase.from("occasional_tasks").delete({ count: "exact" }).in("id", unreferenced));
      }
    }

    const result = {
      por_pessoa: summary, tarefas_apagadas: toDelete.length, fotos_apagadas: photosDeleted,
      lembretes: reminders, prolongamentos: extensions, marcas_push: pushKeys, ocasionais: occasional,
    };
    console.log("[purge-paid]", JSON.stringify(result));
    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json", ...corsHeaders } });
  } catch (err) {
    console.error("purge-paid failed:", err);
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
});
