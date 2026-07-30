import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;

webpush.setVapidDetails(
  "mailto:tarefas@familia.pt",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// Same rule as the frontend's sameTaskSlot: a record with no end_time predates
// time-slot tracking and matches any occurrence of that task.
function sameTaskSlot(recordEndTime: string | null, taskEndTime: string | null): boolean {
  if (recordEndTime === null || recordEndTime === "") return true;
  return recordEndTime === (taskEndTime ?? "");
}

async function sendPushToSubscriptions(
  subscriptions: Array<{ id: string; endpoint: string; keys_p256dh: string; keys_auth: string }>,
  payload: string
) {
  let sent = 0;
  const expired: string[] = [];

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth } },
        payload
      );
      sent++;
    } catch (err: unknown) {
      const pushErr = err as { statusCode?: number };
      if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
        expired.push(sub.id);
      } else {
        console.error(`Push failed for ${sub.endpoint}:`, err);
      }
    }
  }

  if (expired.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", expired);
  }

  return { sent, expired: expired.length };
}

async function markAsSent(taskKey: string): Promise<boolean> {
  const { error } = await supabase
    .from("sent_push_notifications")
    .insert({ task_key: taskKey });

  // If duplicate key error, it was already sent
  if (error) {
    if (error.code === "23505") return false; // unique violation = already sent
    console.error("Error marking as sent:", error);
    return false;
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
      },
    });
  }

  try {
    // Current time in Portugal (Europe/Lisbon)
    const now = new Date();
    const ptFormatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Lisbon",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = ptFormatter.formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
    const todayStr = `${get("year")}-${get("month")}-${get("day")}`;
    const currentHour = parseInt(get("hour"));
    const currentMinute = parseInt(get("minute"));
    const currentTotalMinutes = currentHour * 60 + currentMinute;

    // Get Portugal day of week
    const ptDayFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Lisbon",
      weekday: "long",
    });
    const todayKey = ptDayFormatter.format(now).toLowerCase();

    console.log(`Checking reminders: ${todayStr} ${currentHour}:${currentMinute} (${todayKey})`);

    // 0. Expire pending delegations from past days
    const { data: expiredDelegations } = await supabase
      .from("task_delegations")
      .update({ status: "expired" })
      .eq("status", "pending")
      .lt("task_date", todayStr)
      .select("id");

    if (expiredDelegations && expiredDelegations.length > 0) {
      console.log(`Expired ${expiredDelegations.length} pending delegations from past days`);
    }

    // 0b. Fetch today's accepted delegations to redirect reminders
    const { data: todayDelegations } = await supabase
      .from("task_delegations")
      .select("*")
      .eq("task_date", todayStr)
      .eq("status", "accepted");

    const acceptedDelegations = todayDelegations || [];

    // 0c. Occurrences the parents waived for today. These must not produce any
    // reminder at all — the child was explicitly told they don't have to do it.
    const { data: todayCancellations } = await supabase
      .from("task_cancellations")
      .select("person, task_name, end_time")
      .eq("task_date", todayStr);

    const cancellations = todayCancellations || [];

    // A cancellation is recorded against whoever owned the occurrence, which
    // may be the delegator or the person who took it on — either way the
    // occurrence is off.
    const isCancelled = (
      taskName: string,
      endTime: string | null,
      ...people: Array<string | null>
    ) => cancellations.some(
      (c) =>
        c.task_name === taskName &&
        people.includes(c.person) &&
        sameTaskSlot(c.end_time, endTime)
    );

    // 1. Get all scheduled tasks for today's day of week
    const { data: scheduledTasks } = await supabase
      .from("scheduled_tasks")
      .select("*")
      .contains("days_of_week", [todayKey]);

    // 2. Get occasional tasks for today that aren't completed
    const { data: occasionalTasks } = await supabase
      .from("occasional_tasks")
      .select("*")
      .eq("date", todayStr)
      .eq("completed", false);

    // 3. Get today's recorded tasks. Keyed by time slot as well as name: the
    // same task can be scheduled twice in a day (e.g. a noon and an evening
    // "Máquina da louça"), and doing the noon one must not silence the evening
    // reminder.
    const { data: completedTasks } = await supabase
      .from("tasks")
      .select("person, task_name, date, end_time")
      .eq("date", todayStr);

    const recorded = completedTasks || [];
    const isRecorded = (person: string | null, taskName: string, endTime: string | null) =>
      recorded.some(
        (t) =>
          t.person === person &&
          t.task_name === taskName &&
          sameTaskSlot(t.end_time, endTime)
      );

    let totalSent = 0;

    // Process scheduled tasks
    for (const task of scheduledTasks || []) {
      if (!task.end_time || !task.person) continue;
      if (isRecorded(task.person, task.task_name, task.end_time)) continue;

      // Check if this task was delegated to someone else
      const delegation = acceptedDelegations.find(
        d => d.task_type === "scheduled" && d.scheduled_task_id === task.id && d.from_person === task.person
      );
      // If delegated and accepted, send reminder to the accepting person instead
      const targetPerson = delegation ? delegation.to_person : task.person;
      // Also skip if the accepting person already completed it
      if (delegation && isRecorded(targetPerson, task.task_name, task.end_time)) continue;

      // Parents waived this occurrence — nobody should be nagged about it.
      if (isCancelled(task.task_name, task.end_time, task.person, targetPerson)) continue;

      const [h, m] = task.end_time.split(":").map(Number);
      const deadlineMinutes = h * 60 + m;
      const minutesUntilDeadline = deadlineMinutes - currentTotalMinutes;

      // 15 minutes before reminder (window: 10-15 min before)
      if (minutesUntilDeadline >= 10 && minutesUntilDeadline <= 15) {
        const key = `scheduled:${task.id}:${todayStr}:reminder`;
        if (await markAsSent(key)) {
          const { data: subs } = await supabase
            .from("push_subscriptions")
            .select("*")
            .eq("person", targetPerson);

          if (subs && subs.length > 0) {
            const result = await sendPushToSubscriptions(
              subs,
              JSON.stringify({
                title: `⏰ Lembra-te: ${task.task_name}`,
                body: `Tens 15 minutos para completar esta tarefa!${delegation ? ` (delegada por ${task.person})` : ""}`,
                url: "/",
                tag: `reminder-${task.id}`,
              })
            );
            totalSent += result.sent;
          }
        }
      }

      // At deadline (window: 0-5 min after)
      if (minutesUntilDeadline >= -5 && minutesUntilDeadline <= 0) {
        const key = `scheduled:${task.id}:${todayStr}:deadline`;
        if (await markAsSent(key)) {
          const { data: subs } = await supabase
            .from("push_subscriptions")
            .select("*")
            .eq("person", targetPerson);

          if (subs && subs.length > 0) {
            const result = await sendPushToSubscriptions(
              subs,
              JSON.stringify({
                title: `⚠️ Prazo: ${task.task_name}`,
                body: `O prazo para esta tarefa terminou!${delegation ? ` (delegada por ${task.person})` : ""}`,
                url: "/",
                tag: `deadline-${task.id}`,
              })
            );
            totalSent += result.sent;
          }
        }
      }
    }

    // Process occasional tasks
    for (const task of occasionalTasks || []) {
      if (!task.end_time || !task.person) continue;

      // Check if this task was delegated to someone else
      const delegation = acceptedDelegations.find(
        d => d.task_type === "occasional" && d.occasional_task_id === task.id && d.from_person === task.person
      );
      const targetPerson = delegation ? delegation.to_person : task.person;

      // Parents waived this occurrence — nobody should be nagged about it.
      if (isCancelled(task.task_name, task.end_time, task.person, targetPerson)) continue;

      const [h, m] = task.end_time.split(":").map(Number);
      const deadlineMinutes = h * 60 + m;
      const minutesUntilDeadline = deadlineMinutes - currentTotalMinutes;

      // 15 minutes before
      if (minutesUntilDeadline >= 10 && minutesUntilDeadline <= 15) {
        const key = `occasional:${task.id}:${todayStr}:reminder`;
        if (await markAsSent(key)) {
          const { data: subs } = await supabase
            .from("push_subscriptions")
            .select("*")
            .eq("person", targetPerson);

          if (subs && subs.length > 0) {
            const result = await sendPushToSubscriptions(
              subs,
              JSON.stringify({
                title: `⏰ Lembra-te: ${task.task_name}`,
                body: `Tens 15 minutos para completar esta tarefa especial!`,
                url: "/",
                tag: `reminder-occ-${task.id}`,
              })
            );
            totalSent += result.sent;
          }
        }
      }

      // At deadline
      if (minutesUntilDeadline >= -5 && minutesUntilDeadline <= 0) {
        const key = `occasional:${task.id}:${todayStr}:deadline`;
        if (await markAsSent(key)) {
          const { data: subs } = await supabase
            .from("push_subscriptions")
            .select("*")
            .eq("person", targetPerson);

          if (subs && subs.length > 0) {
            const result = await sendPushToSubscriptions(
              subs,
              JSON.stringify({
                title: `⚠️ Prazo: ${task.task_name}`,
                body: `O prazo para esta tarefa especial terminou!`,
                url: "/",
                tag: `deadline-occ-${task.id}`,
              })
            );
            totalSent += result.sent;
          }
        }
      }
    }

    // Cleanup old sent records (older than 3 days)
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from("sent_push_notifications")
      .delete()
      .lt("sent_at", threeDaysAgo);

    console.log(`Done. Sent ${totalSent} notifications.`);

    return new Response(
      JSON.stringify({ checked: true, sent: totalSent }),
      { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }
});
