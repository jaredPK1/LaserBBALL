// Hoop Intel API. Runs as a Vercel function (api/index.js) and locally (server/dev.js).
import express from 'express';
import { authRedirect, handleCallback, logout, isAuthed, yget, merge, each, myContext } from './yahoo.js';
import { getSchedule, gamesBetween, byTeam, getScoreboard, etDate, addDays } from './nba.js';
import { gameNight } from './gamenight.js';
import { draftPool } from './draft.js';

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
app.get('/api/auth/status', wrap(req => ({ authed: isAuthed(req) })));
app.post('/api/auth/logout', wrap(logout));

// ── Health (public): confirms the NBA feeds are reachable from this host ────
app.get('/api/health', wrap(async () => {
  const check = async fn => { try { return { ok: true, info: await fn() }; } catch (e) { return { ok: false, error: e.message }; } };
  return {
    yahooConfigured: !!(process.env.YAHOO_CLIENT_ID && process.env.YAHOO_CLIENT_SECRET),
    sessionConfigured: (process.env.SESSION_SECRET || '').length >= 32,
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
app.get('/api/draft/pool', wrap(draftPool));

app.use('/api', (req, res) => res.status(404).json({ error: `No route ${req.method} ${req.path}` }));

export default app;
