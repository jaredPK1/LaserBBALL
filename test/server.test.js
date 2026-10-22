import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { seal } from '../server/session.js';

process.env.SESSION_SECRET = 'x'.repeat(40);
process.env.YAHOO_CLIENT_ID = 'cid';
process.env.YAHOO_CLIENT_SECRET = 'csecret';
process.env.SUPABASE_URL = 'https://sb.example.test';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
const KV = new Map();
let TOKEN_GRANTS = 0;

const { default: app } = await import('../server/app.js');
const { etDate, addDays } = await import('../server/nba.js');
const today = etDate();

// ── Yahoo-shaped fixtures ────────────────────────────────────────────────────
const stats = (o) => ({ stats: Object.entries(o).map(([stat_id, value]) => ({ stat: { stat_id, value } })) });
const player = (key, name, team, pos, slot, st, status) => ({
  player: [
    [{ player_key: key }, { name: { full: name } }, { editorial_team_abbr: team }, { display_position: pos },
      { eligible_positions: pos.split(',').map(position => ({ position })) }, ...(status ? [{ status }] : [])],
    { selected_position: [{ coverage_type: 'date' }, { position: slot }] },
    { player_stats: stats(st) },
  ],
});
const avg = { '9004003': '8/16', '5': '.500', '9007006': '4/5', '8': '.800', '10': '2', '12': '22', '15': '6', '16': '5', '17': '1', '18': '1', '19': '2' };
const roster = (players) => ({ fantasy_content: { team: [[{ team_key: 'x' }], { roster: { '0': { players: Object.assign({ count: players.length }, ...players.map((p, i) => ({ [i]: p }))) } } }] } });
const teamNode = (key, name, mine, st) => ({ team: [[{ team_key: key }, { name }, ...(mine ? [{ is_owned_by_current_login: 1 }] : [])], { team_stats: stats(st) }] });

const FIX = {
  'users;use_login=1/games;game_keys=nba/leagues/teams': { fantasy_content: { users: { '0': { user: [{ guid: 'g' }, { games: { '0': { game: [{ game_key: '466' }, { leagues: { '0': { league: [
    { league_key: '466.l.33458', league_id: '33458', name: 'Where Friendship Happens', current_week: 3, draft_status: 'predraft' },
    { teams: { '0': teamNode('466.l.33458.t.1', 'Me FC', true, {}), '1': teamNode('466.l.33458.t.2', 'Them', false, {}), count: 2 } },
  ] }, count: 1 } }] }, count: 1 } }] }, count: 1 } } },
  'team/466.l.33458.t.1/matchups;weeks=3': { fantasy_content: { team: [[{ team_key: '466.l.33458.t.1' }], { matchups: { '0': { matchup: { week: 3, '0': { teams: {
    '0': teamNode('466.l.33458.t.1', 'Me FC', true, { '9004003': '100/200', '5': '.500', '9007006': '40/50', '8': '.800', '10': '30', '12': '300', '15': '120', '16': '70', '17': '20', '18': '10', '19': '30' }),
    '1': teamNode('466.l.33458.t.2', 'Them', false, { '9004003': '90/200', '5': '.450', '9007006': '45/50', '8': '.900', '10': '31', '12': '280', '15': '130', '16': '60', '17': '15', '18': '12', '19': '25' }),
    count: 2 } } } }, count: 1 } }] } },
  'game/nba/game_weeks': { fantasy_content: { game: [{ game_key: '466' }, { game_weeks: {
    '0': { game_week: { week: '3', start: addDays(today, -2), end: addDays(today, 4) } },
    '1': { game_week: { week: '19', start: today, end: today } },
    '2': { game_week: { week: '20', start: addDays(today, 1), end: addDays(today, 1) } },
    '3': { game_week: { week: '21', start: addDays(today, 2), end: addDays(today, 4) } },
    count: 4 } }] } },
  'league/466.l.33458/settings': { fantasy_content: { league: [{ league_key: '466.l.33458' }, { settings: [{ playoff_start_week: '19' }] }] } },
  [`team/466.l.33458.t.1/roster;date=${today}/players/stats;type=average_season`]: roster([
    player('p1', 'Jayson Tatum', 'BOS', 'SF,PF', 'SF', avg),
    player('p2', 'Bench Guy', 'BOS', 'PG', 'BN', avg),
    player('p3', 'Idle Man', 'LAL', 'C', 'C', avg),
  ]),
  [`team/466.l.33458.t.1/roster;date=${addDays(today, 1)}/players/stats;type=average_season`]: roster([
    player('p1', 'Jayson Tatum', 'BOS', 'SF,PF', 'SF', avg),
    player('p2', 'Bench Guy', 'LAL', 'PG', 'BN', avg),
    player('p3', 'Idle Man', 'BOS', 'C', 'C', avg),
  ]),
  [`team/466.l.33458.t.2/roster;date=${today}/players/stats;type=average_season`]: roster([player('o1', 'Nikola Jokić', 'DEN', 'C', 'C', avg)]),
};
for (let s = 0; s < 50; s += 25) {
  FIX[`league/466.l.33458/players;sort=OR;start=${s};count=25/stats;type=average_season;season=2025`] = { fantasy_content: { league: [{ league_key: '466.l.33458' }, { players: Object.assign({ count: 25 },
    ...Array.from({ length: 25 }, (_, i) => ({ [i]: player(`k${s + i}`, `Player ${s + i}`, 'NY', 'PG,SG', '', { ...avg, '12': String(30 - (s + i) / 3) }) }))) }] } };
}

// History: current league renewed from 454.l.777
const mgrTeam = (key, name, guid, me, extra = []) => [{ team_key: key }, { name }, { number_of_moves: me ? 12 : 40 }, { number_of_trades: 0 },
  { managers: [{ manager: { guid, nickname: name.toLowerCase(), ...(me ? { is_current_login: '1' } : {}) } }] }, ...extra];
Object.assign(FIX, {
  'league/466.l.33458': { fantasy_content: { league: [{ league_key: '466.l.33458', season: '2026', name: 'WFH', num_teams: 2, renew: '454_777', is_finished: 0 }] } },
  'league/454.l.777': { fantasy_content: { league: [{ league_key: '454.l.777', season: '2025', name: 'WFH', num_teams: 2, renew: '', is_finished: 1, start_week: 1, end_week: 2, current_week: 2 }] } },
  'league/466.l.33458/teams': { fantasy_content: { league: [{}, { teams: { '0': { team: [mgrTeam('466.l.33458.t.1', 'Me FC', 'G1', true)] }, '1': { team: [mgrTeam('466.l.33458.t.2', 'Them', 'G2', false)] }, count: 2 } }] } },
  'league/454.l.777/standings': { fantasy_content: { league: [{}, { standings: [{ teams: {
    '0': { team: [mgrTeam('454.l.777.t.1', 'Old Me', 'G1', true), { team_standings: { rank: 2, playoff_seed: 2, outcome_totals: { wins: 5, losses: 7, ties: 1 } } }] },
    '1': { team: [mgrTeam('454.l.777.t.2', 'Old Them', 'G2', false), { team_standings: { rank: 1, playoff_seed: 1, outcome_totals: { wins: 7, losses: 5, ties: 1 } } }] },
    count: 2 } }] }] } },
  'league/454.l.777/draftresults': { fantasy_content: { league: [{}, { draft_results: {
    '0': { draft_result: { pick: 1, round: 1, team_key: '454.l.777.t.1', player_key: '454.p.1' } },
    '1': { draft_result: { pick: 2, round: 1, team_key: '454.l.777.t.2', player_key: '454.p.2' } },
    count: 2 } }] } },
  'league/454.l.777/players;player_keys=454.p.1,454.p.2/stats;type=season': { fantasy_content: { league: [{}, { players: { '0': player('454.p.1', 'Star One', 'BOS', 'PG', '', avg), '1': player('454.p.2', 'Star Two', 'DEN', 'C', '', avg), count: 2 } }] } },
  'league/454.l.777/players;player_keys=454.p.1,454.p.2/draft_analysis': { fantasy_content: { league: [{}, { players: { '0': { player: [[{ player_key: '454.p.1' }], { draft_analysis: [{ average_pick: '3.5' }, { average_round: '1' }] }] }, count: 1 } }] } },
});
for (const w of [1, 2]) {
  FIX[`league/454.l.777/scoreboard;week=${w}`] = { fantasy_content: { league: [{}, { scoreboard: { '0': { matchups: { '0': { matchup: {
    week: w, is_playoffs: w === 2 ? '1' : '0',
    stat_winners: [{ stat_winner: { stat_id: '8', winner_team_key: '454.l.777.t.2' } }, { stat_winner: { stat_id: '12', is_tied: '1' } }],
    '0': { teams: { '0': { team: [[{ team_key: '454.l.777.t.1' }]] }, '1': { team: [[{ team_key: '454.l.777.t.2' }]] }, count: 2 } },
  } }, count: 1 } }, week: w } }] } };
}

// ESPN-shaped fixtures (shapes captured from the live API)
const espnEvent = (id, date, home, away, extra = {}) => ({ id, date, season: { type: 2 }, competitions: [{ competitors: [
  { homeAway: 'home', team: { abbreviation: home }, score: extra.hs }, { homeAway: 'away', team: { abbreviation: away }, score: extra.as }],
  status: extra.status || { type: { state: 'pre', shortDetail: '7:30 PM' } } }] });
const boxRow = (name, s) => ({ athlete: { displayName: name }, starter: true, stats: s });
const KEYS = ['minutes', 'points', 'fieldGoalsMade-fieldGoalsAttempted', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'freeThrowsMade-freeThrowsAttempted', 'rebounds', 'assists', 'turnovers', 'steals', 'blocks', 'offensiveRebounds', 'defensiveRebounds', 'fouls', 'plusMinus'];
const ESPN = {
  schedule: team => ({ events: team === 'bos' ? [espnEvent('g1', `${today}T23:30Z`, 'BOS', 'DEN')]
    : team === 'lal' ? [espnEvent('g2', `${addDays(today, 1)}T23:30Z`, 'LAL', 'PHX')] : [] }),
  scoreboard: { events: [espnEvent('g1', `${today}T23:30Z`, 'BOS', 'DEN', { hs: '80', as: '77', status: { period: 3, displayClock: '4:12', type: { state: 'in', shortDetail: '4:12 - 3rd' } } })] },
  summary: { boxscore: { players: [
    { team: { abbreviation: 'BOS' }, statistics: [{ keys: KEYS, athletes: [boxRow('Jayson Tatum', ['28', '21', '8-15', '3-7', '2-2', '7', '4', '2', '1', '0', '1', '6', '2', '+5']), boxRow('Benchwarmer', [])] }] },
    { team: { abbreviation: 'DEN' }, statistics: [{ keys: KEYS, athletes: [boxRow('Nikola Jokic', ['30', '25', '10-16', '1-3', '4-5', '12', '9', '3', '2', '1', '3', '9', '3', '-5'])] }] },
  ] } },
};

// ESPN fantasy pool: 115 solid players, plus our roster (Tatum strong, Bench Guy weak)
const { espnSeason } = await import('../server/espn.js');
const espnP = (id, name, line) => ({ player: { id, fullName: name, proTeamId: 0, eligibleSlots: [0], ownership: { averageDraftPosition: id },
  stats: [{ id: `10${espnSeason()}`, averageStats: { 0: line.pts, 6: line.reb, 3: 3, 2: 1, 1: 0.5, 11: 1.5, 13: line.pts / 2.5, 14: line.pts / 1.25, 15: 2, 16: 2.5, 17: 1, 42: 70 } }] } });
const ESPN_POOL = { players: [
  espnP(1, 'Jayson Tatum', { pts: 27, reb: 8 }),
  ...Array.from({ length: 115 }, (_, i) => espnP(i + 2, `Filler ${i}`, { pts: 20 - i / 10, reb: 6 })),
  espnP(500, 'Bench Guy', { pts: 4, reb: 1 }),
  espnP(501, 'Lakers Big', { pts: 12, reb: 11 }),
  espnP(502, 'Nikola Jokić', { pts: 29, reb: 12 }),
] };

let server, base, realFetch;
before(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    url = String(url);
    if (url.startsWith('http://127.0.0.1')) return realFetch(url, opts);
    const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('get_token')) { TOKEN_GRANTS++; return json({ access_token: 'AT', refresh_token: 'RT2', expires_in: 3600 }); }
    if (url.startsWith('https://sb.example.test/rest/v1/laserbball_draft_sync')) {
      if (opts?.headers?.apikey !== 'sb_secret_test') return new Response('{"message":"bad key"}', { status: 401 });
      if ((opts?.method || 'GET') === 'GET') {
        const q = decodeURIComponent(new URL(url).searchParams.get('key'));
        if (q.startsWith('like.')) {
          const prefix = q.slice(5).replace(/\*$/, '');
          return json([...KV].filter(([k]) => k.startsWith(prefix)).map(([key, doc]) => ({ key, doc })));
        }
        const key = q.replace(/^eq\./, '');
        return json(KV.has(key) ? [{ doc: KV.get(key) }] : []);
      }
      const row = JSON.parse(opts.body);
      KV.set(row.key, row.doc);
      return new Response(null, { status: 201 });
    }
    if (url.includes('fantasysports.yahooapis.com')) {
      const path = decodeURIComponent(url.split('/fantasy/v2/')[1].split('?')[0]);
      if (FIX[path]) return json(FIX[path]);
      return new Response(`no fixture: ${path}`, { status: 400 });
    }
    if (url.includes('lm-api-reads.fantasy.espn.com')) return json(ESPN_POOL);
    if (url.includes('site.api.espn.com')) {
      const u = new URL(url);
      const team = /\/teams\/(\w+)\/schedule/.exec(u.pathname)?.[1];
      if (team) return json(ESPN.schedule(team));
      if (u.pathname.endsWith('/scoreboard')) return json(ESPN.scoreboard);
      if (u.pathname.endsWith('/summary') && u.searchParams.get('event') === 'g1') return json(ESPN.summary);
    }
    return new Response('nope', { status: 404 });
  };
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); globalThis.fetch = realFetch; });

const { clientTag } = await import('../server/yahoo.js');
const cookie = `hi_sess=${seal({ access_token: 'AT', refresh_token: 'RT', expires_at: Date.now() + 3e6, client: clientTag(), guid: 'GUID1' })}`;
const get = (p, auth = true) => realFetch(`${base}${p}`, { headers: auth ? { cookie } : {}, redirect: 'manual' });

test('auth status + redirect + 401 when not connected', async () => {
  assert.deepEqual(await (await get('/api/auth/status', false)).json(), { authed: false });
  assert.deepEqual(await (await get('/api/auth/status')).json(), { authed: true });
  const r = await get('/api/auth', false);
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location'));
  assert.equal(loc.searchParams.get('client_id'), 'cid');
  assert.equal(loc.searchParams.get('scope'), 'fspt-r');
  assert.match(loc.searchParams.get('redirect_uri'), /\/api\/auth\/callback$/);
  assert.equal(loc.searchParams.get('prompt'), null);
  const sw = new URL((await get('/api/auth?switch=1', false)).headers.get('location'));
  assert.equal(sw.searchParams.get('prompt'), 'login');
  assert.equal((await get('/api/leagues', false)).status, 401);
  assert.equal((await get('/api/nope')).status, 404);
});

test('login returns to the page it started from, same-site only', async () => {
  const { safeNext } = await import('../server/yahoo.js');
  assert.equal(safeNext('/draft'), '/draft');
  for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', '', undefined]) assert.equal(safeNext(bad), '/');
  const start = await get('/api/auth?next=%2Fdraft', false);
  const cookies = start.headers.getSetCookie().map(c => c.split(';')[0]);
  assert.ok(cookies.includes('hi_next=%2Fdraft'));
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const cb = await realFetch(`${base}/api/auth/callback?code=C&state=${state}`, { headers: { cookie: cookies.join('; ') }, redirect: 'manual' });
  assert.equal(cb.status, 302);
  assert.equal(cb.headers.get('location'), '/draft');
});

test('token refreshes are minimized: one per burst, shared across devices', async () => {
  // Each Yahoo refresh emails the user a "New sign in" notice
  const expired = `hi_sess=${seal({ access_token: null, expires_at: 0, refresh_token: 'RT', client: clientTag(), guid: 'GUID-TOK' })}`;
  TOKEN_GRANTS = 0;
  const warm = await realFetch(`${base}/api/auth/warm`, { method: 'POST', headers: { cookie: expired } });
  assert.deepEqual(await warm.json(), { ok: true });
  assert.equal(TOKEN_GRANTS, 1);
  // Another device (or a cookie that dropped the token for size) reuses it
  const calls = await Promise.all([1, 2, 3].map(() => realFetch(`${base}/api/context`, { headers: { cookie: expired } })));
  assert.ok(calls.every(r => r.status === 200));
  assert.equal(TOKEN_GRANTS, 1);
  assert.equal((await (await realFetch(`${base}/api/auth/warm`, { method: 'POST' })).json()).ok, false);
});

test('expired access token is refreshed and re-sealed', async () => {
  const stale = `hi_sess=${seal({ access_token: 'old', refresh_token: 'RT', expires_at: 0, client: clientTag() })}`;
  const r = await realFetch(`${base}/api/context`, { headers: { cookie: stale } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /hi_sess=/);
  const ctx = await r.json();
  assert.equal(ctx.teamKey, '466.l.33458.t.1');
  assert.equal(ctx.raw, undefined);
});

test('game night merges Yahoo + live box scores', async () => {
  const r = await get('/api/gamenight');
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  assert.equal(d.me.name, 'Me FC');
  assert.equal(d.opp.name, 'Them');
  const pts = d.categories.find(c => c.name === 'PTS');
  assert.equal(pts.leader, 'me');
  const to = d.categories.find(c => c.name === 'TO');
  assert.equal(to.leader, 'opp'); // fewer turnovers wins
  const tatum = d.players.me.find(p => p.name === 'Jayson Tatum');
  assert.equal(tatum.live.pts, 21);
  assert.equal(tatum.live.fga, 15);
  assert.equal(tatum.game.statusText, '4:12 - 3rd');
  assert.equal(pts.tonightMe, 21);           // bench guy's game doesn't count
  const jokic = d.players.opp.find(p => p.key === 'o1');
  assert.equal(jokic.live.pts, 25);          // accent-insensitive match
  assert.ok(d.alerts.some(a => a.when === 'today' && a.text.includes('Bench Guy')));
  assert.ok(d.alerts.some(a => a.when === 'tomorrow' && a.text.includes('Bench Guy')), JSON.stringify(d.alerts));
  assert.equal(d.liveCount, 1);
});

test('draft pool parses Yahoo players in rank order', async () => {
  const r = await get('/api/draft/pool?count=50&season=2025');
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  assert.equal(d.players.length, 50);
  assert.equal(d.players[0].yahooRank, 1);
  assert.deepEqual(d.players[0].pos, ['PG', 'SG']);
  assert.equal(d.players[0].fga, 16);
  assert.equal(d.statType, 'average_season');
});

test('schedule endpoints', async () => {
  const t = await (await get('/api/schedule/today')).json();
  assert.deepEqual(t.teamsPlaying.sort(), ['BOS', 'DEN']);
  const w = await (await get('/api/schedule/week-days')).json();
  assert.equal(w.schedule.LAL[0].opp, 'PHX');
});

test('history walks the renewal chain and parses a past season', async () => {
  const r = await get('/api/history/seasons');
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  assert.deepEqual(d.seasons.map(s => s.leagueKey), ['466.l.33458', '454.l.777']);
  assert.equal(d.currentTeams[1].managerId, 'G2');

  const s = await (await get('/api/history/season/454.l.777')).json();
  assert.equal(s.season, 2025);
  const me = s.teams.find(t => t.isMe);
  assert.equal(me.rank, 2);
  assert.equal(me.ties, 1);
  assert.equal(me.moves, 12);
  assert.equal(s.draft[0].name, 'Star One');
  assert.equal(s.draft[0].adp, 3.5);
  assert.equal(s.draft[1].adp, undefined);
  assert.equal(s.weeks.length, 2);
  assert.equal(s.weeks[0].matchups[0].winners['8'], '454.l.777.t.2');
  assert.equal(s.weeks[0].matchups[0].winners['12'], 'tie');
  assert.equal(s.weeks[1].matchups[0].isPlayoffs, true);

  assert.equal((await get('/api/history/season/bad;key')).status, 400);

  // Finished seasons are kept in the cloud store and served from it (login still required)
  assert.equal(s.isFinished, true);
  assert.equal(KV.get('hist:454.l.777').season, 2025);
  KV.get('hist:454.l.777').marker = 'cached';
  assert.equal((await (await get('/api/history/season/454.l.777')).json()).marker, 'cached');
  assert.equal((await (await get('/api/history/season/454.l.777?fresh=1')).json()).marker, undefined);
  assert.equal((await get('/api/history/season/454.l.777', false)).status, 401);
});

test('sessions from a different Yahoo app are treated as logged out', async () => {
  const other = `hi_sess=${seal({ access_token: 'AT', refresh_token: 'RT', expires_at: Date.now() + 3e6, client: 'deadbeef' })}`;
  const r = await realFetch(`${base}/api/auth/status`, { headers: { cookie: other } });
  assert.deepEqual(await r.json(), { authed: false });
  const d = await (await realFetch(`${base}/api/debug/yahoo`, { headers: { cookie: other } })).json();
  assert.equal(d.session.fromCurrentApp, false);
  const ok = await (await get('/api/debug/yahoo')).json();
  assert.equal(ok.calls['users;use_login=1/games;game_keys=nba/leagues/teams'].status, 200);
});

test('draft sync: one shared draft, no login or code needed', async () => {
  const put = body => realFetch(`${base}/api/me/draft`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const load = async () => (await realFetch(`${base}/api/me/draft`)).json();
  const doc = { settings: { teams: 8, rounds: 13, slot: 7 }, teamNames: { 7: 'Jared' }, picks: ['espn:1', 'espn:2'], updatedAt: 1000 };
  assert.equal((await put(doc)).status, 200);
  const got = await load();
  assert.equal(got.configured, true);
  assert.deepEqual(got.doc.picks, ['espn:1', 'espn:2']);
  assert.equal(got.doc.teamNames['7'], 'Jared');
  const stale = await (await put({ ...doc, picks: [], updatedAt: 500 })).json();
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.doc.picks, ['espn:1', 'espn:2']);
  assert.equal((await put({ picks: 'x', updatedAt: 1 })).status, 400);
});

test('this week: category odds, opponent scouting from history, streamers', async () => {
  // Opponent's manager (matches a manager in the stored 2025 history)
  const oppNode = FIX['team/466.l.33458.t.1/matchups;weeks=3'].fantasy_content.team[1].matchups['0'].matchup['0'].teams['1'].team;
  oppNode[0].push({ managers: [{ manager: { nickname: 'old them' } }] });
  const fa = (key, name, team, pos, pts, reb) => player(key, name, team, pos, '', { ...avg, '12': String(pts), '15': String(reb) });
  const faList = players => ({ fantasy_content: { league: [{ league_key: '466.l.33458' }, { players: Object.assign({ count: players.length }, ...players.map((p, i) => ({ [i]: p }))) }] } });
  const S = 'stats;type=average_season';
  FIX[`league/466.l.33458/players;status=FA;sort=OR;count=25/${S}`] = faList([fa('f1', 'Lakers Big', 'LAL', 'C', 12, 11), fa('f2', 'Idle Guard', 'NY', 'PG', 18, 3)]);
  FIX[`league/466.l.33458/players;status=FA;position=C;sort=OR;count=25/${S}`] = faList([fa('f1', 'Lakers Big', 'LAL', 'C', 12, 11)]);

  const r = await get(`/api/week?week=3&from=${today}`);
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  assert.equal(d.categories.length, 9);
  assert.ok(d.expectedWins > 0 && d.expectedWins < 9);
  const pts = d.categories.find(c => c.name === 'PTS');
  assert.equal(pts.mineNow, 300);
  assert.ok(pts.mineEnd > 300, 'my BOS players play today');
  assert.ok(d.categories.every(c => c.winProb >= 0 && c.winProb <= 1));
  const to = d.categories.find(c => c.name === 'TO');
  assert.equal(to.low, true);
  assert.equal(d.opp.manager, 'old them');
  assert.ok(d.scouting && d.scouting.seasons.length === 1, JSON.stringify(d.scouting));
  assert.equal(d.scouting.catWin['FT%'], 1); // won FT% in the stored regular-season week
  assert.equal(KV.get('snap:week').week, 3);   // latest result kept for review
  assert.ok(KV.get('snap:week').savedAt);

  const s = await (await get(`/api/week/streamers?week=3&from=${today}`)).json();
  assert.ok(Array.isArray(s.streamers), JSON.stringify(s));
  assert.equal(s.considered, 2);
  const big = s.streamers.find(x => x.name === 'Lakers Big');
  assert.equal(big.gamesLeft, 1);             // LAL plays tomorrow; adds start tomorrow
  const idle = s.streamers.find(x => x.name === 'Idle Guard');
  assert.equal(idle.gamesLeft, 0);
  assert.ok(big.gain > idle.gain);
  // Drop only someone not worth keeping all season; Tatum is protected
  assert.equal(s.drop.name, 'Bench Guy', JSON.stringify(s.dropOptions));
  assert.equal(s.drop.allKeepers, false);
  const opt = Object.fromEntries(s.dropOptions.map(o => [o.name, o]));
  assert.equal(opt['Jayson Tatum'].advice, 'Keep');
  assert.equal(opt['Bench Guy'].advice, 'Droppable');
  assert.ok(opt['Bench Guy'].rosRank > opt['Jayson Tatum'].rosRank);
  assert.equal(big.keeper, true);              // better than Bench Guy long-term
  assert.equal(s.addsLimit, 4);
});

test('alerts: no position-breaking lineup swap; playoff planner; trade checker', async () => {
  const a = await (await get('/api/alerts')).json();
  assert.ok(Array.isArray(a.alerts), JSON.stringify(a));
  // Bench Guy (PG) plays tomorrow, but the idle starters are SF and C: no valid swap
  assert.ok(!a.alerts.some(x => x.kind === 'lineup' && x.level === 'action'), JSON.stringify(a.alerts));
  assert.ok(a.alerts.some(x => x.kind === 'lineup' && x.text.includes('Bench Guy')));
  assert.equal(a.ilCapacity, 2);

  const p = await (await get('/api/playoffs')).json();
  assert.deepEqual(p.weeks.map(w => w.week), [19, 20, 21], JSON.stringify(p));
  const bos = p.teams.find(t => t.team === 'BOS');
  assert.deepEqual(bos.games, [1, 0, 0]);
  assert.equal(p.teams.find(t => t.team === 'LAL').games[1], 1);
  assert.ok(p.mine.find(x => x.name === 'Jayson Tatum').total === 1);

  const list = await (await get('/api/trade')).json();
  assert.equal(list.me.players.length, 3, JSON.stringify(list));
  assert.equal(list.teams.length, 1);
  const t = await (await get('/api/trade?partner=466.l.33458.t.2&give=p2&get=o1')).json();
  assert.deepEqual(t.give, ['Bench Guy'], JSON.stringify(t));
  assert.deepEqual(t.get, ['Nikola Jokić']);
  assert.ok(t.me.change > 0, String(t.me.change));
  assert.ok(t.me.after > t.me.before && t.me.after <= 9);
  assert.ok(t.partnerResult.change < 0);
  assert.equal((await get('/api/trade?partner=nope&give=p2')).status, 400);
});
