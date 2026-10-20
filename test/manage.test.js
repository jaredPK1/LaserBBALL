import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitsSlot, lineupSwaps, seasonStrength } from '../server/manage.js';

test('slot eligibility', () => {
  assert.equal(fitsSlot('SF', ['PG', 'SG', 'G']), false);
  assert.equal(fitsSlot('G', ['PG']), true);
  assert.equal(fitsSlot('F', ['PF']), true);
  assert.equal(fitsSlot('Util', ['C']), true);
  assert.equal(fitsSlot('C', ['PF', 'C']), true);
});

test('lineup swaps respect positions and use each slot once', () => {
  const plays = new Set(['bench PG', 'bench C', 'starter G']);
  const P = (name, slot, pos, status = '') => ({ name, slot, pos, displayPos: pos.join(','), status });
  const roster = [
    P('idle SF', 'SF', ['SF']),
    P('idle Util', 'Util', ['PG']),
    P('out C', 'C', ['C'], 'O'),
    P('starter G', 'G', ['PG']),
    P('bench PG', 'BN', ['PG']),
    P('bench C', 'BN', ['C']),
  ];
  const { swaps, stuck } = lineupSwaps(roster, p => plays.has(p.name));
  assert.deepEqual(swaps.map(s => `${s.start}->${s.slot}`), ['bench PG->Util', 'bench C->C']);
  assert.equal(swaps[1].reason, 'O');
  assert.deepEqual(stuck, []);
  // A guard can't fill the SF hole
  const r2 = lineupSwaps([P('idle SF', 'SF', ['SF']), P('bench PG', 'BN', ['PG'])], p => p.name === 'bench PG');
  assert.deepEqual(r2.swaps, []);
  assert.deepEqual(r2.stuck, ['bench PG']);
});

test('season strength rises when you add a better player', () => {
  const rates = (pts, reb) => ({ fgm: pts / 2.5, fga: pts / 1.25, ftm: 2, fta: 2.5, tpm: 1, pts, reb, ast: 3, stl: 1, blk: 0.5, to: 1.5 });
  const pl = (pts, reb) => ({ rates: rates(pts, reb), avail: 1, durability: 1 });
  const base = Array.from({ length: 10 }, () => pl(15, 5));
  const others = Array.from({ length: 7 }, () => Array.from({ length: 10 }, () => pl(15, 5)));
  const even = seasonStrength(base, others);
  assert.ok(Math.abs(even.expected - 4.5) < 0.3, String(even.expected));
  const better = seasonStrength([...base.slice(1), pl(28, 11)], others);
  assert.ok(better.expected > even.expected);
  assert.ok(better.cats.find(c => c.name === 'REB').winProb > 0.5);
});
