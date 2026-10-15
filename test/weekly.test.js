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
