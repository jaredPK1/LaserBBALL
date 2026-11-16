import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phi, projectRemaining, categoryOdds, expectedWins } from '../server/weekly.js';

const rates = (o = {}) => ({ fgm: 5, fga: 10, ftm: 2, fta: 3, tpm: 1, pts: 13, reb: 5, ast: 3, stl: 1, blk: 0.5, to: 1.5, ...o });
const zero = { fgm: 0, fga: 0, ftm: 0, fta: 0, tpm: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0 };

test('normal CDF', () => {
  assert.ok(Math.abs(phi(0) - 0.5) < 1e-6);
  assert.ok(Math.abs(phi(1.96) - 0.975) < 1e-3);
  assert.ok(Math.abs(phi(-1) - 0.1587) < 1e-3);
});

test('at most 10 players count per day; IL/out players and date windows respected', () => {
  const games = { BOS: new Set(['d1', 'd2']) };
  const players = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, team: 'BOS', avail: 1, rates: rates({ pts: 10 + i }) }));
  players.push({ id: 'il', team: 'BOS', avail: 0, rates: rates({ pts: 99 }) });
  players.push({ id: 'late', team: 'BOS', avail: 1, from: 'd2', rates: rates({ pts: 50 }) });
  const r = projectRemaining(players, games, ['d1', 'd2']);
  assert.equal(r.gamesUsed.get('il'), undefined);
  assert.equal(r.gamesUsed.get('late'), 1);
  assert.equal(r.gamesUsed.get('p0'), undefined);     // lowest value sits both nights
  const total = [...r.gamesUsed.values()].reduce((a, b) => a + b, 0);
  assert.equal(total, 20);
});

test('odds: bigger lead → higher win chance; fewer turnovers wins TO; no games left is decided', () => {
  const cur = { me: { ...zero, pts: 100, to: 10, fgm: 40, fga: 80 }, opp: { ...zero, pts: 90, to: 20, fgm: 30, fga: 80 } };
  const none = { mean: { ...zero }, vars: {} };
  const done = categoryOdds(cur, none, none);
  assert.equal(done.find(c => c.name === 'PTS').winProb, 1);
  assert.equal(done.find(c => c.name === 'TO').winProb, 1);
  assert.equal(done.find(c => c.name === 'FG%').winProb, 1);
  assert.equal(done.find(c => c.name === 'AST').winProb, 0.5);

  const games = { BOS: new Set(['d1', 'd2', 'd3']), DEN: new Set(['d1', 'd2', 'd3']) };
  const me = projectRemaining([{ id: 'a', team: 'BOS', avail: 1, rates: rates() }], games, ['d1', 'd2', 'd3']);
  const opp = projectRemaining([{ id: 'b', team: 'DEN', avail: 1, rates: rates({ pts: 20 }) }], games, ['d1', 'd2', 'd3']);
  const odds = categoryOdds({ me: { ...zero }, opp: { ...zero } }, me, opp);
  const pts = odds.find(c => c.name === 'PTS');
  assert.ok(pts.winProb < 0.5 && pts.winProb > 0);
  const e = expectedWins(odds);
  assert.ok(e > 0 && e < 9);
});

test('real stats get more weight as the season goes on', async () => {
  const { realWeight, ratesFor } = await import('../server/weekly.js');
  assert.equal(realWeight(1), 0);
  assert.ok(realWeight(2) > 0.2 && realWeight(2) < 0.35);
  assert.ok(realWeight(8) > realWeight(4));
  assert.ok(realWeight(30) <= 0.85);
  const espn = new Map([['test guy', { name: 'Test Guy', projected: true, pts: 10, reb: 5, ast: 2, stl: 1, blk: 1, tpm: 1, to: 1, fgm: 4, fga: 9, ftm: 1, fta: 2 }]]);
  const player = { name: 'Test Guy', stats: { '9004003': '8/16', '9007006': '2/2', '10': '2', '12': '20', '15': '9', '16': '2', '17': '1', '18': '1', '19': '1' } };
  assert.equal(ratesFor(player, espn, 0).rates.pts, 10);         // no games yet: projection only
  const half = ratesFor(player, espn, 0.5);
  assert.equal(half.rates.pts, 15);
  assert.equal(half.rates.reb, 7);
  assert.match(half.src, /50% this season/);
  assert.equal(ratesFor({ name: 'Nobody', stats: player.stats }, espn, 0.5).rates.pts, 20); // no projection: actual
  // Yahoo's games played beats the week estimate: 24 games → 75% actual
  assert.equal(ratesFor({ ...player, stats: { ...player.stats, '0': '24' } }, espn, 0.1).rates.pts, 17.5);
});

test('season rank follows real stats, not just the projection', async () => {
  const { rosOf } = await import('../server/weekly.js');
  const { computeValues } = await import('../src/draft/engine.js');
  // Every category gets worse with i, so value order = i order
  const line = (pts, stl, i = 0) => ({ pts, stl, reb: 9 - i * 0.04, ast: 3, blk: 1.5 - i * 0.008, tpm: 3 - i * 0.015, to: 1 + i * 0.005,
    fga: pts / 2.2, fgm: (pts / 2.2) * (0.52 - i * 0.0005), fta: 4 - i * 0.02, ftm: (4 - i * 0.02) * (0.85 - i * 0.0005) });
  const nm = i => `Guy ${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`;
  const pool = Array.from({ length: 150 }, (_, i) => ({ name: nm(i), ...line(25 - i * 0.12, 1.5 - i * 0.006, i), yahooRank: i + 1 }));
  const valued = computeValues(pool, { teams: 8, rounds: 13 });
  const { normName } = await import('../server/nba.js');
  const espn = new Map(valued.map(p => [normName(p.name), { ...p, rosValue: p.value, rosRank: p.valueRank }]));
  espn.score = valued.scorer;
  espn.values = valued.map(p => p.value);
  const proj = rosOf(nm(20), espn);
  assert.equal(proj.rosRank, 21);
  const cold = rosOf(nm(20), espn, line(10, 0.4, 140));      // playing far below his projection
  assert.ok(cold.rosRank > 100, String(cold.rosRank));
  const hot = rosOf(nm(120), espn, line(24, 1.5, 5));      // free agent playing like a starter
  assert.ok(hot.rosRank < 20, String(hot.rosRank));
});

test('league ripple: standings projection, rooting interest, free-agent value per team', async () => {
  const { projectStandings, rootingInterest } = await import('../server/league.js');
  const st = projectStandings([
    { key: 'me', wins: 10, losses: 8, ties: 0 }, { key: 'a', wins: 11, losses: 7, ties: 0 },
    { key: 'b', wins: 2, losses: 16, ties: 0 }, { key: 'c', wins: 9, losses: 9, ties: 0 },
  ], { me: 6, a: 3, b: 6, c: 3 });
  assert.equal(st[0].key, 'me');
  assert.equal(st.find(t => t.key === 'a').projL, 13);
  const root = rootingInterest([{ a: 'me', b: 'a' }, { a: 'b', b: 'c' }], st, 'me');
  assert.equal(root['b|c'].against, 'c');   // c is near you; b is far behind
  assert.equal(root['me|a'], undefined);
});
