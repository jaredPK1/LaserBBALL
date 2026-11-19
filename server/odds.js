// Playoff odds: play out the rest of the regular season thousands of times.
// Each future matchup's category odds come from the two current rosters
// (injured players discounted); this week uses the live in-progress odds.
// Standings are cumulative category wins; the top PLAYOFF_SPOTS make it.
import { yget, merge, each, myContext } from './yahoo.js';
import { espnRates } from './weekly.js';
import { leagueRosters, matchupOdds, playoffWeeks } from './manage.js';
import { parseScoreboard } from './league.js';
import { parseTeam } from './history.js';
import { storeConfigured, getJson, setJson } from './store.js';

export const PLAYOFF_SPOTS = 6;
const SIMS = 4000;

// Deterministic RNG so the same inputs give the same odds (no jitter between runs)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// standings: [{key, wins, losses, ties}]; games: [{a, b, p: [9 category win chances for a]}]
export function simulate(standings, games, { sims = SIMS, spots = PLAYOFF_SPOTS, seed = 1 } = {}) {
  const rand = rng(seed);
  const keys = standings.map(t => t.key);
  const idx = new Map(keys.map((k, i) => [k, i]));
  const made = new Array(keys.length).fill(0), first = new Array(keys.length).fill(0);
  const finalW = new Array(keys.length).fill(0);
  const base = standings.map(t => t.wins + 0.5 * t.ties);
  for (let s = 0; s < sims; s++) {
    const w = base.slice();
    for (const g of games) {
      const ia = idx.get(g.a), ib = idx.get(g.b);
      if (ia == null || ib == null) continue;
      for (const p of g.p) { if (rand() < p) w[ia] += 1; else w[ib] += 1; }
    }
    // Rank by category wins; random tiebreak
    const order = keys.map((_, i) => i).sort((x, y) => (w[y] - w[x]) || (rand() - 0.5));
    order.slice(0, spots).forEach(i => { made[i]++; });
    first[order[0]]++;
    w.forEach((v, i) => { finalW[i] += v; });
  }
  return keys.map((k, i) => ({ key: k, playoffs: made[i] / sims, first: first[i] / sims, projWins: finalW[i] / sims }));
}

// Each remaining regular-season week's pairings (cached: the schedule is fixed)
async function schedule(req, res, lk, weeks) {
  const out = [];
  for (const w of weeks) {
    const key = `sched:${lk}:${w}`;
    let pairs = storeConfigured() ? (await getJson(key).catch(() => null))?.pairs : null;
    if (!pairs) {
      const data = await yget(req, res, `league/${lk}/scoreboard;week=${w}`).catch(() => null);
      if (!data) continue; // not published yet: simulate the weeks we know
      pairs = parseScoreboard(data).map(p => [p[0].key, p[1].key]);
      if (storeConfigured() && pairs.length) await setJson(key, { pairs }).catch(() => {});
    }
    out.push({ week: w, pairs });
  }
  return out;
}

// liveMatchups (optional): this week's in-progress odds, [{a, b, cats:[{aWin}]}]
export async function playoffOdds(req, res, { liveMatchups } = {}) {
  const ctx = await myContext(req, res);
  const espn = await espnRates();
  const [teams, stData, po] = await Promise.all([
    leagueRosters(req, res, ctx, espn),
    yget(req, res, `league/${ctx.leagueKey}/standings`),
    playoffWeeks(req, res, ctx.leagueKey).catch(() => []),
  ]);
  const lastRegular = (Number(po[0]?.week) || 19) - 1;
  const standings = each(merge(merge(stData.fantasy_content.league).standings).teams, 'team').map(parseTeam)
    .map(t => ({ key: t.teamKey, name: t.name, manager: t.nickname, wins: t.wins, losses: t.losses, ties: t.ties }));
  const futureWeeks = [];
  for (let w = ctx.currentWeek + (liveMatchups ? 1 : 0); w <= lastRegular; w++) futureWeeks.push(w);
  const sched = await schedule(req, res, ctx.leagueKey, futureWeeks);
  const roster = new Map(teams.map(t => [t.key, t.players]));
  const games = [];
  for (const m of liveMatchups || []) games.push({ a: m.a, b: m.b, p: m.cats.map(c => c.aWin) });
  const pairOdds = new Map();
  for (const { pairs } of sched) {
    for (const [a, b] of pairs) {
      const k = `${a}|${b}`;
      if (!pairOdds.has(k)) pairOdds.set(k, matchupOdds(roster.get(a) || [], roster.get(b) || []).map(c => c.winProb));
      games.push({ a, b, p: pairOdds.get(k) });
    }
  }
  const sim = simulate(standings, games, { seed: ctx.currentWeek * 7919 + 17 });
  // Compare against last week's odds all week long
  const prev = storeConfigured() ? await getJson('snap:odds').catch(() => null) : null;
  const prevMap = prev && prev.week !== ctx.currentWeek ? Object.fromEntries((prev.teams || []).map(t => [t.key, t.playoffs])) : prev?.prevOf || {};
  const byKey = new Map(standings.map(t => [t.key, t]));
  const rows = sim.map(r => ({ ...byKey.get(r.key), ...r, prev: prevMap[r.key] ?? null }))
    .sort((x, y) => y.playoffs - x.playoffs || y.projWins - x.projWins);
  const doc = { week: ctx.currentWeek, savedAt: new Date().toISOString(), spots: PLAYOFF_SPOTS, weeksLeft: futureWeeks.length + (liveMatchups ? 1 : 0), teams: rows, prevOf: prevMap };
  if (storeConfigured()) await setJson('snap:odds', doc).catch(() => {});
  return { ...doc, rosters: teams };
}

export const cachedOdds = () => (storeConfigured() ? getJson('snap:odds').catch(() => null) : null);
