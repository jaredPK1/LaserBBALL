import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEspnPlayers, espnSeason } from '../server/espn.js';

// Trimmed from a live lm-api-reads.fantasy.espn.com kona_player_info response (2026-10-09)
const jokic = {
  player: {
    id: 3112335, fullName: 'Nikola Jokic', proTeamId: 7, eligibleSlots: [4, 9, 10, 11, 12, 13], injuryStatus: 'ACTIVE',
    ownership: { averageDraftPosition: 1.51 }, draftRanksByRankType: { ROTO: { rank: 1 } },
    stats: [
      { id: '102027', seasonId: 2027, statSourceId: 1, statSplitTypeId: 0, averageStats: { 0: 28.25, 1: 0.8055, 2: 1.5972, 3: 10.0972, 6: 12.6944, 11: 3.4027, 13: 10.5833, 14: 18.4027, 15: 5.3888, 16: 6.5972, 17: 1.6944, 42: 72 } },
      { id: '002026', seasonId: 2026, statSourceId: 0, statSplitTypeId: 0, averageStats: { 0: 27.67, 42: 65 } },
    ],
  },
};
const rookie = { player: { id: 9, fullName: 'Some Rookie', proTeamId: 2, eligibleSlots: [0, 1, 5, 7, 8, 11, 12], injuryStatus: 'DAY_TO_DAY', ownership: { averageDraftPosition: 0 }, draftRanksByRankType: { ROTO: { rank: 80 } }, stats: [] } };
const vet = { player: { id: 5, fullName: 'Vet Guard', proTeamId: 7, eligibleSlots: [1, 2, 5, 6], ownership: { averageDraftPosition: 40.2 }, stats: [{ id: '002026', averageStats: { 0: 15, 14: 12, 13: 5.5, 42: 70 } }] } };

test('parses projections, positions, injuries and ADP order', () => {
  const ps = parseEspnPlayers({ players: [rookie, vet, jokic] }, { 7: 'DEN', 2: 'BOS' }, 2027);
  assert.deepEqual(ps.map(p => p.name), ['Nikola Jokic', 'Vet Guard', 'Some Rookie']);
  const j = ps[0];
  assert.equal(j.yahooRank, 1);
  assert.equal(j.team, 'DEN');
  assert.deepEqual(j.pos, ['C']);
  assert.equal(j.pts, 28.25);
  assert.equal(j.reb, 12.6944);
  assert.equal(j.to, 3.4027);
  assert.ok(Math.abs(j.fgm / j.fga - 0.575) < 0.001);
  assert.equal(j.gp, 72);
  assert.equal(j.projected, true);
  const v = ps[1];
  assert.equal(v.projected, false);        // falls back to last season
  assert.deepEqual(v.pos, ['SG', 'SF']);
  const r = ps[2];
  assert.equal(r.status, 'DTD');
  assert.equal(r.hasStats, false);
  assert.deepEqual(r.pos, ['PG', 'SG']);
});

test('season rolls over in August', () => {
  assert.equal(espnSeason(new Date('2026-10-09')), 2027);
  assert.equal(espnSeason(new Date('2027-03-01')), 2027);
});
