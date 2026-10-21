# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this app is

**Homi** — a family tasks & rewards app. Kids complete tasks; parents approve or reject them; balances, earnings and rankings update in real time. UI copy and domain terms are in **Portuguese** (Tarefas, Rotinas, Delegar, Ranking); code and comments are mostly English.

## Commands

```bash
npm run dev        # Vite dev server → http://localhost:5173
npm run build      # production build
npm run preview    # preview production build
npm run lint       # ESLint (quiet)
npm run lint:fix   # ESLint --fix
npm run typecheck  # tsc checkJs via jsconfig.json
npm test           # logic checks (plain node, no framework)
```

`npm test` covers the rules that decide money and punishment — which occurrence
a photo settles, when a chore counts as on time, which day and week it belongs
to — plus two structural invariants: no page may declare its own read query key
(they live in [src/lib/queries.js](src/lib/queries.js)), and every cache
invalidation must go through a shared prefix. There is no component or
integration testing; verify UI changes by running `npm run dev` and exercising
the flow.

## Environment

`.env.local` holds three public frontend vars, pulled from Vercel (`npx vercel env pull .env.local`):
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`. It is gitignored — never commit it.

## Architecture

- **Frontend:** React 18 + Vite 6, React Router, TanStack Query for server state.
- **Backend:** Supabase (Postgres + Auth + Edge Functions) on the **free plan's Nano instance — 426 MB of RAM** shared by Postgres, PostgREST, auth and storage. That is the binding constraint on everything below. Project ref `yjnyznhqheerjpqprggm`.
- **Data access:** All Supabase calls go through the service objects in [src/api/entities.js](src/api/entities.js) — `TaskService`, `ScheduledTaskService`, `OccasionalTaskService`, `TaskReminderService`, `TaskDelegationService`, `TaskExtensionService`, `ExtensionRequestService`, `TaskCancellationService`, `PaymentService`, `CleanupLogService`. Add DB access here, not inline in components.
- **Tables:** `tasks`, `scheduled_tasks`, `occasional_tasks`, `task_reminders`, `task_delegations`, `task_extensions`, `extension_requests`, `task_cancellations`, `payments`, `cleanup_log` (+ push subscription tables).
- **Auth:** [src/lib/AuthContext.jsx](src/lib/AuthContext.jsx) provides `AuthProvider` / `useAuth`. `App.jsx` gates routes on `isAuthenticated`.
- **Freshness:** polling, not Realtime. Everything refetches on opening or returning to the app if older than 2 minutes; while the app stays open only tasks, pending approvals, delegations and requests for more time poll, every 60 s, and nothing polls in the background (see [src/lib/query-client.js](src/lib/query-client.js) and `LIVE_INTERVAL_MS` in [src/lib/queries.js](src/lib/queries.js)). Realtime `postgres_changes` was removed in September 2026: on the Nano instance it cost ~43% of all database time plus a logical-replication decoder, the box lived in swap, and the 19:00 deadline rush produced 20-30 s stalls and "database timeout"s. `npm test` fails if a `postgres_changes` subscription is re-added. Only bring it back together with a compute upgrade.
- **Push:** `sendPushNotification()` in [src/api/supabaseClient.js](src/api/supabaseClient.js) invokes the `send-push-notification` edge function.

## Conventions

- `@/` import alias → `src/` (configured in `jsconfig.json` and `vite.config.js`).
- **`src/pages.config.js` is auto-generated** — do not edit it except the `mainPage` value. Pages are auto-registered from files in `src/pages/`.
- UI is shadcn/ui: primitives live in `src/components/ui/` (generally leave these alone; they're generated). Feature components live in `src/components/{home,layout,parents,register,notifications,delegations}/`.
- Task approval flow: a task has `approval_status` (`pending`/`approved`/`rejected`). Rejection sets `value: 0` and `completion_type: 'not_done'` so earnings/failure logic flows naturally — see comments in `entities.js`.
- ESLint targets `src/pages/**` and `src/components/**` (excluding `components/ui`); `src/lib`, `src/api` are excluded from lint but type-checked selectively via jsconfig.

## Backend workflow (Supabase CLI)

Edge functions are in `supabase/functions/`; schema changes as ordered SQL in `supabase-migrations/`.

```bash
npx supabase functions deploy <name>   # deploy one edge function
```

Three functions run on `pg_cron` (jobs live in `cron.job`):

| Function | Schedule | What it does |
| --- | --- | --- |
| `check-task-reminders` | `*/15 7-23 * * *`, gated | 30/15-minute and deadline push notifications |
| `mark-missed-tasks` | `10 0,1,9,15 * * *` | waives past-day requests for help nobody took (`auto_cancelled`), then records undone scheduled tasks as `not_done` |
| `daily-approval-summary` | `0 21,22 * * *` | nudges parents about tasks still awaiting approval |
| `purge-cron-history` | `20 3 * * *` | trims `cron.job_run_details` to 7 days |
| `drop-idle-realtime-slot` | `40 * * * *` | drops Realtime's wal2json slot if inactive and holding > 64 MB of WAL |
| `close-unanswered-delegations` | `*/10 * * * *`, gated | tells the parents about delegation requests nobody accepted after 3 hours (from 22:00, any still open); the request stays open |
| `purge-paid` | `30 3 * * *` (+ after every payment) | deletes what a payment settled: paid rows, their photos, day-only data |

`check-task-reminders` ticks every 15 minutes, 07:00-23:59 UTC (deadlines from
08:30 to 23:30 Lisbon time, summer and winter), and the cron command only calls
the function when some scheduled or occasional task is due between 14 minutes
ago and 30 minutes from now — see [supabase-migrations/023_reminder_gate.sql](supabase-migrations/023_reminder_gate.sql).
At a 5-minute, ungated cadence it ran 2016 times a week and 29 of those sent
anything. The function's three reminder windows are each 15 minutes wide to
match; if you change the cadence, change those windows and the gate together.
A task due outside 08:30-23:30 gets no push reminder (the in-app one still fires
while the app is open).

Delegations have a lifecycle (`task_delegations.status`, documented next to
`DELEGATION_STATUS` in [src/lib/taskHelpers.js](src/lib/taskHelpers.js)). A
request stays `pending` — acceptable by any sibling, one who refused included —
all day, until someone accepts (`accepted`), the parents decide
(`parent_cancelled`: tombstone, no failure; `parent_rejected`: the task is the
delegator's again) or the day ends. The 3 hours
(`DELEGATION_PARENTS_NOTICE_MINUTES`) only decide when the parents are told:
`parents_notified_at` is set by `close-unanswered-delegations` after 3 hours
with no "yes" (or from 22:00 for any request still open), or by the
`refuse_delegation` SQL function when the last sibling refuses (the app then
pushes). A request still open when its day ends is closed overnight by
`mark-missed-tasks` as `auto_cancelled` with a tombstone — the child who asked
in time is not penalised — or `expired` if they did it themselves.
`unanswered` is legacy (it used to close the request to the siblings). The
edge function's constant, the people listed inside `refuse_delegation`, and the
`interval '3 hours'` / 22:00 in the cron gate (migration 028) must stay in step
with `src/lib/taskHelpers.js`.

More time. A child can ask the parents for more time on one of today's tasks,
before or after its deadline (+30 min, +1 h, +2 h or the rest of the day, with
an optional reason); the parents grant or refuse it on Relatório → Aprovações
(`extension_requests`, lifecycle next to `EXTENSION_REQUEST_STATUS` in
[src/lib/taskHelpers.js](src/lib/taskHelpers.js)). A grant writes a
`task_extensions` row whose `until_time` is that day's new deadline (null = the
rest of the day, which is what every older extension means): done by then pays
in full, after it is late, never done that day is still a failure. Granting
also corrects a photo already filed as late while the request waited. The
deadline rule lives in `completionTypeFor` / `effectiveDeadline`;
`check-task-reminders` moves its reminders to `until_time`, and its cron gate
has a third clause for extensions (migration 027).

Paying is the cleanup. Right after the parents record a payment the app calls
`purge-paid` for those children, and it runs nightly as a safety net. What it
may delete is decided by the pure function in
[supabase/functions/purge-paid/plan.ts](supabase/functions/purge-paid/plan.ts)
(tested from `npm test`): paid chores and fines, their photos, and weekly
bonuses of weeks left empty. It never touches undecided tasks, failures, rows
fulfilling an accepted delegation from the last month or so (the overnight
broken-delegation check and the monthly prize read them), prizes, or the bonus
of any week that still has rows — removing that would get it awarded again.
"Paid" means approved before the child's last payment (`isTaskPaid`), not
submitted before it. The manual "Limpeza" button still wipes everything.

`purge-cron-history` is not optional. pg_cron never prunes its own run log, and
with a job firing every five minutes it reached 48k rows / 73 MB — 83% of the
whole database — before it was noticed. The project runs on the base (free)
compute, so that kind of dead weight matters.

`mark-missed-tasks` owns the rule that decides failures and punishments; the
browser never runs it and never writes a failure. (It used to be nudged on
every app open; that was dropped because the overnight runs already have the
counts current by morning, and the extra call landed exactly when the page's
own queries were loading.) It is idempotent — a per-child checkpoint in
`missed_check_log` plus a unique index on the occurrence — so extra runs cost a
single query. Call it with `{"dry_run": true}` to see exactly what it would
write without touching anything; always do that before running it after a
schedule or data change.

To check whether the instance is coping, measure `check-task-reminders`
latency by hour — it runs all day, so it is a steady probe. A healthy hour has
a p95 around 130 ms; before Realtime was removed, 19:00 sat at ~23 s:

```sql
select extract(hour from (r.start_time at time zone 'Europe/Lisbon'))::int as hora,
       percentile_cont(0.95) within group
         (order by extract(epoch from r.end_time - r.start_time) * 1000) as p95_ms,
       count(*) filter (where r.end_time - r.start_time > interval '2 seconds') as lentas
from cron.job_run_details r join cron.job j on j.jobid = r.jobid
where j.jobname = 'check-task-reminders' and r.end_time is not null
group by 1 order by 1;
```

Jobs are scheduled by copying an existing job's command so the service-role key
never has to be handled by hand:

```sql
select cron.schedule('<new-job>', '<schedule>',
  replace(command, 'check-task-reminders', '<new-job>'))
from cron.job where jobname = 'check-task-reminders';
```

## Deploy

Push to `main` → Vercel auto-deploys (project `smores-2-0`, https://homitasks.vercel.app). `vercel.json` rewrites all routes to `/index.html` (SPA). Only commit/push when the user asks.
