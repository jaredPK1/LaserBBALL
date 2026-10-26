// This Week: projected category results for the current matchup, the
// opponent's scouting card from league history, and the free agents that add
// the most expected category wins (the league scores every category, so the
// goal is the most category wins per week, not 5 of 9).
import { yget, merge, each, parsePlayer, parseTeamInfo, myContext } from './yahoo.js';
import { gamesBetween, etDate, addDays, nbaTeam, normName } from './nba.js';
import { loadPool } from './espn.js';
import { CATS, yahooLine, roster, weekBounds } from './gamenight.js';
import { storeConfigured, listJson } from './store.js';
import { computeValues } from '../src/draft/engine.js';

const ACTIVE_SLOTS = 10;   // PG,SG,G,SF,PF,F,C,C,Util,Util
const TEAMS = 8, ROUNDS = 13;
// Rest-of-season values use your build: assists punted
const ROS_WEIGHTS = { fg: 1, ft: 1, tpm: 1, pts: 1, reb: 1, ast: 0, stl: 1, blk: 1, to: 1 };
// Anyone ranked inside this is a rostered-caliber player in an 8-team, 13-round league
export const KEEP_RANK = TEAMS * ROUNDS + 6;
export const IL_SLOTS = new Set(['IL', 'IL+', 'IL+LT', 'NA']);
// Statuses Yahoo accepts in an IL slot (O and INJ; not GTD/DTD or suspensions)
export const IL_ELIGIBLE = new Set(['O', 'INJ', 'OUT']);
export const OUT = new Set(['O', 'INJ', 'OUT', 'SUSP', 'NA']);
const KEYS = ['fgm', 'fga', 'ftm', 'fta', 'tpm', 'pts', 'reb', 'ast', 'stl', 'blk', 'to'];

// ── Math ─────────────────────────────────────────────────────────────────────
const erf = x => { // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
export const phi = z => 0.5 * (1 + erf(z / Math.SQRT2));

// Rough single-game spread: ~40% of the mean plus a Poisson floor, which keeps
// low-volume stats like steals and blocks appropriately noisy
export const gameVar = m => (0.4 * m) ** 2 + m;

// Rank players for "who starts when more than 10 play tonight"
const startValue = r => r.pts + 1.2 * r.reb + 1.5 * r.ast + 3 * r.stl + 3 * r.blk + r.tpm - r.to;

// Sum of expected stats and variances over the days left, filling at most 10
// active slots per day with the most valuable available players (positions
// ignored). Each player: { id, rates, team, avail (0..1), from, until }.
export function projectRemaining(players, gamesByTeam, dates) {
  const mean = Object.fromEntries(KEYS.map(k => [k, 0]));
  const vars = Object.fromEntries(KEYS.map(k => [k, 0]));
  const gamesUsed = new Map();
  for (const d of dates) {
    const playing = players
      .filter(p => p.avail > 0 && (!p.from || d >= p.from) && (!p.until || d <= p.until) && gamesByTeam[p.team]?.has(d))
      .sort((a, b) => startValue(b.rates) - startValue(a.rates))
      .slice(0, ACTIVE_SLOTS);
    for (const p of playing) {
      gamesUsed.set(p.id, (gamesUsed.get(p.id) || 0) + p.avail);
      for (const k of KEYS) {
        const m = p.rates[k] || 0;
        mean[k] += p.avail * m;
        vars[k] += p.avail * gameVar(m);
      }
      // Shooting luck: makes vary binomially around the attempt volume
      for (const [mk, ak] of [['fgm', 'fga'], ['ftm', 'fta']]) {
        const a = p.rates[ak] || 0;
        const pct = a > 0 ? (p.rates[mk] || 0) / a : 0;
        vars[`${mk}_shot`] = (vars[`${mk}_shot`] || 0) + p.avail * a * pct * (1 - pct) * 1.5;
      }
    }
  }
  return { mean, vars, gamesUsed };
}

// Win probability for each category given current totals + projected rest-of-week
export function categoryOdds(cur, me, opp) {
  return CATS.map(cat => {
    let mineNow, oppNow, mineEnd, oppEnd, sd;
    if (cat.pct) {
      const [mk, ak] = cat.pct;
      const mm = cur.me[mk] + me.mean[mk], ma = cur.me[ak] + me.mean[ak];
      const om = cur.opp[mk] + opp.mean[mk], oa = cur.opp[ak] + opp.mean[ak];
      mineNow = cur.me[ak] ? cur.me[mk] / cur.me[ak] : null;
      oppNow = cur.opp[ak] ? cur.opp[mk] / cur.opp[ak] : null;
      mineEnd = ma ? mm / ma : 0;
      oppEnd = oa ? om / oa : 0;
      const sm = ma ? Math.sqrt(me.vars[`${mk}_shot`] || 0) / ma : 0;
      const so = oa ? Math.sqrt(opp.vars[`${mk}_shot`] || 0) / oa : 0;
      sd = Math.sqrt(sm ** 2 + so ** 2);
    } else {
      mineNow = cur.me[cat.k]; oppNow = cur.opp[cat.k];
      mineEnd = mineNow + me.mean[cat.k];
      oppEnd = oppNow + opp.mean[cat.k];
      sd = Math.sqrt((me.vars[cat.k] || 0) + (opp.vars[cat.k] || 0));
    }
    const edge = cat.low ? oppEnd - mineEnd : mineEnd - oppEnd;
    const p = sd > 1e-9 ? phi(edge / sd) : edge > 0 ? 1 : edge < 0 ? 0 : 0.5;
    return { id: cat.id, name: cat.name, low: !!cat.low, pct: !!cat.pct, mineNow, oppNow, mineEnd, oppEnd, winProb: p, verdict: verdict(p) };
  });
}

const verdict = p => (p >= 0.85 ? 'locked' : p >= 0.6 ? 'leaning' : p > 0.4 ? 'swing' : p > 0.15 ? 'behind' : 'gone');
export const expectedWins = odds => odds.reduce((s, c) => s + c.winProb, 0);

// ── Data ─────────────────────────────────────────────────────────────────────
// ESPN projections by name, each with a rest-of-season value and rank
export async function espnRates() {
  try {
    const { players } = await loadPool({ query: { count: 500 } });
    const valued = computeValues(players.filter(p => p.hasStats), { teams: TEAMS, rounds: ROUNDS, weights: ROS_WEIGHTS });
    const m = new Map();
    for (const p of valued) m.set(normName(p.name), { ...p, rosValue: p.value, rosRank: p.valueRank });
    return m;
  } catch { return new Map(); }
}

export const rosOf = (name, espn) => {
  const e = espn.get(normName(name));
  return e ? { rosValue: e.rosValue, rosRank: e.rosRank } : { rosValue: null, rosRank: null };
};

// Per-game rates: ESPN's projection (updated in-season), else Yahoo's season average
// How much to trust this season's actual per-game stats over ESPN's
// projection: ~3.4 games per completed week, half-and-half around 15 games,
// capped so one hot month doesn't erase the projection entirely
export function realWeight(currentWeek) {
  const games = 3.4 * Math.max(0, (Number(currentWeek) || 1) - 1);
  return Math.min(0.8, games / (games + 15));
}

// Per-game rates: ESPN projection blended with Yahoo's season average by
// weight w; either alone when the other is missing
export function ratesFor(p, espn, w = 0) {
  const e = espn.get(normName(p.name));
  const y = yahooLine(p.stats || {});
  const hasReal = y.pts > 0 || y.fga > 0;
  if (e && hasReal && w > 0) {
    return { src: `${Math.round(w * 100)}% this season`, rates: Object.fromEntries(KEYS.map(k => [k, (1 - w) * (e[k] || 0) + w * (y[k] || 0)])) };
  }
  if (e) return { src: e.projected ? 'projection' : 'last season', rates: Object.fromEntries(KEYS.map(k => [k, e[k] || 0])) };
  return { src: hasReal ? 'season avg' : 'none', rates: Object.fromEntries(KEYS.map(k => [k, y[k] || 0])) };
}

export const availability = (p) => (IL_SLOTS.has(p.slot) || OUT.has(p.status) ? 0 : p.status === 'GTD' || p.status === 'DTD' ? 0.6 : 1);

export function datesBetween(a, b) {
  const out = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

export function teamGames(games) {
  const by = {};
  for (const g of games) for (const t of [g.home, g.away]) (by[t] ||= new Set()).add(g.date);
  return by;
}

export const nick = teamNode => merge(teamNode?.[0] || [])?.managers?.[0]?.manager?.nickname || null;

// Scouting from stored league history: each manager's category win rate (regular season)
let histCache = null;
export async function managerProfiles() {
  if (!storeConfigured()) return {};
  if (histCache && Date.now() - histCache.t < 3600_000) return histCache.v;
  const docs = (await listJson('hist:').catch(() => [])).map(r => r.doc).filter(d => d?.teams);
  const prof = {};
  for (const s of docs) {
    const owner = new Map(s.teams.map(t => [t.teamKey, t.nickname]));
    for (const t of s.teams) {
      const p = (prof[t.nickname] ||= { nickname: t.nickname, seasons: [], cats: {} });
      p.seasons.push({ season: s.season, rank: Number(t.rank), moves: Number(t.moves) || 0, trades: Number(t.trades) || 0 });
    }
    for (const w of s.weeks || []) {
      for (const m of w.matchups || []) {
        if (m.isPlayoffs || m.isConsolation) continue;
        for (const tk of m.teams || []) {
          const p = prof[owner.get(tk)];
          if (!p) continue;
          for (const [stat, win] of Object.entries(m.winners || {})) {
            const c = (p.cats[stat] ||= { w: 0, n: 0 });
            c.n += 1;
            c.w += win === tk ? 1 : win === 'tie' ? 0.5 : 0;
          }
        }
      }
    }
  }
  for (const p of Object.values(prof)) {
    p.seasons.sort((a, b) => Number(a.season) - Number(b.season));
    p.catWin = Object.fromEntries(CATS.map(c => [c.name, p.cats[c.id]?.n ? p.cats[c.id].w / p.cats[c.id].n : null]));
    delete p.cats;
    p.weak = CATS.filter(c => p.catWin[c.name] != null && p.catWin[c.name] < 0.4).map(c => c.name);
    p.strong = CATS.filter(c => p.catWin[c.name] != null && p.catWin[c.name] > 0.62).map(c => c.name);
  }
  histCache = { t: Date.now(), v: prof };
  return prof;
}

// Everything both endpoints need about this week's matchup
async function weekState(req, res) {
  const ctx = await myContext(req, res);
  if (!ctx.teamKey) throw Object.assign(new Error('Could not find your team in this league'), { status: 404 });
  const week = Number(req.query.week) || ctx.currentWeek;
  const today = etDate();
  const [matchupData, bounds, espn] = await Promise.all([
    yget(req, res, `team/${ctx.teamKey}/matchups;weeks=${week}`),
    weekBounds(req, res, week),
    espnRates(),
  ]);
  const mt = merge(matchupData.fantasy_content.team.slice(1));
  const matchup = each(mt.matchups, 'matchup')[0] || {};
  const nodes = each(merge(matchup['0'] ? matchup['0'] : matchup).teams, 'team');
  const teams = nodes.map(parseTeamInfo);
  const me = teams.find(t => t.key === ctx.teamKey) || teams[0];
  const opp = teams.find(t => t.key !== ctx.teamKey) || null;
  const oppNick = opp ? nick(nodes[teams.indexOf(opp)]) : null;

  // Before the week starts project all of it; once games are live, start
  // tomorrow after 7pm ET (tonight's stats are already in the totals)
  const etHour = Number(new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }));
  const fromQ = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : null;
  const startDay = fromQ || (today < bounds.start ? bounds.start : etHour >= 19 ? addDays(today, 1) : today);
  const rosterDate = today < bounds.start ? bounds.start : today;
  const [myRoster, oppRoster, games] = await Promise.all([
    roster(req, res, ctx.teamKey, rosterDate),
    opp ? roster(req, res, opp.key, rosterDate) : [],
    startDay <= bounds.end ? gamesBetween(startDay, bounds.end) : [],
  ]);
  const w = realWeight(ctx.currentWeek);
  const toPlayer = (p, extra = {}) => {
    const r = ratesFor(p, espn, w);
    return { id: p.key, name: p.name, team: nbaTeam(p.team), pos: p.displayPos || p.pos?.join(','), slot: p.slot, status: p.status, rates: r.rates, src: r.src, avail: availability(p), ...extra };
  };
  return {
    ctx, week, bounds, today, startDay, espn, w,
    dates: startDay <= bounds.end ? datesBetween(startDay, bounds.end) : [],
    gamesByTeam: teamGames(games),
    me, opp, oppNick,
    cur: { me: yahooLine(me?.stats || {}), opp: yahooLine(opp?.stats || {}) },
    mine: myRoster.map(p => toPlayer(p)),
    theirs: oppRoster.map(p => toPlayer(p)),
  };
}

// ── Endpoints ────────────────────────────────────────────────────────────────
export async function weekProjection(req, res) {
  const st = await weekState(req, res);
  const meProj = projectRemaining(st.mine, st.gamesByTeam, st.dates);
  const oppProj = projectRemaining(st.theirs, st.gamesByTeam, st.dates);
  const odds = categoryOdds(st.cur, meProj, oppProj);
  const profiles = await managerProfiles().catch(() => ({}));
  const scout = st.oppNick ? profiles[st.oppNick] || null : null;
  const players = (list, proj) => list.map(p => ({
    name: p.name, team: p.team, pos: p.pos, slot: p.slot, status: p.status, src: p.src,
    gamesLeft: st.dates.filter(d => st.gamesByTeam[p.team]?.has(d)).length,
    gamesCounted: Math.round((proj.gamesUsed.get(p.id) || 0) * 10) / 10,
  }));
  return {
    week: st.week, start: st.bounds.start, end: st.bounds.end, projectingFrom: st.startDay, actualWeight: st.w,
    me: { name: st.me?.name }, opp: st.opp ? { name: st.opp.name, manager: st.oppNick } : null,
    categories: odds,
    expectedWins: expectedWins(odds),
    scouting: scout,
    players: { me: players(st.mine, meProj), opp: players(st.theirs, oppProj) },
    unrated: [...st.mine, ...st.theirs].filter(p => p.src === 'none').map(p => p.name),
  };
}

// Adds made this week, from Yahoo's team metadata (null if Yahoo doesn't say)
async function addsUsed(req, res, teamKey) {
  try {
    const data = await yget(req, res, `team/${teamKey}`);
    const ra = merge(data.fantasy_content.team[0] || data.fantasy_content.team).roster_adds;
    const v = Number(ra?.value);
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

export async function freeAgents(req, res, lk) {
  const STATS = 'stats;type=average_season';
  const paths = [
    `league/${lk}/players;status=FA;sort=OR;count=25/${STATS}`,
    `league/${lk}/players;status=FA;sort=OR;count=25;start=25/${STATS}`,
    `league/${lk}/players;status=FA;position=C;sort=OR;count=25/${STATS}`,
    `league/${lk}/players;status=FA;position=PF;sort=OR;count=25/${STATS}`,
  ];
  const seen = new Map();
  const results = await Promise.all(paths.map(p => yget(req, res, p).catch(() => null)));
  for (const data of results) {
    if (!data) continue;
    for (const node of each(merge(data.fantasy_content.league).players, 'player')) {
      const p = parsePlayer(node);
      if (p.key && !seen.has(p.key)) seen.set(p.key, p);
    }
  }
  return [...seen.values()];
}

export async function weekStreamers(req, res) {
  const st = await weekState(req, res);
  const oppProj = projectRemaining(st.theirs, st.gamesByTeam, st.dates);
  const evalRoster = list => expectedWins(categoryOdds(st.cur, projectRemaining(list, st.gamesByTeam, st.dates), oppProj));
  const base = evalRoster(st.mine);

  // Adds take effect tomorrow; the dropped player still counts today
  const tomorrow = addDays(st.today, 1);
  const addFrom = st.startDay > tomorrow ? st.startDay : tomorrow;
  // Who to drop: never someone worth keeping all season. Among droppable
  // players, pick the lowest rest-of-season value; this week's cost is shown
  // alongside. Injured players are better moved to IL than dropped.
  const options = st.mine.filter(p => !IL_SLOTS.has(p.slot)).map(p => {
    const ros = rosOf(p.name, st.espn);
    const keeper = ros.rosRank == null || ros.rosRank <= KEEP_RANK;
    return {
      p, ...ros, keeper,
      injured: OUT.has(p.status),
      ilEligible: IL_ELIGIBLE.has(p.status),
      weekCost: base - evalRoster(st.mine.map(x => (x.id === p.id ? { ...x, until: addDays(addFrom, -1) } : x))),
    };
  }).sort((a, b) => (a.rosValue ?? Infinity) - (b.rosValue ?? Infinity));
  const pool = options.filter(o => !o.keeper && !o.ilEligible);
  const pick = pool[0] || options.find(o => !o.ilEligible) || null;
  const drop = pick?.p || null;
  const withDrop = st.mine.map(x => (drop && x.id === drop.id ? { ...x, until: addDays(addFrom, -1) } : x));

  const fas = (await freeAgents(req, res, st.ctx.leagueKey))
    .filter(p => !OUT.has(p.status))
    .map(p => {
      const r = ratesFor(p, st.espn, st.w);
      return { id: p.key, name: p.name, team: nbaTeam(p.team), pos: p.displayPos, status: p.status, rates: r.rates, src: r.src, avail: availability(p), from: addFrom, ...rosOf(p.name, st.espn) };
    })
    .filter(p => p.src !== 'none');

  const oddsBase = categoryOdds(st.cur, projectRemaining(st.mine, st.gamesByTeam, st.dates), oppProj);
  const ranked = fas.map(fa => {
    const oddsAfter = categoryOdds(st.cur, projectRemaining([...withDrop, fa], st.gamesByTeam, st.dates), oppProj);
    const after = expectedWins(oddsAfter);
    const catGain = {};
    oddsAfter.forEach((c, i) => { const d = c.winProb - oddsBase[i].winProb; if (Math.abs(d) >= 0.02) catGain[c.name] = Math.round(d * 100); });
    return {
      name: fa.name, team: fa.team, pos: fa.pos, status: fa.status, src: fa.src,
      gamesLeft: st.dates.filter(d => d >= addFrom && st.gamesByTeam[fa.team]?.has(d)).length,
      perGame: { pts: fa.rates.pts, reb: fa.rates.reb, ast: fa.rates.ast, stl: fa.rates.stl, blk: fa.rates.blk, tpm: fa.rates.tpm, to: fa.rates.to,
        fgPct: fa.rates.fga ? fa.rates.fgm / fa.rates.fga : null, ftPct: fa.rates.fta ? fa.rates.ftm / fa.rates.fta : null },
      gain: after - base,
      catGain,
      rosRank: fa.rosRank,
      // Better than the player you'd drop for the rest of the season → keep him
      keeper: fa.rosValue != null && (pick?.rosValue == null ? false : fa.rosValue > pick.rosValue),
    };
  }).sort((a, b) => b.gain - a.gain);

  const adds = await addsUsed(req, res, st.ctx.teamKey);
  return {
    asOf: new Date().toISOString(),
    week: st.week, end: st.bounds.end, addsStartPlaying: addFrom,
    baseline: base,
    addsUsed: adds, addsLimit: 4,
    drop: drop ? { name: drop.name, pos: drop.pos, rosRank: pick.rosRank, weekCost: pick.weekCost, allKeepers: !pool.length } : null,
    dropOptions: options.map(o => ({
      name: o.p.name, pos: o.p.pos, status: o.p.status, rosRank: o.rosRank, keeper: o.keeper, injured: o.injured, weekCost: o.weekCost,
      advice: o.ilEligible ? 'Move to IL' : o.keeper ? (o.injured ? 'Keep (bench)' : 'Keep') : 'Droppable',
    })),
    streamers: ranked.slice(0, 15),
    considered: fas.length,
  };
}

