# Deployment Checklist

## Target architecture

- `web` -> Vercel
- `server` -> Render / Railway
- `database + auth` -> Supabase

The intended runtime flow is:

`browser -> web -> server -> Supabase`

Supabase Auth still issues the user session token. Business data should be read and written through the Express server.

## 1. Security before deploy

1. Rotate `SUPABASE_SERVICE_ROLE_KEY`
   Reason: the key was exposed during development.
2. Keep the new key only in the server environment.
3. Run the hardened RLS migration in Supabase:
   - [20260515_harden_rls.sql](C:/Users/ran%20avrina/Desktop/AGENT/web/database/migrations/20260515_harden_rls.sql)

## 2. Supabase setup

In Supabase Auth settings, set:

- Site URL:
  - `https://your-app-domain`
- Redirect URLs:
  - `https://your-app-domain/login`
  - `https://your-app-domain/reset-password`
  - local URLs used for development if needed

Enable email confirmation:

1. `Authentication -> Providers -> Email`
2. Turn on `Confirm email`
3. Keep `Secure email change` enabled
4. Save

Expected behavior after this:

- Register sends a real confirmation email
- Login is blocked until the user confirms the email
- The web app shows a Hebrew message instead of a generic auth error

## 3. Server deployment

Required env vars:

```env
NODE_ENV=production
PORT=4000
CLIENT_ORIGIN=https://your-app-domain
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-or-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-rotated-service-role-key
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120
AUTH_RATE_LIMIT_WINDOW_MS=60000
AUTH_RATE_LIMIT_MAX=20
```

Health endpoints:

- liveness: `/api/health`
- readiness: `/api/health/ready`

Expected production start command:

```bash
npm run build
npm start
```

## 4. Web deployment

Required env vars:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
VITE_API_BASE_URL=https://your-api-domain/api
```

If the frontend is hosted on `app.example.com`, then the API should usually be something like:

```env
VITE_API_BASE_URL=https://api.example.com/api
```

## 5. Domains

Recommended:

- frontend: `app.example.com`
- server: `api.example.com`

Then set:

- `CLIENT_ORIGIN=https://app.example.com`
- `VITE_API_BASE_URL=https://api.example.com/api`

## 6. Final validation

Run these flows against the deployed environment:

1. register
2. email confirmation
3. login only after email confirmation
4. switch account in the same browser
5. reset password
6. create apartment
7. invite roommate / landlord
8. accept invite with existing account
9. accept invite with a brand new account
10. create / edit / delete:
   - expenses
   - payments
   - tasks
   - shopping items
   - tickets
   - apartment info
11. refresh on inner pages
12. assistant queries
13. mobile bottom navigation
14. mobile login / register / invite flows

## 7. Soft-launch readiness

Minimum bar before sending this to real users:

1. Email confirmation works on the deployed Vercel domain
2. Render API responds on:
   - `/api/health`
   - `/api/health/ready`
3. Refresh works on inner routes in Vercel
4. Two different test accounts work on:
   - desktop
   - mobile
5. Invite flow works from a fresh browser session
6. Hardened RLS migration is already applied
7. Rotated service role key is already in production env vars

## 8. Current known architecture decision

Direct frontend access is still used for Supabase Auth session handling:

- sign up
- sign in
- sign out
- reset password

That is acceptable.
Business tables should remain protected behind the server and hardened RLS.
