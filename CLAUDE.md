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
```

There is no test suite. Verify changes by running `npm run dev` / `npm run build` and exercising the flow.

## Environment

`.env.local` holds three public frontend vars, pulled from Vercel (`npx vercel env pull .env.local`):
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`. It is gitignored — never commit it.

## Architecture

- **Frontend:** React 18 + Vite 6, React Router, TanStack Query for server state.
- **Backend:** Supabase (Postgres + Auth + Realtime + Edge Functions). Project ref `yjnyznhqheerjpqprggm`.
- **Data access:** All Supabase calls go through the service objects in [src/api/entities.js](src/api/entities.js) — `TaskService`, `ScheduledTaskService`, `OccasionalTaskService`, `TaskReminderService`, `TaskDelegationService`, `TaskExtensionService`, `TaskCancellationService`, `PaymentService`, `CleanupLogService`. Add DB access here, not inline in components.
- **Tables:** `tasks`, `scheduled_tasks`, `occasional_tasks`, `task_reminders`, `task_delegations`, `task_extensions`, `task_cancellations`, `payments`, `cleanup_log` (+ push subscription tables).
- **Auth:** [src/lib/AuthContext.jsx](src/lib/AuthContext.jsx) provides `AuthProvider` / `useAuth`. `App.jsx` gates routes on `isAuthenticated`.
- **Realtime:** [src/hooks/useRealtimeSync.js](src/hooks/useRealtimeSync.js) subscribes to `postgres_changes` and invalidates React Query caches, so mutations propagate live across devices.
- **Push:** `sendPushNotification()` in [src/api/supabaseClient.js](src/api/supabaseClient.js) invokes the `send-push-notification` edge function.

## Conventions

- `@/` import alias → `src/` (configured in `jsconfig.json` and `vite.config.js`).
- **`src/pages.config.js` is auto-generated** — do not edit it except the `mainPage` value. Pages are auto-registered from files in `src/pages/`.
- UI is shadcn/ui: primitives live in `src/components/ui/` (generally leave these alone; they're generated). Feature components live in `src/components/{home,layout,parents,register,notifications}/`.
- Task approval flow: a task has `approval_status` (`pending`/`approved`/`rejected`). Rejection sets `value: 0` and `completion_type: 'not_done'` so earnings/failure logic flows naturally — see comments in `entities.js`.
- ESLint targets `src/pages/**` and `src/components/**` (excluding `components/ui`); `src/lib`, `src/api` are excluded from lint but type-checked selectively via jsconfig.

## Backend workflow (Supabase CLI)

Edge functions are in `supabase/functions/`; schema changes as ordered SQL in `supabase-migrations/`.

```bash
npx supabase functions deploy <name>   # deploy one edge function
```

## Deploy

Push to `main` → Vercel auto-deploys (project `smores-2-0`, https://homitasks.vercel.app). `vercel.json` rewrites all routes to `/index.html` (SPA). Only commit/push when the user asks.
