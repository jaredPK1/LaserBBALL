import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { seal } from '../server/session.js';

process.env.SESSION_SECRET = 'x'.repeat(40);
process.env.YAHOO_CLIENT_ID = 'cid';
process.env.YAHOO_CLIENT_SECRET = 'csecret';

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

const NBA = {
  'scheduleLeagueV2.json': { leagueSchedule: { gameDates: [
    { games: [{ gameId: '0022600100', gameDateEst: `${today}T00:00:00Z`, gameDateTimeUTC: `${today}T23:30:00Z`, homeTeam: { teamTricode: 'BOS' }, awayTeam: { teamTricode: 'DEN' } }] },
    { games: [{ gameId: '0022600101', gameDateEst: `${addDays(today, 1)}T00:00:00Z`, homeTeam: { teamTricode: 'LAL' }, awayTeam: { teamTricode: 'PHX' } }] },
  ] } },
  'todaysScoreboard_00.json': { scoreboard: { gameDate: today, games: [{ gameId: '0022600100', gameStatus: 2, gameStatusText: 'Q3 4:12', period: 3, gameClock: 'PT04M12.00S', homeTeam: { teamTricode: 'BOS', score: 80 }, awayTeam: { teamTricode: 'DEN', score: 77 } }] } },
  'boxscore_0022600100.json': { game: {
    homeTeam: { teamTricode: 'BOS', players: [{ name: 'Jayson Tatum', oncourt: '1', played: '1', statistics: { minutes: 'PT28M10.00S', points: 21, reboundsTotal: 7, assists: 4, steals: 1, blocks: 0, threePointersMade: 3, fieldGoalsMade: 8, fieldGoalsAttempted: 15, freeThrowsMade: 2, freeThrowsAttempted: 2, turnovers: 2 } }] },
    awayTeam: { teamTricode: 'DEN', players: [{ name: 'Nikola Jokic', oncourt: '0', played: '1', statistics: { minutes: 'PT30M00.00S', points: 25, reboundsTotal: 12, assists: 9, steals: 2, blocks: 1, threePointersMade: 1, fieldGoalsMade: 10, fieldGoalsAttempted: 16, freeThrowsMade: 4, freeThrowsAttempted: 5, turnovers: 3 } }] },
  } },
};

let server, base, realFetch;
before(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    url = String(url);
    if (url.startsWith('http://127.0.0.1')) return realFetch(url, opts);
    const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('get_token')) return json({ access_token: 'AT', refresh_token: 'RT2', expires_in: 3600 });
    if (url.includes('fantasysports.yahooapis.com')) {
      const path = decodeURIComponent(url.split('/fantasy/v2/')[1].split('?')[0]);
      if (FIX[path]) return json(FIX[path]);
      return new Response(`no fixture: ${path}`, { status: 400 });
    }
    const file = url.split('/').pop();
    if (NBA[file]) return json(NBA[file]);
    return new Response('nope', { status: 404 });
  };
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); globalThis.fetch = realFetch; });

const cookie = `hi_sess=${seal({ access_token: 'AT', refresh_token: 'RT', expires_at: Date.now() + 3e6 })}`;
const get = (p, auth = true) => realFetch(`${base}${p}`, { headers: auth ? { cookie } : {}, redirect: 'manual' });

test('auth status + redirect + 401 when not connected', async () => {
  assert.deepEqual(await (await get('/api/auth/status', false)).json(), { authed: false });
  assert.deepEqual(await (await get('/api/auth/status')).json(), { authed: true });
  const r = await get('/api/auth', false);
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location'));
  assert.equal(loc.searchParams.get('client_id'), 'cid');
  assert.match(loc.searchParams.get('redirect_uri'), /\/api\/auth\/callback$/);
  assert.equal((await get('/api/leagues', false)).status, 401);
  assert.equal((await get('/api/nope')).status, 404);
});

test('expired access token is refreshed and re-sealed', async () => {
  const stale = `hi_sess=${seal({ access_token: 'old', refresh_token: 'RT', expires_at: 0 })}`;
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
  assert.equal(tatum.live.onCourt, true);
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
