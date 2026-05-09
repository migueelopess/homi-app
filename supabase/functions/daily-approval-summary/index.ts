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

    const { data: pending, error } = await supabase
      .from("tasks")
      .select("id, person")
      .eq("approval_status", "pending");

    if (error) throw error;

    const total = pending?.length ?? 0;
    if (total === 0) {
      return new Response(
        JSON.stringify({ sent: false, reason: "no pending tasks" }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const counts: Record<string, number> = {};
    for (const t of pending!) {
      counts[t.person] = (counts[t.person] ?? 0) + 1;
    }

    const breakdown = Object.entries(counts)
      .map(([person, n]) => `${n} ${person}`)
      .join(", ");

    const body = `${total} ${total === 1 ? "tarefa pendente" : "tarefas pendentes"} (${breakdown}). Toca para rever.`;

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
      JSON.stringify({ sent: true, total, counts }),
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
