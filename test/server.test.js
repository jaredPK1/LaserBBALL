import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { seal } from '../server/session.js';

process.env.SESSION_SECRET = 'x'.repeat(40);
process.env.YAHOO_CLIENT_ID = 'cid';
process.env.YAHOO_CLIENT_SECRET = 'csecret';
process.env.KV_REST_API_URL = 'https://kv.example.test';
process.env.KV_REST_API_TOKEN = 'kvtoken';
const KV = new Map();

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
  'game/nba/game_weeks': { fantasy_content: { game: [{ game_key: '466' }, { game_weeks: { '0': { game_week: { week: '3', start: addDays(today, -2), end: addDays(today, 4) } }, count: 1 } }] } },
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

let server, base, realFetch;
before(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    url = String(url);
    if (url.startsWith('http://127.0.0.1')) return realFetch(url, opts);
    const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('get_token')) return json({ access_token: 'AT', refresh_token: 'RT2', expires_in: 3600 });
    if (url.startsWith('https://kv.example.test')) {
      const [cmd, key, val] = JSON.parse(opts.body);
      if (cmd === 'GET') return json({ result: KV.get(key) ?? null });
      if (cmd === 'SET') { KV.set(key, val); return json({ result: 'OK' }); }
    }
    if (url.includes('fantasysports.yahooapis.com')) {
      const path = decodeURIComponent(url.split('/fantasy/v2/')[1].split('?')[0]);
      if (FIX[path]) return json(FIX[path]);
      return new Response(`no fixture: ${path}`, { status: 400 });
    }
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
  assert.equal((await get('/api/leagues', false)).status, 401);
  assert.equal((await get('/api/nope')).status, 404);
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

test('profile-linked draft sync: save, load, stale guard, login required', async () => {
  const put = (body, c = cookie) => realFetch(`${base}/api/me/draft`, { method: 'PUT', headers: { cookie: c, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const doc = { settings: { teams: 8, rounds: 13, slot: 7 }, teamNames: { 7: 'Jared' }, picks: ['espn:1', 'espn:2'], updatedAt: 1000 };
  assert.equal((await put(doc)).status, 200);
  const got = await (await get('/api/me/draft')).json();
  assert.equal(got.configured, true);
  assert.deepEqual(got.doc.picks, ['espn:1', 'espn:2']);
  assert.equal(got.doc.teamNames['7'], 'Jared');
  const stale = await (await put({ ...doc, picks: [], updatedAt: 500 })).json();
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.doc.picks, ['espn:1', 'espn:2']);
  assert.equal((await get('/api/me/draft', false)).status, 401);
  assert.equal((await put({ picks: 'x', updatedAt: 1 })).status, 400);
  const noGuid = `hi_sess=${seal({ access_token: 'AT', refresh_token: 'RT', expires_at: Date.now() + 3e6, client: clientTag() })}`;
  assert.equal((await realFetch(`${base}/api/me/draft`, { headers: { cookie: noGuid } })).status, 401);
});
