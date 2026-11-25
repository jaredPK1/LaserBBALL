import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitsSlot, seasonStrength } from '../server/manage.js';

test('slot eligibility', () => {
  assert.equal(fitsSlot('SF', ['PG', 'SG', 'G']), false);
  assert.equal(fitsSlot('G', ['PG']), true);
  assert.equal(fitsSlot('F', ['PF']), true);
  assert.equal(fitsSlot('Util', ['C']), true);
  assert.equal(fitsSlot('C', ['PF', 'C']), true);
});

test('lineup: rearranges so a center fills a guard\'s vacated slot', async () => {
  const { bestLineup, describe } = await import('../server/lineup.js');
  const P = (name, slot, pos, status = '', v = 1) => ({ key: name, name, slot, pos, displayPos: pos.join(','), status, v });
  // Kawhi (out) sits in G; Allen (C) is on the bench and can't take G directly
  const roster = [
    P('Mitchell', 'PG', ['PG', 'SG']), P('Braun', 'SG', ['SG', 'SF']), P('Kawhi', 'G', ['SG', 'SF', 'PF'], 'O', 9),
    P('Jones', 'SF', ['SF', 'PF']), P('Buzelis', 'PF', ['SF', 'PF']), P('Powell', 'F', ['SG', 'SF']),
    P('Lopez', 'C', ['C']), P('Turner', 'C', ['C']), P('NAW', 'Util', ['PG', 'SG']), P('Maxey', 'Util', ['PG'], 'O', 9),
    P('Allen', 'BN', ['C'], '', 5), P('Sarr', 'BN', ['C'], '', 4), P('Reid', 'BN', ['PF', 'C'], '', 3),
    P('Duren', 'IL', ['C'], 'O'),
  ];
  const plan = bestLineup(roster, { plays: () => true, value: p => p.v });
  const at = Object.fromEntries(plan.lineup.map(p => [p.name, p.slot]));
  assert.equal(at.Kawhi, 'BN');
  assert.equal(at.Maxey, 'BN');
  assert.equal(at.Allen === 'BN' || at.Sarr === 'BN', false, JSON.stringify(at)); // both bigs start
  assert.equal(plan.starters, 10);
  assert.ok(!plan.lineup.some(p => p.name === 'Duren'), 'IL players are left alone');
  assert.deepEqual(plan.idleStarters.sort(), ['Kawhi', 'Maxey']);
  assert.ok(describe(plan.moves).includes('Bench Kawhi (O)'));
  // Every starter fits his slot
  const { fitsSlot } = await import('../server/lineup.js');
  for (const p of plan.lineup.filter(x => x.slot !== 'BN')) assert.ok(fitsSlot(p.slot, roster.find(r => r.name === p.name).pos), p.name);
});

test('lineup: no game means bench, best players start, nothing moves when already right', async () => {
  const { bestLineup } = await import('../server/lineup.js');
  const P = (name, slot, pos, v) => ({ key: name, name, slot, pos, displayPos: pos.join(','), status: '', v });
  const roster = [P('A', 'PG', ['PG'], 5), P('B', 'BN', ['PG'], 9), P('C', 'C', ['C'], 5)];
  const plan = bestLineup(roster, { plays: p => p.name !== 'C', value: p => p.v });
  const at = Object.fromEntries(plan.lineup.map(p => [p.name, p.slot]));
  assert.equal(at.C, 'BN');                 // no game tonight
  assert.ok(at.A !== 'BN' && at.B !== 'BN'); // both guards play (PG + G/Util)
  const settled = plan.lineup.map(p => ({ ...roster.find(r => r.name === p.name), slot: p.slot }));
  assert.equal(bestLineup(settled, { plays: p => p.name !== 'C', value: p => p.v }).moves.length, 0);
});

test('lineup XML for Yahoo escapes values', async () => {
  const { rosterXml } = await import('../server/lineup.js');
  const xml = rosterXml('2026-11-20', [{ key: '466.p.1', slot: 'PG' }, { key: '466.p.2', slot: 'BN' }]);
  assert.match(xml, /<coverage_type>date<\/coverage_type><date>2026-11-20<\/date>/);
  assert.match(xml, /<player><player_key>466\.p\.1<\/player_key><position>PG<\/position><\/player>/);
  assert.match(rosterXml('x', [{ key: '<a>', slot: 'C' }]), /&#60;a&#62;/);
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

test('swap signals: only-at-his-position check and value nudges', async () => {
  const { slotShortages, adjustedValue } = await import('../server/swap.js');
  const P = (id, posList, extra = {}) => ({ id, posList, slot: 'BN', status: '', ...extra });
  const short = slotShortages([P('c1', ['C']), P('pf', ['PF']), P('pg', ['PG']), P('sg', ['SG', 'PG']), P('hurt', ['C'], { status: 'O' })]);
  assert.ok(short.get('c1').includes('C'), 'only healthy C (the injured one does not count)');
  assert.deepEqual(short.get('pg'), [], 'the SG can also play PG');
  assert.ok(short.get('pf').includes('PF'));
  assert.equal(short.has('hurt'), false);
  const base = adjustedValue(0, { owned: 10, playoffGames: 10, playoffAvg: 10, trend: 0, shortSlots: [] });
  assert.equal(base, 0);
  assert.ok(adjustedValue(0, { owned: 80 }) > base, 'hard to get back');
  assert.ok(adjustedValue(0, { playoffGames: 12, playoffAvg: 10 }) > adjustedValue(0, { playoffGames: 8, playoffAvg: 10 }));
  assert.ok(adjustedValue(0, { trend: 0.4 }) > adjustedValue(0, { trend: -0.4 }));
  assert.equal(adjustedValue(0, { trend: 5 }), adjustedValue(0, { trend: 0.6 }), 'capped');
});
