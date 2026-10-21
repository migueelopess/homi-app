import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-client-info, apikey",
};

function lisbonHour(now: Date): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Lisbon",
    hour: "2-digit",
    hour12: false,
  });
  return parseInt(fmt.format(now), 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    let force = false;
    try {
      const body = await req.json();
      force = body?.force === true;
    } catch {
      // no body — cron call
    }

    // The cron schedule fires at 21:00 and 22:00 UTC to cover both DST windows
    // for Europe/Lisbon. Only act when local time is 22:00.
    if (!force) {
      const hour = lisbonHour(new Date());
      if (hour !== 22) {
        return new Response(
          JSON.stringify({ skipped: true, reason: `Lisbon hour is ${hour}` }),
          { headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());

    // Besides photos to approve: today's requests for help nobody has taken
    // (still open — undecided, they are waived overnight) and requests for
    // more time not yet answered (they lapse with the day).
    const [tasksRes, helpRes, timeRes] = await Promise.all([
      supabase.from("tasks").select("id, person").eq("approval_status", "pending"),
      supabase.from("task_delegations").select("id").eq("status", "pending").eq("task_date", today),
      supabase.from("extension_requests").select("id").eq("status", "pending").eq("task_date", today),
    ]);
    if (tasksRes.error) throw tasksRes.error;
    if (helpRes.error) throw helpRes.error;
    if (timeRes.error) throw timeRes.error;

    const pending = tasksRes.data ?? [];
    const total = pending.length;
    const help = helpRes.data?.length ?? 0;
    const time = timeRes.data?.length ?? 0;
    if (total === 0 && help === 0 && time === 0) {
      return new Response(
        JSON.stringify({ sent: false, reason: "nothing pending" }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const counts: Record<string, number> = {};
    for (const t of pending) {
      counts[t.person] = (counts[t.person] ?? 0) + 1;
    }

    const breakdown = Object.entries(counts)
      .map(([person, n]) => `${n} ${person}`)
      .join(", ");

    const parts: string[] = [];
    if (total > 0) parts.push(`${total} ${total === 1 ? "tarefa pendente" : "tarefas pendentes"} (${breakdown})`);
    if (help > 0) parts.push(`${help} ${help === 1 ? "pedido de ajuda sem ninguém" : "pedidos de ajuda sem ninguém"}`);
    if (time > 0) parts.push(`${time} ${time === 1 ? "pedido de mais tempo" : "pedidos de mais tempo"}`);
    const body = `${parts.join(" · ")}. Toca para rever.`;

    const { error: pushError } = await supabase.functions.invoke(
      "send-push-notification",
      {
        body: {
          person: "__parents__",
          title: "📋 Hora de aprovar",
          body,
          url: "/parents",
          tag: "daily-approval-summary",
        },
      }
    );

    if (pushError) {
      console.error("[daily-approval-summary] push error:", pushError);
    }

    return new Response(
      JSON.stringify({ sent: true, total, counts, help, time }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (err) {
    console.error("[daily-approval-summary] error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
});
