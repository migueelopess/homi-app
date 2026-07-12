# Homi

A family tasks & rewards app: kids complete tasks, parents approve them, and balances/rankings update in real time. Built with React + Vite on the frontend and Supabase (auth, database, edge functions) on the backend, deployed to Vercel.

## Stack

- **Frontend:** React 18, Vite 6, React Router, TanStack Query
- **UI:** Tailwind CSS + shadcn/ui (Radix primitives), Framer Motion, Lucide icons
- **Backend:** Supabase — Postgres, Auth, Realtime, Edge Functions (Deno)
- **Payments:** Stripe
- **Notifications:** Web Push (VAPID) via a Supabase Edge Function
- **Deploy:** Vercel (project `smores-2-0` → https://homitasks.vercel.app)

## Prerequisites

- Node.js 20+ (developed on Node 24)
- A `.env.local` file (see below)

## Setup

```bash
npm install
```

Create `.env.local` in the project root with the frontend environment variables. The easiest way, if the project is linked to Vercel, is to pull them:

```bash
npx vercel link      # once, select the "smores-2-0" project
npx vercel env pull .env.local
```

Or set them manually:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
VITE_VAPID_PUBLIC_KEY=<vapid-public-key>   # for web push notifications
```

All three are public, browser-safe values. `.env.local` is gitignored.

## Development

```bash
npm run dev        # start Vite dev server at http://localhost:5173
npm run build      # production build
npm run preview    # preview the production build locally
npm run lint       # ESLint
npm run lint:fix   # ESLint with --fix
npm run typecheck  # type-check JS via jsconfig (checkJs)
```

## Project structure

```
src/
  api/          Data-access layer over Supabase (entities.js), storage, push helpers, supabaseClient
  pages/        Route pages: Home, Login, Tarefas, Rotinas, Delegar, Parents, Ranking, RegisterTask
  components/   Feature UI (home, layout, parents, register, notifications) + shadcn/ui in components/ui
  lib/          AuthContext, TanStack Query client, task/earnings helpers, cross-cutting hooks
  hooks/        useRealtimeSync (Supabase realtime), use-mobile
  utils/        Misc utilities
  App.jsx       Router + auth gating + realtime sync
supabase/
  functions/    Edge Functions: check-task-reminders, daily-approval-summary,
                monthly-cleanup, send-push-notification
supabase-migrations/  Ordered SQL migrations (001..008)
```

The `@/` import alias maps to `src/` (see `jsconfig.json`).

`src/pages.config.js` is **auto-generated** — don't edit it by hand except the `mainPage` value.

## Backend (Supabase)

- Project ref: `yjnyznhqheerjpqprggm`
- Edge Functions live in `supabase/functions/` and are deployed with the Supabase CLI.
- Schema changes are tracked as SQL files in `supabase-migrations/`.

```bash
npx supabase login                                   # once
npx supabase link --project-ref yjnyznhqheerjpqprggm # once
npx supabase functions deploy <name>                 # deploy an edge function
```

## Deployment

Pushing to `main` triggers a Vercel deployment. `vercel.json` rewrites all routes to `index.html` for client-side routing (SPA).
