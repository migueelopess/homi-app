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

// Kept in step with src/lib/taskHelpers.js
const CARRYOVER_TASK_NAME = "Saldo transitado";
const ADJUSTMENT_COMPLETION_TYPE = "adjustment";

// ISO-8601 week of a "YYYY-MM-DD" date, anchored at UTC noon — the same
// arithmetic as mark-missed-tasks, verified there against the app day by day.
function weekKeyOf(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const dayIdx = (d.getUTCDay() + 6) % 7;
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() - dayIdx + 3);
  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4, 12));
  const ftIdx = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftIdx + 3);
  const week = Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 86400000)) + 1;
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    // Parse body to check for clean_all mode (manual button)
    let cleanAll = false;
    try {
      const body = await req.json();
      cleanAll = body?.clean_all === true;
    } catch {
      // No body or invalid JSON — default to automatic mode
    }

    // Automatic mode: cutoff = 1st of current month
    // Manual mode (clean_all): no cutoff, delete everything
    const now = new Date();
    const ptFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Lisbon",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = ptFormatter.formatToParts(now);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value || "";
    const year = get("year");
    const month = get("month");
    const todayStr = `${year}-${month}-${get("day")}`;
    const cutoffDate = cleanAll ? "9999-12-31" : `${year}-${month}-01`;
    const mode = cleanAll ? "manual (all)" : "automatic";

    console.log(`[monthly-cleanup] Mode: ${mode}, Cutoff date: ${cutoffDate}`);

    const summary = {
      mode,
      cutoff_date: cutoffDate,
      deleted_tasks: 0,
      deleted_photos: 0,
      deleted_occasional_tasks: 0,
      deleted_reminders: 0,
      deleted_notifications: 0,
      deleted_delegations: 0,
      deleted_cancellations: 0,
      deleted_extensions: 0,
      carried_over: {} as Record<string, number>,
    };

    // 1. Fetch tasks to delete (to get photo URLs before deleting)
    const { data: oldTasks, error: fetchErr } = await supabase
      .from("tasks")
      .select("id, photo_url, person, value, approval_status, created_date")
      .lt("date", cutoffDate);

    if (fetchErr) {
      console.error("Error fetching old tasks:", fetchErr);
      throw fetchErr;
    }

    // 2. Delete photos from storage bucket (in batches of 100)
    if (oldTasks && oldTasks.length > 0) {
      const photoUrls = oldTasks
        .map((t) => t.photo_url)
        .filter((url): url is string => !!url);

      if (photoUrls.length > 0) {
        const filePaths = photoUrls
          .map((url) => {
            const marker = "/task-photos/";
            const idx = url.indexOf(marker);
            if (idx === -1) return null;
            return url.substring(idx + marker.length);
          })
          .filter((p): p is string => !!p);

        for (let i = 0; i < filePaths.length; i += 100) {
          const batch = filePaths.slice(i, i + 100);
          const { error: storageErr } = await supabase.storage
            .from("task-photos")
            .remove(batch);

          if (storageErr) {
            console.error(`Error deleting photo batch ${i}:`, storageErr);
          } else {
            summary.deleted_photos += batch.length;
          }
        }
      }

      // What is still owed to — or, after a fine, by — each child among the
      // rows about to go. Counted exactly like the app's "A Pagar": decided
      // (approved, or from before approvals existed) and created after the
      // child's last payment. Rows still awaiting a decision are not money yet.
      const { data: payments, error: payErr } = await supabase
        .from("payments")
        .select("person, paid_at");
      if (payErr) throw payErr;
      const lastPaidAt: Record<string, string> = {};
      for (const p of payments ?? []) {
        if (p.paid_at && (!lastPaidAt[p.person] || p.paid_at > lastPaidAt[p.person])) {
          lastPaidAt[p.person] = p.paid_at;
        }
      }
      const balance: Record<string, number> = {};
      for (const t of oldTasks) {
        const decided = !t.approval_status || t.approval_status === "approved";
        if (!decided) continue;
        const paid = lastPaidAt[t.person] && t.created_date &&
          new Date(t.created_date) <= new Date(lastPaidAt[t.person]);
        if (paid) continue;
        balance[t.person] = (balance[t.person] ?? 0) + Number(t.value || 0);
      }

      // 3. Delete tasks
      const { error: deleteTasksErr, count } = await supabase
        .from("tasks")
        .delete({ count: "exact" })
        .lt("date", cutoffDate);

      if (deleteTasksErr) {
        console.error("Error deleting old tasks:", deleteTasksErr);
      } else {
        summary.deleted_tasks = count || 0;

        // 3b. Carry each unpaid balance over as a single row, so the cleanup
        // can never wipe out money — least of all a child's debt after a fine,
        // which would otherwise just disappear with the rows that made it up.
        const carry = Object.entries(balance)
          .map(([person, amount]) => [person, Math.round(amount * 100) / 100] as const)
          .filter(([, amount]) => Math.abs(amount) >= 0.01);
        if (carry.length > 0) {
          const { error: carryErr } = await supabase.from("tasks").insert(
            carry.map(([person, amount]) => ({
              person,
              task_name: CARRYOVER_TASK_NAME,
              completion_type: ADJUSTMENT_COMPLETION_TYPE,
              value: amount,
              date: todayStr,
              end_time: null,
              week_key: weekKeyOf(todayStr),
              month_key: todayStr.slice(0, 7),
              approval_status: "approved",
            })),
          );
          if (carryErr) {
            console.error("Error carrying balances over:", carryErr);
          } else {
            for (const [person, amount] of carry) summary.carried_over[person] = amount;
          }
        }
      }
    }

    // 4. Delete occasional tasks (completed OR past date)
    const { error: deleteOccErr, count: occCount } = await supabase
      .from("occasional_tasks")
      .delete({ count: "exact" })
      .or(`completed.eq.true,date.lt.${cutoffDate}`);

    if (deleteOccErr) {
      console.error("Error deleting occasional tasks:", deleteOccErr);
    } else {
      summary.deleted_occasional_tasks = occCount || 0;
    }

    // 5. Delete task reminders
    const { error: deleteRemErr, count: remCount } = await supabase
      .from("task_reminders")
      .delete({ count: "exact" })
      .lt("task_date", cutoffDate);

    if (deleteRemErr) {
      console.error("Error deleting reminders:", deleteRemErr);
    } else {
      summary.deleted_reminders = remCount || 0;
    }

    // 6. Delete sent push notifications
    const { error: deleteNotifErr, count: notifCount } = await supabase
      .from("sent_push_notifications")
      .delete({ count: "exact" })
      .lt("sent_at", cutoffDate);

    if (deleteNotifErr) {
      console.error("Error deleting notifications:", deleteNotifErr);
    } else {
      summary.deleted_notifications = notifCount || 0;
    }

    // 7. Per-occurrence rows keyed by task_date. None of these carry any
    // meaning into the next month once their tasks are gone — a delegation,
    // a parent-waived cancellation or a granted extension only ever applied
    // to a specific day. In manual (clean_all) mode the 9999 cutoff wipes
    // them all; in monthly mode anything dated before this month goes and
    // in-flight current/future rows are kept.
    const { error: deleteDelegErr, count: delegCount } = await supabase
      .from("task_delegations")
      .delete({ count: "exact" })
      .lt("task_date", cutoffDate);

    if (deleteDelegErr) {
      console.error("Error deleting delegations:", deleteDelegErr);
    } else {
      summary.deleted_delegations = delegCount || 0;
    }

    const { error: deleteCancelErr, count: cancelCount } = await supabase
      .from("task_cancellations")
      .delete({ count: "exact" })
      .lt("task_date", cutoffDate);

    if (deleteCancelErr) {
      console.error("Error deleting cancellations:", deleteCancelErr);
    } else {
      summary.deleted_cancellations = cancelCount || 0;
    }

    const { error: deleteExtErr, count: extCount } = await supabase
      .from("task_extensions")
      .delete({ count: "exact" })
      .lt("task_date", cutoffDate);

    if (deleteExtErr) {
      console.error("Error deleting extensions:", deleteExtErr);
    } else {
      summary.deleted_extensions = extCount || 0;
    }

    // 8. Log the cleanup date so all devices know the boundary
    const todayPt = `${year}-${month}-${get("day")}`;
    await supabase.from("cleanup_log").insert({ cleaned_at: todayPt });

    console.log("[monthly-cleanup] Summary:", JSON.stringify(summary));

    return new Response(JSON.stringify(summary), {
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (err) {
    console.error("[monthly-cleanup] Error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }
});
