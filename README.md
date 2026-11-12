# Kick Systems

Production management for Kick Pictures. PEKS is the first project.

Stack: Next.js (Vercel) + Supabase (Postgres, login, files). Access rules live in the
database (row level security), tested in `db/tests/access.test.ts`.

## Run locally
1. Postgres 16 on port 54322 (user `postgres`, no password).
2. `.env.local`:
   ```
   DATABASE_URL=postgres://postgres@127.0.0.1:54322/kick
   AUTH_MODE=dev
   DEV_SESSION_SECRET=any-long-random-text
   ```
3. `npm install && npm run db:reset && npm run dev`
4. `npm run test:db` (database rules) and `python3 e2e/walkthrough.py <folder>` (clicks through as each user type).

`AUTH_MODE=dev` shows a "pick who you want to be" login. It refuses to run in production.

## Go online (needs the accounts)
1. Supabase project: run `supabase/migrations/*.sql` in order. Never run `db/local/*` there.
2. Supabase Auth: e-mail + password on, sign-ups off (only admins add people).
3. Vercel env vars:
   ```
   DATABASE_URL=<Supabase pooler connection string, transaction mode>
   DATABASE_SSL=true
   AUTH_MODE=supabase
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...   (server only, used to invite people)
   SITE_URL=https://<the site address>
   ```
4. First admin: create the account in Supabase, then insert their row in `profiles` with `user_type='admin'`.

## Stages
1. Base: login, people, projects (own workflow and pages, or copied), menu by permission. ← done
2. PEKS Shot Tracker, Visual Guides, status rules per user type, status history.
3. Home screens (admin and artist), Fada dos shots, checklist with the daily phrase.
4. Discord notifications and the Reports page.
5. Calendar (rebuilt from the Manus version).
6. Migration of the Coda episodes.
