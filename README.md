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

## The LASER algorithm

**L**ookahead **S**imulation for **E**xpected **R**esults: the ⚡ button on the Draft Board when you're on the clock.

Most draft tools rank players with a proxy formula (a sum of category z-scores) and hope it lines up with winning. In H2H categories it often doesn't. It overpays for categories you'd win anyway and ignores who'll still be there at your next pick. LASER ranks players by the actual goal:

1. Take the board's top 8 candidates for this pick.
2. For each one, play out the **rest of the draft** 24 times. Leaguemates draft by ADP with realistic randomness, and you keep drafting with the board's fit policy.
3. Play out a **season of weekly H2H matchups** for each finished league. Weekly stats vary with 3-4 game weeks, missed games from projected availability, and form.
4. Rank candidates by **simulated share of matchups won**. Every candidate faces the *same* random draws (common random numbers), so the comparison measures the player, not the luck. It reports a paired edge with a standard error and says "too close to call" when it is.

This is *rollout* (Monte Carlo policy improvement, as used in game-playing AI) applied to a fantasy draft. One step of rollout can't do worse than the policy it rolls out, in expectation.

**Backtest (simulated 10-team leagues vs. ADP-drafting opponents):** LASER beat the board's own picks in 7 of 7 batches (98 leagues), by +1.2 to +6.1 points of matchup win rate (mean ~+3). The best combination was LASER with a punt-FT% base: 77-80% matchup wins. These numbers come from inside the model. Real leagues are noisier and real leaguemates aren't ADP bots.

The supporting pieces:
- **Durability-weighted values.** Per-game stats × projected share of games played. In simulation this was worth ~20 points of matchup win rate over per-game z-scores, which draft injury-prone veterans.
- **Strategy lab.** `/api/draft/sim?slot=N` runs every punt strategy from a draft slot.
- **Mock drafts** against ADP bots, with a simulated-season grade.
