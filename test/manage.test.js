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

test('trade finder: only deals that help you without hurting the other side', async () => {
  const { findTrades } = await import('../server/manage.js');
  const r = (o) => ({ fgm: 6, fga: 13, ftm: 2, fta: 2.6, tpm: 1.5, pts: 15, reb: 5, ast: 3, stl: 1, blk: 0.6, to: 1.5, ...o });
  const pl = (name, o, rosValue = 1) => ({ key: name, name, rates: r(o), avail: 1, durability: 1, rosValue });
  const avgTeam = k => ({ key: k, name: k, manager: k, players: Array.from({ length: 10 }, (_, i) => pl(`${k}${i}`, {})) });
  // Me: loaded on bigs, short on threes; partner: the opposite
  const me = { key: 'me', name: 'me', players: [...Array.from({ length: 7 }, (_, i) => pl(`m${i}`, {})), ...['A', 'B', 'C'].map(x => pl(`Big ${x}`, { reb: 12, blk: 2, tpm: 0 }))] };
  const pt = { key: 'pt', name: 'pt', manager: 'pt', players: [...Array.from({ length: 7 }, (_, i) => pl(`p${i}`, {})), ...['A', 'B', 'C'].map(x => pl(`Shooter ${x}`, { tpm: 4, reb: 3, blk: 0.2 }))] };
  const teams = [me, pt, ...['x', 'y', 'z'].map(avgTeam)];
  const ideas = findTrades(me, teams, { fas: [pl('FA', {}, 0.5)] });
  assert.ok(ideas.length > 0);
  for (const d of ideas) {
    assert.ok(d.myGain >= 0.05 && d.theirGain >= -0.03, JSON.stringify(d));
    assert.ok(d.give.length >= 1 && d.get);
  }
  assert.ok(ideas.some(d => d.partner.key === 'pt' && d.get.startsWith('Shooter') && d.youGain.includes('3PTM')), JSON.stringify(ideas.slice(0, 3)));
  // One idea per player you'd get, so the list isn't three copies of one deal
  const gets = ideas.map(d => `${d.partner.key}:${d.get}`);
  assert.equal(new Set(gets).size, gets.length);
});
