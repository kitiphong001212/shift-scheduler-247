# 24/7 Shift Scheduler

Vue 3 + Pinia shift scheduling application with optional Supabase persistence.

## Local development

```sh
npm install
npm run dev
```

## Supabase setup

1. Create a Supabase project.
2. In Authentication → Providers, enable **Anonymous Sign-Ins**.
3. Run `supabase/migrations/202609050001_create_scheduler_state.sql` in the
   Supabase SQL Editor (or apply it with the Supabase CLI).
4. Copy `.env.example` to `.env.local` and set:

```sh
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
```

5. Restart the development server.

The app signs in anonymously, hydrates Pinia state from `scheduler_state`, and
subscribes to realtime updates belonging to that authenticated user. Row Level
Security prevents users from reading or changing another user's state.

If the environment variables are absent or Supabase is unavailable, the app
continues using localStorage. The database status appears in the sidebar.

## Checks

```sh
npm test
npm run build
```
