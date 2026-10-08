# Hoop Intel

Yahoo Fantasy Basketball assistant for **Where Friendship Happens** (10-team, H2H 9-cat, snake draft). It's a React app plus a small Express API, deployed as one Vercel project so it works from any phone or laptop.

## Features

| Page | What it does |
|---|---|
| **Draft Board** | 9-cat z-score values (FG%/FT% weighted by attempts, TO counted negative). Punt toggles, a snake-draft clock with "you're up" alerts, best-fit recommendations based on your weak categories and open lineup slots, "gone before your next pick?" flags, and tracking of every team's picks. Saved on your device, so it works offline once the player pool is loaded. Works without Yahoo if you import a projections CSV. |
| **Game Night** | Live matchup. Shows Yahoo's official week totals, tonight's live box-score stats from the NBA feed, per-player live lines with an on-court indicator, swing categories, and a projected final score. Alerts you when a player who has a game is sitting on your bench, and when tomorrow's lineup needs fixing. Refreshes every 30s while games are live. |
| Matchup / Game Plan / Today / Roster / Start-Sit / Waivers / Schedule | Last season's in-season tools, now backed by a working API. |

> **League quirk:** lineup changes in this league take effect *tomorrow* ("Daily - Tomorrow"). Tonight's lineup is already locked, so the useful Game Night alerts are the **TOMORROW** ones.

## Setup

1. **Yahoo app** (https://developer.yahoo.com/apps/): Confidential Client with Fantasy Sports **Read** permission. Set the Redirect URI to
   `https://<your-vercel-domain>/api/auth/callback`
2. **Vercel env vars** (Project → Settings → Environment Variables):
   - `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`
   - `SESSION_SECRET`: 32+ random characters (encrypts the login cookie)
   - `LEAGUE_ID=33458` (optional; only matters if you're in more than one NBA league)
   - `PUBLIC_URL` (optional): set it if the Yahoo redirect has to use a fixed domain
3. Redeploy, open the site, and click **Connect Yahoo**.

Yahoo tokens are stored only in an encrypted, httpOnly cookie. They never go into localStorage or URLs, and there is no database.

## Local dev

```bash
cp .env.example .env   # fill in values; Yahoo needs an HTTPS redirect, so use the deployed URL or a tunnel
npm install
npm run dev            # Vite on :5173, API on :3001 (proxied)
npm test               # engine + API tests (Yahoo/NBA mocked)
```

## Draft-day checklist

1. Before the draft: open **Draft Board → Setup**, pick your slot, click **Load players from Yahoo**, and optionally import a projections CSV.
2. During the draft: hit **Draft** on each player as they're taken. The board assigns each pick to whoever is on the clock, and **Undo** fixes mistakes.
3. The board lives in that browser's storage, so run the draft from one device.
