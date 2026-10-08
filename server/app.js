// Hoop Intel API. Runs as a Vercel function (api/index.js) and locally (server/dev.js).
import express from 'express';
import { authRedirect, handleCallback, logout, isAuthed, yget, merge, each, myContext } from './yahoo.js';
import { getSchedule, gamesBetween, byTeam, getScoreboard, etDate, addDays } from './nba.js';
import { gameNight } from './gamenight.js';
import { draftPool } from './draft.js';
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

// TEMP probe: ESPN response shapes
app.get('/api/probe', wrap(async () => {
  const UA = { 'User-Agent': 'Mozilla/5.0 HoopIntel' };
  const j = async url => { const r = await fetch(url, { headers: UA }); return { status: r.status, body: r.ok ? await r.json() : (await r.text()).slice(0, 200) }; };
  const B = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
  const sb = await j(`${B}/scoreboard`);
  const ev = sb.body.events?.[0];
  const out = { scoreboardDay: sb.body.day, eventCount: sb.body.events?.length, event: ev && { ...ev, competitions: [{ ...ev.competitions[0], competitors: ev.competitions[0].competitors.map(c => ({ homeAway: c.homeAway, score: c.score, team: { abbreviation: c.team.abbreviation, id: c.team.id } })), broadcasts: undefined, headlines: undefined, venue: undefined, geoBroadcasts: undefined, tickets: undefined, odds: undefined }], links: undefined, weather: undefined } };
  for (const q of ['dates=20261020-20261026', 'dates=20261021', 'dates=20261020-20261026&limit=200', 'dates=20261020-20261026&seasontype=2']) {
    const r = await j(`${B}/scoreboard?${q}`);
    out[`range:${q}`] = { status: r.status, events: r.body.events?.length, first: r.body.events?.[0]?.date, last: r.body.events?.at(-1)?.date };
  }
  const ts = await j(`${B}/teams/bos/schedule?seasontype=2`);
  out.teamSchedule = { status: ts.status, n: ts.body.events?.length, first: ts.body.events?.[0] && { id: ts.body.events[0].id, date: ts.body.events[0].date, seasonType: ts.body.events[0].seasonType, comps: ts.body.events[0].competitions?.[0]?.competitors?.map(c => c.team?.abbreviation) } };
  const teams = await j(`${B}/teams`);
  out.teamAbbrs = teams.body.sports?.[0]?.leagues?.[0]?.teams?.map(t => t.team.abbreviation);
  // box score: find a finished game last season-ish
  const done = await j(`${B}/scoreboard?dates=20260320`);
  const gid = done.body.events?.[0]?.id;
  if (gid) {
    const sum = await j(`${B}/summary?event=${gid}`);
    const bp = sum.body.boxscore?.players?.[0];
    out.box = { gid, status: sum.status, team: bp?.team?.abbreviation, statsKeys: bp?.statistics?.[0]?.keys, labels: bp?.statistics?.[0]?.labels, athlete0: bp?.statistics?.[0]?.athletes?.[0] && { ...bp.statistics[0].athletes[0], athlete: { displayName: bp.statistics[0].athletes[0].athlete?.displayName, id: bp.statistics[0].athletes[0].athlete?.id } } };
  }
  return out;
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
app.get('/api/history/seasons', wrap(historySeasons));
app.get('/api/history/season/:leagueKey', wrap(historySeason));

app.use('/api', (req, res) => res.status(404).json({ error: `No route ${req.method} ${req.path}` }));

export default app;
