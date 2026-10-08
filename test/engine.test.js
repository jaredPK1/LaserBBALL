import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeValues, teamOnClock, picksForSlot, slotFill, recommend, importProjections, DEFAULT_SETTINGS } from '../src/draft/engine.js';

const mk = (key, pos, s) => ({ key, name: key, pos, yahooRank: Number(key.slice(1)), hasStats: true,
  fgm: 7, fga: 15, ftm: 3, fta: 4, tpm: 1.5, pts: 18, reb: 5, ast: 4, stl: 1, blk: 0.5, to: 2, ...s });

test('snake order', () => {
  assert.deepEqual(teamOnClock(1, 10), { round: 1, team: 1, inRound: 1 });
  assert.equal(teamOnClock(10, 10).team, 10);
  assert.equal(teamOnClock(11, 10).team, 10);
  assert.equal(teamOnClock(20, 10).team, 1);
  assert.equal(teamOnClock(21, 10).team, 1);
  assert.deepEqual(picksForSlot(3, 10, 4), [3, 18, 23, 38]);
});

test('turnovers count against value; percentages are volume weighted', () => {
  const pool = Array.from({ length: 40 }, (_, i) => mk(`p${i + 1}`, ['SF'], { pts: 10 + (i % 7) }));
  pool.push(mk('p41', ['PG'], { to: 6 }));
  pool.push(mk('p42', ['PG'], { to: 0.5 }));
  pool.push(mk('p43', ['C'], { fgm: 12, fga: 18 }));  // 67% on high volume
  pool.push(mk('p44', ['C'], { fgm: 2, fga: 3 }));    // 67% on tiny volume
  const v = computeValues(pool, { teams: 4, rounds: 10, weights: DEFAULT_SETTINGS.weights });
  const get = k => v.find(p => p.key === k);
  assert.ok(get('p41').z.to < 0 && get('p42').z.to > 0);
  assert.ok(get('p43').z.fg > get('p44').z.fg);
});

test('punting a category removes it from value', () => {
  const pool = [mk('p1', ['C'], { ft: 0, ftm: 1, fta: 6, blk: 3 }), ...Array.from({ length: 30 }, (_, i) => mk(`p${i + 2}`, ['SG'], {}))];
  const w = { ...DEFAULT_SETTINGS.weights };
  const normal = computeValues(pool, { teams: 3, rounds: 10, weights: w }).find(p => p.key === 'p1').value;
  const punt = computeValues(pool, { teams: 3, rounds: 10, weights: { ...w, ft: 0 } }).find(p => p.key === 'p1').value;
  assert.ok(punt > normal);
});

test('players without stats sort to the bottom', () => {
  const pool = [{ key: 'r1', name: 'Rookie', pos: ['SF'], yahooRank: 5, hasStats: false, pts: 0 }, ...Array.from({ length: 30 }, (_, i) => mk(`p${i + 1}`, ['SG'], {}))];
  const v = computeValues(pool, { teams: 3, rounds: 10 });
  assert.equal(v.at(-1).key, 'r1');
  assert.equal(v.at(-1).value, null);
});

test('slot fill uses flexible slots correctly', () => {
  const r = slotFill([mk('a1', ['PG']), mk('a2', ['PG', 'SG']), mk('a3', ['C']), mk('a4', ['C']), mk('a5', ['C'])]);
  assert.equal(r.filled.filter(f => f.player).length, 5);
  assert.ok(r.open.includes('SF') && r.open.includes('PF') && r.open.includes('F'));
});

test('recommend boosts a slot-filler when picks are scarce', () => {
  const pool = computeValues([...Array.from({ length: 30 }, (_, i) => mk(`p${i + 1}`, ['PG'], {})), mk('p31', ['C'], {})], { teams: 3, rounds: 10 });
  const mine = pool.filter(p => p.pos.includes('PG')).slice(0, 8);
  const avail = pool.filter(p => !mine.includes(p));
  const recs = recommend(avail, mine, DEFAULT_SETTINGS.weights, 3);
  const c = recs.find(p => p.key === 'p31');
  assert.ok(c.fillsSlot);
  assert.ok(recs.filter(p => p.key !== 'p31').every(p => p.fit < c.fit));
});

test('CSV import matches names and adds unknowns', () => {
  const pool = [mk('p1', ['PG'], { name: 'Luka Dončić' })];
  pool[0].name = 'Luka Dončić';
  const csv = 'Player,Team,Pos,PTS,REB,AST,STL,BLK,3PM,TO,FG%,FT%\n"Luka Doncic",DAL,PG,33,9,9,1.4,0.5,3.5,4,47.5,78\nCooper Flagg,DAL,SF/PF,20,7,4,1.4,1,1.5,2.5,0.46,0.8\n';
  const r = importProjections(pool, csv);
  assert.equal(r.matched, 1);
  assert.equal(r.added, 1);
  const luka = r.players.find(p => p.key === 'p1');
  assert.equal(luka.pts, 33);
  assert.ok(Math.abs(luka.fgm / luka.fga - 0.475) < 1e-9);
  const flagg = r.players.find(p => p.name === 'Cooper Flagg');
  assert.deepEqual(flagg.pos, ['SF', 'PF']);
});
