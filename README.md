# PitchDesk

Podcast guest outreach for Kathy Slowinski (The AI Boss). A focused PodPitch replacement: one guest profile, careful volume, human approval before anything sends.

## What it does

1. **Discover** – searches Podcast Index (4M+ shows), keeps active English shows, pulls the host email from each RSS feed and the five latest episodes, verifies the email, and scores fit with Claude against Kathy's profile.
2. **Draft** – for shows at or above the fit threshold, Claude writes a pitch in Kathy's voice. It may reference a real recent episode by title, but never claims to have listened.
3. **Approve** – every first pitch waits in the approval queue. Edit, rewrite, approve or skip.
4. **Send** – a cron runs every 15 minutes. Approved pitches go out from Kathy's Gmail, weekdays inside the send window, a few per run, up to the daily cap.
5. **Follow up** – two short follow-ups as replies in the same thread (default day 4 and day 11). Optional auto-approve.
6. **Detect replies** – each run reads the pitch threads. Any reply stops the sequence, gets classified (positive / question / negative / out-of-office), and gets a suggested answer. Bounces stop the sequence and suppress the address.
7. **Inbox** – edit the suggested answer and save it as a Gmail draft in the right thread, then send from Gmail. Mark booked or declined.
8. **Dashboard** – shows pitched, reply rate, bookings, sends today vs cap, pipeline by status, activity.

## Stack

Next.js 15 (App Router, server actions) · Tailwind 4 · Postgres via `postgres` · Gmail REST API with OAuth · Claude Messages API · Podcast Index API · Vercel Cron.

## Setup

### 1. Accounts and keys

| What | Where | Env var |
|---|---|---|
| Postgres | Vercel → Storage → Neon (free tier is fine) | `DATABASE_URL` |
| Claude API key | console.anthropic.com | `ANTHROPIC_API_KEY` |
| Podcast Index key + secret | api.podcastindex.org (free) | `PODCASTINDEX_KEY`, `PODCASTINDEX_SECRET` |
| Google OAuth client | Google Cloud Console (see below) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| App password | make one up | `APP_PASSWORD` |
| Cron secret | any long random string | `CRON_SECRET` |
| App URL | your Vercel URL, no trailing slash | `APP_URL` |
| ZeroBounce (optional) | zerobounce.net | `ZEROBOUNCE_API_KEY` |

### 2. Google OAuth (Gmail)

1. Google Cloud Console → new project → enable **Gmail API**.
2. OAuth consent screen: if theaiboss.ai is on Google Workspace, choose **Internal**. That skips Google's verification review for Gmail scopes. Otherwise choose External and add Kathy's address as a test user.
3. Credentials → OAuth client ID → **Web application**. Authorized redirect URI: `https://YOUR-APP.vercel.app/api/gmail/callback`.
4. Scopes requested: `gmail.send`, `gmail.readonly`, `gmail.compose` (drafts), plus `openid email`.

### 3. Deploy

1. Push this folder to a GitHub repo and import it in Vercel (or `vercel deploy`).
2. Add all env vars above in Project → Settings → Environment Variables.
3. Create tables and seed Kathy's profile once: `DATABASE_URL=... npm run db:setup`
4. Open the app, sign in with `APP_PASSWORD`, go to **Settings → Connect Gmail**, and have Kathy sign in.
5. Cron: `vercel.json` runs `/api/cron/tick` once a day on weekdays (14:00 UTC, 9am Toronto) so it deploys on the free Hobby plan. On Vercel Pro, change the schedule to `*/15 * * * *` so pitches go out spread across the day. Between runs you can always press **Run now** on the dashboard.

## Before the first send

- Fix the headcount on theaiboss.ai (site says ~40, pitches say 25). Hosts check.
- Consider a secondary sending address to protect Kathy's main domain, and make sure SPF, DKIM and DMARC pass.
- Start with a daily cap of 15–20 for the first two weeks, then raise it.

## Safety rails built in

- Nothing sends without approval (follow-ups only if auto-approve is on).
- Daily cap, per-run cap, weekday send window in Kathy's timezone, pause switch.
- Platform addresses (anchor.fm, buzzsprout.com, etc.) are flagged "risky".
- Bounced addresses are suppressed forever.
- Any reply, including "no", stops the sequence. Out-of-office does not.
