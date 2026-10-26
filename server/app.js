// Hoop Intel API. Runs as a Vercel function (api/index.js) and locally (server/dev.js).
import express from 'express';
import { authRedirect, handleCallback, logout, isAuthed, yget, merge, each, myContext, debugYahoo, warmToken } from './yahoo.js';
import { storeConfigured, getJson, setJson } from './store.js';
import { getSchedule, gamesBetween, byTeam, getScoreboard, etDate, addDays } from './nba.js';
import { gameNight } from './gamenight.js';
import { weekProjection, weekStreamers } from './weekly.js';
import { alerts, playoffs, trade, tradeIdeas } from './manage.js';
import { weekReview } from './review.js';
import { leagueWeek, powerWeek } from './league.js';
import { draftPool } from './draft.js';
import { espnDraftPool, loadPool } from './espn.js';
import { evaluateStrategy, STRATEGIES, simulateSeason } from '../src/draft/sim.js';
import { computeValues, normName, CATS } from '../src/draft/engine.js';
import '../src/draft/laser.js';
import { historySeasons, historySeason } from './history.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json());

const wrap = fn => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    if (e.status !== 401) console.error(e);
    if (!res.headersSent) res.status(e.status || 500).json({ error: e.message, details: e.message });
  }
};

const leagueKey = id => (String(id).includes('.l.') ? id : `nba.l.${id}`);
const STATS = 'stats;type=average_season';

// ── Auth ─────────────────────────────────────────────────────────────────────
app.get('/api/auth', wrap(authRedirect));
app.get('/api/auth/callback', wrap(handleCallback));
app.post('/api/auth/warm', wrap(warmToken));
app.get('/api/auth/status', wrap(req => ({ authed: isAuthed(req) })));
app.post('/api/auth/logout', wrap(logout));
app.get('/api/debug/yahoo', wrap(debugYahoo));

// ── Cross-device draft sync ─────────────────────────────────────────────────
// Single-user app by the owner's choice: one draft, shown on every device with
// no login or code. Anyone with the URL can see and edit the draft board.
const SYNC_FIELDS = ['settings', 'teamNames', 'teamManagers', 'picks', 'mock', 'source'];
const requireUser = () => 'draft:owner';
app.get('/api/me/draft', wrap(async req => {
  if (!storeConfigured()) return { configured: false };
  const doc = await getJson(requireUser(req));
  return { configured: true, doc };
}));
app.put('/api/me/draft', wrap(async req => {
  const key = requireUser(req);
  const body = req.body || {};
  if (!Number.isFinite(body.updatedAt) || !Array.isArray(body.picks)) {
    throw Object.assign(new Error('Bad draft payload'), { status: 400 });
  }
  const current = await getJson(key);
  // Last write wins, but never let an older copy overwrite a newer one
  if (current && current.updatedAt > body.updatedAt) return { ok: false, stale: true, doc: current };
  const doc = Object.fromEntries(SYNC_FIELDS.filter(f => body[f] !== undefined).map(f => [f, body[f]]));
  doc.updatedAt = body.updatedAt;
  await setJson(key, doc);
  return { ok: true, updatedAt: doc.updatedAt };
}));

// ── Health (public): confirms the live-data feeds are reachable from this host ─
app.get('/api/health', wrap(async () => {
  const check = async fn => { try { return { ok: true, info: await fn() }; } catch (e) { return { ok: false, error: e.message }; } };
  return {
    yahooConfigured: !!(process.env.YAHOO_CLIENT_ID?.trim() && process.env.YAHOO_CLIENT_SECRET?.trim()),
    // Presence only — never values
    env: Object.fromEntries(['YAHOO_CLIENT_ID', 'YAHOO_CLIENT_SECRET', 'SESSION_SECRET', 'LEAGUE_ID', 'PUBLIC_URL']
      .map(k => [k, process.env[k] === undefined ? 'missing' : process.env[k].trim() ? 'set' : 'empty'])),
    redirectUri: process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL.replace(/\/$/, '')}/api/auth/callback` : '(derived from request host)',
    sessionConfigured: (process.env.SESSION_SECRET || '').length >= 32,
    syncConfigured: storeConfigured(),
    nbaSchedule: await check(async () => `${(await getSchedule()).length} games`),
    nbaScoreboard: await check(async () => { const s = await getScoreboard(); return `${s.date}: ${s.games.length} games`; }),
  };
}));

// ── Yahoo passthroughs (raw Yahoo JSON, parsed by the pages) ────────────────
app.get('/api/leagues', wrap((req, res) => yget(req, res, 'users;use_login=1/games;game_keys=nba/leagues/teams')));
app.get('/api/context', wrap(async (req, res) => { const ctx = await myContext(req, res); delete ctx.raw; return ctx; }));
app.get('/api/league/:leagueId', wrap((req, res) => yget(req, res, `league/${leagueKey(req.params.leagueId)}/settings`)));
app.get('/api/standings/:leagueId', wrap((req, res) => yget(req, res, `league/${leagueKey(req.params.leagueId)}/standings`)));
app.get('/api/roster/:leagueId/:teamKey', wrap((req, res) =>
  yget(req, res, `team/${req.params.teamKey}/roster/players/${STATS}`)));
app.get('/api/matchup/:leagueId/:teamKey', wrap((req, res) =>
  yget(req, res, `team/${req.params.teamKey}/matchups${req.query.week ? `;weeks=${Number(req.query.week)}` : ''}`)));
app.get('/api/waivers/:leagueId', wrap((req, res) =>
  yget(req, res, `league/${leagueKey(req.params.leagueId)}/players;status=A;sort=AR;sort_type=lastmonth;count=25/${STATS}`)));
app.get('/api/players', wrap((req, res) => {
  const keys = String(req.query.keys || '').split(',').filter(k => /^[\w.]+$/.test(k)).slice(0, 25);
  return yget(req, res, `players;player_keys=${keys.join(',')}/${STATS}`);
}));

app.get('/api/gameplan/:leagueId/:teamKey', wrap(async (req, res) => {
  const { teamKey } = req.params;
  const lk = leagueKey(req.params.leagueId);
  const week = req.query.week ? `;weeks=${Number(req.query.week)}` : '';
  const [matchup, myRoster, waivers] = await Promise.all([
    yget(req, res, `team/${teamKey}/matchups${week}`),
    yget(req, res, `team/${teamKey}/roster/players/${STATS}`),
    yget(req, res, `league/${lk}/players;status=A;sort=AR;sort_type=lastmonth;count=25/${STATS}`),
  ]);
  const mt = merge(matchup.fantasy_content.team.slice(1));
  const m = each(mt.matchups, 'matchup')[0] || {};
  const teams = each(merge(m['0'] || m).teams, 'team');
  const opp = teams.map(t => merge(t[0])).find(t => t.team_key !== teamKey);
  const opponentRoster = opp ? await yget(req, res, `team/${opp.team_key}/roster/players/${STATS}`) : null;
  return { matchup, myRoster, opponentRoster, waivers };
}));

// ── Schedule ────────────────────────────────────────────────────────────────
async function currentWeekBounds(req, res) {
  if (isAuthed(req)) {
    try {
      const ctx = await myContext(req, res);
      const data = await yget(req, res, 'game/nba/game_weeks');
      const weeks = each(merge(data.fantasy_content.game).game_weeks, 'game_week');
      const today = etDate();
      const w = weeks.find(x => x.start <= today && today <= x.end) || weeks.find(x => Number(x.week) === ctx.currentWeek);
      if (w) return { week: Number(w.week), start: w.start, end: w.end, weeks };
    } catch { /* fall back */ }
  }
  const today = etDate();
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const start = addDays(today, -((dow + 6) % 7));
  return { week: null, start, end: addDays(start, 6), weeks: null };
}

app.get('/api/schedule/today', wrap(async () => {
  const today = etDate();
  const games = await gamesBetween(today, today);
  return {
    today,
    teamsPlaying: [...new Set(games.flatMap(g => [g.home, g.away]))],
    games: games.map(g => ({ gameId: g.gameId, home: g.home, away: g.away, time: g.utc })),
  };
}));

app.get('/api/schedule/remaining', wrap(async (req, res) => {
  const b = await currentWeekBounds(req, res);
  const games = await gamesBetween(etDate(), b.end);
  const remaining = Object.fromEntries(Object.entries(byTeam(games)).map(([t, g]) => [t, g.length]));
  return { week: b.week, start: b.start, end: b.end, remaining };
}));

app.get('/api/schedule/week-days', wrap(async (req, res) => {
  const b = await currentWeekBounds(req, res);
  return { week: b.week, start: b.start, end: b.end, schedule: byTeam(await gamesBetween(etDate(), b.end)) };
}));

app.get('/api/schedule/weekly', wrap(async (req, res) => {
  const b = await currentWeekBounds(req, res);
  const today = etDate();
  let ranges;
  if (b.weeks) {
    ranges = b.weeks.filter(w => w.end >= today).slice(0, 4).map(w => ({ label: `W${String(w.week).padStart(2, '0')}`, start: w.start, end: w.end }));
  } else {
    ranges = [0, 1, 2, 3].map(i => ({ label: `W+${i}`, start: addDays(b.start, i * 7), end: addDays(b.end, i * 7) }));
  }
  const weeks = {};
  for (const r of ranges) {
    const games = await gamesBetween(r.start, r.end);
    weeks[r.label] = { start: r.start, end: r.end, teams: Object.fromEntries(Object.entries(byTeam(games)).map(([t, g]) => [t, g.length])) };
  }
  return { weeks };
}));

// ── Live / features ─────────────────────────────────────────────────────────
app.get('/api/nba/scoreboard', wrap(() => getScoreboard()));
app.get('/api/gamenight', wrap(gameNight));
// Keep the latest result of each in-season view in the cloud store, so the
// owner's assistant can review real numbers between visits
const snapshot = (name, fn) => async (req, res) => {
  const out = await fn(req, res);
  // Awaited: Vercel can stop a function as soon as the response is sent
  if (storeConfigured() && out) {
    const doc = { savedAt: new Date().toISOString(), ...out };
    const saves = [setJson(`snap:${name}`, doc)];
    // Per-week copies for the weekly review: the first projection of each
    // week (what we grade against) and the latest one
    if (name === 'week' && out.week) {
      saves.push(setJson(`snap:week:${out.week}:last`, doc));
      const first = await getJson(`snap:week:${out.week}:first`).catch(() => null);
      if (!first) saves.push(setJson(`snap:week:${out.week}:first`, doc));
    }
    await Promise.all(saves).catch(e => console.error(`snapshot ${name}:`, e.message));
  }
  return out;
};
app.get('/api/week', wrap(snapshot('week', weekProjection)));
app.get('/api/week/streamers', wrap(snapshot('streamers', weekStreamers)));
app.get('/api/alerts', wrap(snapshot('alerts', alerts)));
app.get('/api/week/review', wrap(weekReview));
app.get('/api/playoffs', wrap(playoffs));
app.get('/api/trade', wrap(trade));
app.get('/api/trade/ideas', wrap(tradeIdeas));
app.get('/api/race/week', wrap(leagueWeek));
app.get('/api/race/power', wrap(powerWeek));
app.get('/api/draft/pool', wrap(draftPool));
app.get('/api/draft/espn', wrap(espnDraftPool));
// Grade real rosters: match names to the ESPN pool, then simulate many seasons (all-play H2H 9-cat).
// GET /api/draft/grade?data=<base64url JSON [{name, players:[...names]}]>&seasons=40
app.get('/api/draft/grade', wrap(async req => {
  const teamsIn = JSON.parse(Buffer.from(String(req.query.data || ''), 'base64url').toString('utf8'));
  const { players } = await loadPool({ query: { count: 400 } });
  const valued = computeValues(players, { teams: teamsIn.length, rounds: 13 });
  const byName = new Map(valued.map(p => [normName(p.name), p]));
  const unmatched = [];
  const rosters = teamsIn.map(t => t.players.map(n => byName.get(normName(n)) || (unmatched.push(`${t.name}: ${n}`), null)).filter(Boolean));
  const seasons = Math.min(Number(req.query.seasons) || 40, 100);
  const acc = rosters.map(() => ({ win: 0, rank: 0, first: 0, cats: Object.fromEntries(CATS.map(c => [c.k, 0])) }));
  for (let s = 0; s < seasons; s++) {
    const res = simulateSeason(rosters, { weeks: 20, seed: 1000 + s * 31 });
    res.forEach((r, i) => {
      const rank = 1 + res.filter((x, j) => j !== i && x.winPct > r.winPct).length;
      acc[i].win += r.winPct; acc[i].rank += rank; if (rank === 1) acc[i].first++;
      for (const c of CATS) acc[i].cats[c.k] += r.cats[c.k];
    });
  }
  const out = teamsIn.map((t, i) => ({
    team: t.name,
    winPct: +(acc[i].win / seasons).toFixed(3),
    avgRank: +(acc[i].rank / seasons).toFixed(2),
    firstPlace: +(acc[i].first / seasons).toFixed(2),
    cats: Object.fromEntries(Object.entries(acc[i].cats).map(([k, v]) => [k, +(v / seasons).toFixed(2)])),
    totalValue: +rosters[i].reduce((a, p) => a + (p.value || 0), 0).toFixed(1),
    gpWeighted: Math.round(rosters[i].reduce((a, p) => a + (p.gp || 0), 0) / rosters[i].length),
  })).sort((a, b) => b.winPct - a.winPct);
  return { seasons, unmatched, teams: out };
}));

// Strategy lab: every strategy from one draft slot, N simulated drafts + seasons each
app.get('/api/draft/sim', wrap(async req => {
  const slot = Math.min(Math.max(Number(req.query.slot) || 1, 1), Number(req.query.teams) || 10);
  const runs = Math.min(Number(req.query.runs) || 40, 120);
  const keys = String(req.query.strategies || Object.keys(STRATEGIES).join(',')).split(',').filter(k => STRATEGIES[k]);
  const { players } = await loadPool({ query: {} });
  const engine = {
    toWeight: req.query.to != null ? Number(req.query.to) : 1,
    need: { mode: req.query.mode || 'linear', sigma: Number(req.query.sigma) || 4 },
    laserCandidates: Number(req.query.lc) || undefined,
    laserRollouts: Number(req.query.lr) || undefined,
    laserWeeks: Number(req.query.lw) || undefined,
  };
  const results = keys.map(k => {
    const r = evaluateStrategy(players, { strategyKey: k, mySlot: slot, runs, seed: Number(req.query.seed) || 1, engine, teams: Number(req.query.teams) || 10, rounds: Number(req.query.rounds) || 13 });
    if (!req.query.sample) delete r.sample;
    return r;
  });
  return { slot, teams: Number(req.query.teams) || 10, runs, engine, results: results.sort((a, b) => b.winPct - a.winPct) };
}));
app.get('/api/history/seasons', wrap(historySeasons));
// Finished seasons never change, so keep them in the cloud store: other devices
// skip the slow Yahoo crawl, and the owner can analyze history server-side.
// ?fresh=1 re-reads Yahoo (and refreshes the stored copy).
app.get('/api/history/season/:leagueKey', wrap(async (req, res) => {
  if (!isAuthed(req)) throw Object.assign(new Error('Not connected to Yahoo'), { status: 401 });
  const key = `hist:${req.params.leagueKey}`;
  if (storeConfigured() && !req.query.fresh) {
    const cached = await getJson(key).catch(() => null);
    if (cached) return cached;
  }
  const season = await historySeason(req, res);
  if (season?.isFinished && storeConfigured()) await setJson(key, season).catch(e => console.error('history cache:', e.message));
  return season;
}));

app.use('/api', (req, res) => res.status(404).json({ error: `No route ${req.method} ${req.path}` }));

export default app;
