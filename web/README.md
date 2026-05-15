# ERT Web

Frontend for the ERT apartment management system.

## Environment

Copy [`.env.example`](C:/Users/ran%20avrina/Desktop/AGENT/web/.env.example) to `.env.local` and fill:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL`

Example:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
VITE_API_BASE_URL=http://localhost:4000/api
```

## Local run

```bash
npm install
npm run dev
```

## Production note

Business data should go through the Express server.
Supabase remains the auth provider for session/token handling.
