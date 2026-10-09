// LASER — Lookahead Simulation for Expected Results.
//
// Instead of ranking players by a proxy (sum of z-scores), LASER scores each
// top candidate by the thing that actually wins an H2H 9-cat league: the
// simulated share of matchups you win. For each candidate it rolls out the
// rest of the draft (leaguemates by ADP with noise, you by the board's fit
// policy) and a season of weekly matchups, many times, using common random
// numbers so every candidate faces the same draws. This is rollout-based
// policy improvement: it can only match or beat the base policy it rolls out.
import { teamOnClock, picksForSlot, recommend } from './engine.js';
import { rng, botPick, simulateSeason, setLaser } from './sim.js';

function rollout({ candidate, rosters0, avail0, current, teams, rounds, slot, weights, needOpts, weeks, seed }) {
  const rand = rng(seed);
  const rosters = rosters0.map(r => r.slice());
  const available = new Set(avail0);
  available.delete(candidate);
  rosters[slot - 1].push(candidate);
  const myPicks = picksForSlot(slot, teams, rounds);
  for (let pick = current + 1; pick <= teams * rounds; pick++) {
    const { team } = teamOnClock(pick, teams);
    const avail = [...available];
    if (!avail.length) break;
    let p;
    if (team === slot) {
      const left = myPicks.filter(n => n >= pick).length;
      const recs = recommend(avail.filter(x => x.z), rosters[team - 1], weights, left, needOpts);
      let best = null;
      for (const r of recs) if (!best || r.fit > best.fit) best = r;
      p = best ? avail.find(x => x.key === best.key) : avail[0];
    } else {
      p = botPick(avail, rand);
    }
    available.delete(p);
    rosters[team - 1].push(p);
  }
  return simulateSeason(rosters, { weeks, seed: seed * 7 + 3 })[slot - 1].winPct;
}

// valued: computeValues() output; pickedKeys: every pick so far in draft order.
// Returns candidates ranked by simulated H2H win rate (with standard error).
export function laserRank({
  valued, pickedKeys, teams = 10, rounds = 13, slot, weights,
  candidates = 8, rollouts = 16, weeks = 12, seed = 1, needOpts, onProgress,
}) {
  const byKey = new Map(valued.map(p => [p.key, p]));
  const rosters0 = Array.from({ length: teams }, () => []);
  pickedKeys.forEach((k, i) => {
    const p = byKey.get(k);
    if (p) rosters0[teamOnClock(i + 1, teams).team - 1].push(p);
  });
  const picked = new Set(pickedKeys);
  const avail0 = valued.filter(p => !picked.has(p.key));
  const current = pickedKeys.length + 1;
  const left = picksForSlot(slot, teams, rounds).filter(n => n >= current).length;

  const cands = recommend(avail0.filter(p => p.z), rosters0[slot - 1], weights, left, needOpts)
    .sort((a, b) => b.fit - a.fit)
    .slice(0, candidates)
    .map(c => ({ player: byKey.get(c.key), fit: c.fit, samples: [] }));

  for (let r = 0; r < rollouts; r++) {
    const s = seed * 100003 + r * 7919 + current;
    for (const c of cands) {
      c.samples.push(rollout({ candidate: c.player, rosters0, avail0, current, teams, rounds, slot, weights, needOpts, weeks, seed: s }));
    }
    onProgress?.((r + 1) / rollouts);
  }

  const results = cands.map(c => {
    const n = c.samples.length;
    const mean = c.samples.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(c.samples.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
    return { key: c.player.key, name: c.player.name, pos: c.player.pos, fit: c.fit, winPct: mean, se: sd / Math.sqrt(n), samples: c.samples };
  }).sort((a, b) => b.winPct - a.winPct);

  // Paired edge vs. the runner-up (same random draws → much tighter than raw SEs)
  if (results.length > 1) {
    const [a, b] = results;
    const diffs = a.samples.map((x, i) => x - b.samples[i]);
    const m = diffs.reduce((s, x) => s + x, 0) / diffs.length;
    const sd = Math.sqrt(diffs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, diffs.length - 1));
    results[0].edge = { vs: b.name, mean: m, se: sd / Math.sqrt(diffs.length) };
  }
  for (const r of results) delete r.samples;
  return results;
}

setLaser(laserRank);
