import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, draftOutcomes, scoutingNotes } from '../src/history/analyze.js';

// 4-team toy league over 2 seasons. "me" (t1) always loses FT% and rarely moves.
function season(year, { meRank = 3 } = {}) {
  const lk = `4${year}.l.1`;
  const tk = n => `${lk}.t.${n}`;
  const teams = [1, 2, 3, 4].map(n => ({
    teamKey: tk(n), name: `Team ${n}`, managerId: `g${n}`, nickname: `mgr${n}`, isMe: n === 1,
    rank: n === 1 ? meRank : n === 2 ? 1 : n === 3 ? (meRank === 2 ? 3 : 2) : 4, seed: n !== 4 ? n : null,
    wins: 10, losses: 8, ties: 0, moves: n === 1 ? 10 : 50, trades: n === 2 ? 3 : 0,
  }));
  const weeks = Array.from({ length: 10 }, (_, w) => ({
    week: w + 1,
    matchups: [
      { teams: [tk(1), tk(2)], winners: { 8: tk(2), 12: tk(1), 19: 'tie' }, isPlayoffs: false },
      { teams: [tk(3), tk(4)], winners: { 8: tk(3), 12: tk(4), 19: tk(3) }, isPlayoffs: false },
    ],
  }));
  weeks.push({ week: 11, matchups: [{ teams: [tk(1), tk(2)], winners: { 8: tk(1) }, isPlayoffs: true }] });
  // 4 rounds; t2 always takes a C first and loves BOS. My first pick busts.
  const draft = [];
  let pick = 1;
  for (let r = 1; r <= 4; r++) {
    const order = r % 2 ? [1, 2, 3, 4] : [4, 3, 2, 1];
    for (const n of order) {
      const bust = n === 1 && r <= 2;
      draft.push({
        pick, round: r, teamKey: tk(n), playerKey: `p${year}_${pick}`, name: `P${pick}`,
        team: n === 2 ? 'BOS' : ['LAL', 'NYK', 'MIA', 'DEN', 'PHX'][pick % 5],
        pos: n === 2 && r <= 2 ? ['C'] : ['SG'],
        pts: bust ? 1 : 30 - pick, reb: 5, ast: 3, stl: 1, blk: 0.5, tpm: 1, to: 2, fgm: 6, fga: 13, ftm: 3, fta: 4,
        adp: n === 1 ? pick + 6 : pick,
      });
      pick++;
    }
  }
  return { leagueKey: lk, season: year, isFinished: true, numTeams: 4, teams, draft, weeks };
}

test('draft outcomes rank by actual production', () => {
  const o = draftOutcomes(season(2024));
  const bust = o.find(p => p.pick === 1);
  assert.ok(bust.finish >= 15);
  assert.ok(bust.roi <= -14);
  assert.equal(bust.reach, 6);
});

test('blind spots: categories, activity, early-draft busts, reaches', () => {
  const a = analyze([season(2024), season(2025, { meRank: 2 })], [{ managerId: 'g2', teamKey: 'x', name: 'Current Two' }]);
  assert.ok(a.me.isMe);
  const ft = a.catTable.find(c => c.label === 'FT%');
  assert.equal(ft.me, 0);                 // playoff win ignored
  assert.equal(a.catTable.find(c => c.label === 'PTS').me, 1);
  assert.equal(a.catTable.find(c => c.label === 'TO').me, 0.5);
  const text = a.insights.map(i => i.text).join('\n');
  assert.match(text, /FT% in only 0%/);
  assert.match(text, /moves per season/);
  assert.match(text, /rounds 1–3 picks finished/);
  assert.match(text, /before their ADP/);
  assert.deepEqual(a.me.finishes, [3, 2]);
});

test('scouting picks up tendencies and links current teams', () => {
  const a = analyze([season(2024), season(2025)], [{ managerId: 'g2', teamKey: 'x', name: 'Current Two' }]);
  const two = a.scouting.find(p => p.id === 'g2');
  assert.equal(two.current.name, 'Current Two');
  assert.equal(a.scouting[0].id, 'g2'); // current managers first
  assert.equal(two.firstCRound, 1);
  assert.equal(two.homer[0].team, 'BOS');
  assert.equal(two.titles, 2);
  const notes = scoutingNotes(two).join(' | ');
  assert.match(notes, /takes a C by rd 1/);
  assert.match(notes, /homer: BOS/);
  assert.match(notes, /open to trades/);
});
