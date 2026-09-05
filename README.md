# 24/7 Shift Scheduler

Vue 3 + Pinia shift scheduling application with optional Supabase persistence.

## Local development

```sh
npm install
npm run dev
```

## Supabase setup

1. Create a Supabase project.
2. Run `supabase/migrations/202609050001_create_scheduler_state.sql` in the
   Supabase SQL Editor (or apply it with the Supabase CLI).
3. In Authentication → Users, create the administrator's email/password user.
   Do not expose a public sign-up flow.
4. Copy `.env.example` to `.env.local` and set:

```sh
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
VITE_ADMIN_USERNAME=admin
VITE_ADMIN_EMAIL=admin@example.com
```

5. Restart the development server and sign in with the configured username.
   The app maps that username to the administrator's Supabase email account.

The app requires an email/password session, hydrates Pinia state from
`scheduler_state`, and subscribes to realtime updates belonging to that
administrator. Use the same account on each device to access the same data.
Row Level Security prevents users from reading or changing another user's
state.

If the environment variables are absent or Supabase is unavailable, the app
continues using localStorage. The database status appears in the sidebar.

## Checks

```sh
npm test
npm run build
```
