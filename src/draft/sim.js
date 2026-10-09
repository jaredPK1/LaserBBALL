// Mock-draft + season simulator. Opponents draft by ADP with noise; "you" draft
// by the engine's fit score under a strategy (category weights). Each finished
// league plays a simulated H2H 9-cat season, all-play, to score the strategy.
import { CATS, DEFAULT_SETTINGS, computeValues, teamOnClock, picksForSlot, recommend } from './engine.js';

// Small seeded RNG so results are reproducible
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  const next = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  next.normal = () => { const u = next() || 1e-9, v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  return next;
}

export const STRATEGIES = {
  balanced: { label: 'Balanced (no punt)', punt: [] },
  puntFT: { label: 'Punt FT%', punt: ['ft'] },
  puntTO: { label: 'Punt TO', punt: ['to'] },
  puntFG: { label: 'Punt FG%', punt: ['fg'] },
  puntAST: { label: 'Punt AST', punt: ['ast'] },
  puntPTS: { label: 'Punt PTS', punt: ['pts'] },
  puntFTTO: { label: 'Punt FT% + TO (bigs)', punt: ['ft', 'to'] },
  adp: { label: 'Draft by ADP (like the bots)', punt: [], byAdp: true },
  laser: { label: 'LASER (balanced base)', punt: [], laser: true },
  laserFT: { label: 'LASER (punt-FT% base)', punt: ['ft'], laser: true },
};

// LASER is imported lazily to avoid a circular import at module load
let laserRankFn = null;
export function setLaser(fn) { laserRankFn = fn; }

// toWeight < 1 tempers turnovers, which otherwise reward low-usage players
export const weightsFor = (punt, toWeight = 1) =>
  Object.fromEntries(CATS.map(c => [c.k, punt.includes(c.k) ? 0 : c.k === 'to' ? toWeight : 1]));

// Bot: best available by market rank (ADP order) plus noise that grows deeper in the draft
export function botPick(available, rand) {
  let best = null, bestScore = Infinity;
  for (const p of available) {
    const r = p.yahooRank ?? 400;
    const score = r + rand.normal() * (2 + r * 0.12);
    if (score < bestScore) { bestScore = score; best = p; }
  }
  return best;
}

// Draft one league. strategy: {punt, byAdp}; mySlot 1..teams. `pick` overrides for interactive mocks.
export function simulateDraft(pool, { teams = 10, rounds = 13, mySlot, strategy, seed = 1, engine = {} }) {
  const rand = rng(seed);
  const weights = weightsFor(strategy.punt || [], engine.toWeight ?? 1);
  const valued = computeValues(pool, { teams, rounds, weights });
  const available = new Set(valued);
  const rosters = Array.from({ length: teams }, () => []);
  const myPicks = picksForSlot(mySlot, teams, rounds);
  const order = [];
  for (let pick = 1; pick <= teams * rounds; pick++) {
    const { team } = teamOnClock(pick, teams);
    const avail = [...available];
    let p;
    if (team === mySlot && strategy.laser && laserRankFn) {
      const ranked = laserRankFn({
        valued, pickedKeys: order, teams, rounds, slot: mySlot, weights, needOpts: engine.need,
        candidates: engine.laserCandidates || 5, rollouts: engine.laserRollouts || 8, weeks: engine.laserWeeks || 10,
        seed: seed + pick,
      });
      p = avail.find(x => x.key === ranked[0].key);
    } else if (team === mySlot && !strategy.byAdp) {
      const left = myPicks.filter(n => n >= pick).length;
      const recs = recommend(avail.filter(x => x.z), rosters[team - 1], weights, left, engine.need);
      p = recs.sort((a, b) => b.fit - a.fit)[0];
      p = avail.find(x => x.key === p.key);
    } else {
      p = botPick(avail, rand);
    }
    available.delete(p);
    rosters[team - 1].push(p);
    order.push(p.key);
  }
  return rosters;
}

const STAT_KEYS = ['fgm', 'fga', 'ftm', 'fta', 'tpm', 'pts', 'reb', 'ast', 'stl', 'blk', 'to'];

function weekTotals(roster, rand) {
  const t = Object.fromEntries(STAT_KEYS.map(k => [k, 0]));
  for (const p of roster) {
    const avail = Math.min(1, (p.gp || 70) / 82);
    let games = 0;
    const scheduled = rand() < 0.5 ? 3 : 4;
    for (let g = 0; g < scheduled; g++) if (rand() < avail) games++;
    if (!games) continue;
    const form = Math.max(0.3, 1 + rand.normal() * 0.18);
    for (const k of STAT_KEYS) t[k] += (p[k] || 0) * games * (k === 'fga' || k === 'fta' ? 1 : form) * (k === 'fgm' || k === 'ftm' ? 1 / form : 1);
  }
  // shooting makes vary independently of volume
  t.fgm = Math.min(t.fga, t.fgm * (1 + rand.normal() * 0.04));
  t.ftm = Math.min(t.fta, t.ftm * (1 + rand.normal() * 0.05));
  return t;
}

const catVal = (c, t) => (c.pct ? (t[c.pct[1]] ? t[c.pct[0]] / t[c.pct[1]] : 0) : t[c.k]);

// All-play season: every team vs every other team each week
export function simulateSeason(rosters, { weeks = 20, seed = 7 } = {}) {
  const rand = rng(seed);
  const n = rosters.length;
  const res = rosters.map(() => ({ w: 0, l: 0, t: 0, cats: Object.fromEntries(CATS.map(c => [c.k, { w: 0, l: 0, t: 0 }])) }));
  for (let wk = 0; wk < weeks; wk++) {
    const tot = rosters.map(r => weekTotals(r, rand));
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        let wa = 0, wb = 0;
        for (const c of CATS) {
          const va = catVal(c, tot[a]), vb = catVal(c, tot[b]);
          if (Math.abs(va - vb) < 1e-9) { res[a].cats[c.k].t++; res[b].cats[c.k].t++; continue; }
          const aWins = c.low ? va < vb : va > vb;
          if (aWins) { wa++; res[a].cats[c.k].w++; res[b].cats[c.k].l++; } else { wb++; res[b].cats[c.k].w++; res[a].cats[c.k].l++; }
        }
        if (wa > wb) { res[a].w++; res[b].l++; } else if (wb > wa) { res[b].w++; res[a].l++; } else { res[a].t++; res[b].t++; }
      }
    }
  }
  return res.map(r => ({
    winPct: (r.w + r.t / 2) / (r.w + r.l + r.t),
    cats: Object.fromEntries(Object.entries(r.cats).map(([k, x]) => [k, (x.w + x.t / 2) / (x.w + x.l + x.t)])),
  }));
}

// Rank of my team in all-play win% (1 = best)
const rankOf = (season, i) => 1 + season.filter((s, j) => j !== i && s.winPct > season[i].winPct).length;

export function evaluateStrategy(pool, { strategyKey, mySlot, runs = 20, teams = 10, rounds = 13, seed = 1, engine = {} }) {
  const strategy = STRATEGIES[strategyKey];
  let win = 0, rank = 0, top3 = 0;
  const cats = Object.fromEntries(CATS.map(c => [c.k, 0]));
  let sample = null;
  for (let i = 0; i < runs; i++) {
    const rosters = simulateDraft(pool, { teams, rounds, mySlot, strategy, seed: seed * 1000 + i * 17 + mySlot, engine });
    const season = simulateSeason(rosters, { seed: seed * 7 + i });
    const me = season[mySlot - 1];
    const r = rankOf(season, mySlot - 1);
    win += me.winPct; rank += r; if (r <= 3) top3++;
    for (const c of CATS) cats[c.k] += me.cats[c.k];
    if (!sample) sample = rosters[mySlot - 1].map(p => `${p.name} (${(p.pos || []).join('/')})`);
  }
  return {
    strategy: strategyKey, label: strategy.label, slot: mySlot, runs,
    winPct: win / runs, avgRank: rank / runs, top3: top3 / runs,
    cats: Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, v / runs])),
    sample,
  };
}

export { DEFAULT_SETTINGS };
