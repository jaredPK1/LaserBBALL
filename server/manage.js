// Roster management: alerts (injuries + tomorrow's lineup), the playoff
// schedule planner, and the trade checker.
import { yget, merge, each, myContext } from './yahoo.js';
import { gamesBetween, etDate, addDays, nbaTeam, normName } from './nba.js';
import { roster } from './gamenight.js';
import { availability as durability } from '../src/draft/engine.js';
import {
  IL_SLOTS, OUT, KEEP_RANK, espnRates, rosOf, ratesFor, availability, gameVar,
  freeAgents, teamGames, nick, categoryOdds, expectedWins,
} from './weekly.js';

const IL_CAPACITY = 2;
const ACTIVE = s => s && s !== 'BN' && !IL_SLOTS.has(s);
const KEYS = ['fgm', 'fga', 'ftm', 'fta', 'tpm', 'pts', 'reb', 'ast', 'stl', 'blk', 'to'];

// Can a player with these eligible positions fill this lineup slot?
export function fitsSlot(slot, pos = []) {
  if (slot === 'Util') return pos.some(p => ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F'].includes(p));
  if (slot === 'G') return pos.includes('PG') || pos.includes('SG') || pos.includes('G');
  if (slot === 'F') return pos.includes('SF') || pos.includes('PF') || pos.includes('F');
  return pos.includes(slot);
}

// Swaps that put bench players who play into slots held by idle/out starters.
// Each bench player and each slot is used once; best bench players first.
export function lineupSwaps(players, plays) {
  const idle = players.filter(p => ACTIVE(p.slot) && (!plays(p) || OUT.has(p.status)));
  const bench = players.filter(p => p.slot === 'BN' && plays(p) && !OUT.has(p.status));
  const swaps = [];
  const usedSlots = new Set();
  for (const b of bench) {
    const target = idle.find(s => !usedSlots.has(s) && fitsSlot(s.slot, b.pos));
    if (!target) continue;
    usedSlots.add(target);
    swaps.push({ start: b.name, startPos: b.displayPos, sit: target.name, slot: target.slot, reason: OUT.has(target.status) ? target.status : 'no game' });
  }
  const stuck = bench.filter(b => !swaps.some(s => s.start === b.name));
  return { swaps, stuck: stuck.map(b => b.name) };
}

// ── Alerts ──────────────────────────────────────────────────────────────────
export async function alerts(req, res) {
  const ctx = await myContext(req, res);
  if (!ctx.teamKey) throw Object.assign(new Error('Could not find your team in this league'), { status: 404 });
  const today = etDate();
  const tomorrow = addDays(today, 1);
  const [rToday, rTomorrow, games, espn] = await Promise.all([
    roster(req, res, ctx.teamKey, today),
    roster(req, res, ctx.teamKey, tomorrow).catch(() => null),
    gamesBetween(today, tomorrow).catch(() => []),
    espnRates(),
  ]);
  const by = teamGames(games);
  const playsOn = d => p => !!by[nbaTeam(p.team)]?.has(d);
  const out = [];

  // Tomorrow's lineup is the one you can still change
  const tm = rTomorrow || rToday;
  const { swaps, stuck } = lineupSwaps(tm, playsOn(tomorrow));
  for (const s of swaps) {
    out.push({ kind: 'lineup', level: 'action', when: 'tomorrow', text: `Start ${s.start} (${s.startPos}) in ${s.slot} instead of ${s.sit} (${s.reason}).` });
  }
  if (stuck.length) {
    out.push({ kind: 'lineup', level: 'info', when: 'tomorrow', text: `${stuck.join(', ')} play${stuck.length === 1 ? 's' : ''} tomorrow but no open slot fits their position.` });
  }

  // Injuries
  const ilUsed = tm.filter(p => IL_SLOTS.has(p.slot)).length;
  const injured = tm.filter(p => OUT.has(p.status) && !IL_SLOTS.has(p.slot));
  let ilFree = IL_CAPACITY - ilUsed;
  for (const p of injured) {
    const ros = rosOf(p.name, espn);
    const keep = ros.rosRank == null || ros.rosRank <= KEEP_RANK;
    if (ilFree > 0) {
      ilFree -= 1;
      out.push({ kind: 'injury', level: 'action', when: 'now', text: `${p.name} is ${p.status}${p.injury ? ` (${p.injury})` : ''}. Move him to IL to free a roster spot.` });
    } else {
      out.push({ kind: 'injury', level: 'action', when: 'now', text: `${p.name} is ${p.status}${p.injury ? ` (${p.injury})` : ''} and both IL slots are full. ${keep ? 'He’s worth keeping: drop your weakest droppable player instead.' : 'He’s droppable if you need the spot.'}` });
    }
  }
  const gtd = tm.filter(p => ['GTD', 'DTD'].includes(p.status) && ACTIVE(p.slot));
  if (gtd.length) out.push({ kind: 'injury', level: 'info', when: 'tomorrow', text: `Game-time decisions in your lineup: ${gtd.map(p => p.name).join(', ')}. Check news before lock.` });

  // Replacements: best available keepers for the injured players' positions
  let replacements = [];
  if (injured.length) {
    const want = new Set(injured.flatMap(p => p.pos || []));
    const fas = (await freeAgents(req, res, ctx.leagueKey))
      .filter(p => !OUT.has(p.status))
      .map(p => ({ name: p.name, team: nbaTeam(p.team), pos: p.displayPos, fits: (p.pos || []).some(x => want.has(x)), ...rosOf(p.name, espn) }))
      .filter(p => p.rosRank != null)
      .sort((a, b) => (b.fits - a.fits) || (a.rosRank - b.rosRank));
    replacements = fas.slice(0, 5);
  }

  return { date: today, ilUsed, ilCapacity: IL_CAPACITY, alerts: out, replacements };
}

// ── Playoff planner ─────────────────────────────────────────────────────────
async function playoffWeeks(req, res, lk) {
  let start = 19, count = 3;
  try {
    const s = merge(merge((await yget(req, res, `league/${lk}/settings`)).fantasy_content.league.slice(1)).settings);
    if (Number(s.playoff_start_week)) start = Number(s.playoff_start_week);
  } catch { /* league default: weeks 19–21 */ }
  const data = await yget(req, res, 'game/nba/game_weeks');
  const all = each(merge(data.fantasy_content.game).game_weeks, 'game_week');
  return all.filter(w => Number(w.week) >= start && Number(w.week) < start + count)
    .map(w => ({ week: Number(w.week), start: w.start, end: w.end }));
}

export async function playoffs(req, res) {
  const ctx = await myContext(req, res);
  const weeks = await playoffWeeks(req, res, ctx.leagueKey);
  if (!weeks.length) throw Object.assign(new Error('Yahoo didn’t list the playoff weeks yet'), { status: 404 });
  const perWeek = await Promise.all(weeks.map(w => gamesBetween(w.start, w.end)));
  const teamCounts = {};
  perWeek.forEach((games, i) => {
    for (const g of games) for (const t of [g.home, g.away]) {
      (teamCounts[t] ||= weeks.map(() => 0))[i] += 1;
    }
  });
  const teams = Object.entries(teamCounts).map(([team, c]) => ({ team, games: c, total: c.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total || a.team.localeCompare(b.team));
  const mine = (await roster(req, res, ctx.teamKey, etDate())).map(p => {
    const c = teamCounts[nbaTeam(p.team)] || weeks.map(() => 0);
    return { name: p.name, team: nbaTeam(p.team), pos: p.displayPos, games: c, total: c.reduce((a, b) => a + b, 0) };
  }).sort((a, b) => b.total - a.total);
  const avg = teams.length ? teams.reduce((a, t) => a + t.total, 0) / teams.length : 0;
  return { weeks, teams, mine, leagueAvgTotal: avg, tradeDeadline: '2027-03-04' };
}

// ── Trade checker ───────────────────────────────────────────────────────────
// Expected weekly line for a roster: per-game rates × ~3.4 games × availability
// (ESPN games-played projection), IL players excluded.
const GAMES_PER_WEEK = 3.4;
function weeklyLine(players) {
  const mean = Object.fromEntries(KEYS.map(k => [k, 0]));
  const vars = Object.fromEntries(KEYS.map(k => [k, 0]));
  for (const p of players) {
    const g = GAMES_PER_WEEK * p.avail * p.durability;
    if (g <= 0) continue;
    for (const k of KEYS) { mean[k] += g * (p.rates[k] || 0); vars[k] += g * gameVar(p.rates[k] || 0); }
    for (const [mk, ak] of [['fgm', 'fga'], ['ftm', 'fta']]) {
      const a = p.rates[ak] || 0, pct = a ? (p.rates[mk] || 0) / a : 0;
      vars[`${mk}_shot`] = (vars[`${mk}_shot`] || 0) + g * a * pct * (1 - pct) * 1.5;
    }
  }
  return { mean, vars };
}

const ZERO = Object.fromEntries(KEYS.map(k => [k, 0]));
// Average weekly category win chances against every other team
export function seasonStrength(team, others) {
  const me = weeklyLine(team);
  const all = others.map(o => categoryOdds({ me: ZERO, opp: ZERO }, me, weeklyLine(o)));
  const cats = all[0].map((c, i) => ({ name: c.name, winProb: all.reduce((a, o) => a + o[i].winProb, 0) / all.length }));
  return { cats, expected: all.reduce((a, o) => a + expectedWins(o), 0) / all.length };
}

async function leagueRosters(req, res, ctx, espn) {
  const data = await yget(req, res, `league/${ctx.leagueKey}/teams`);
  const nodes = each(merge(data.fantasy_content.league.slice(1)).teams, 'team');
  const today = etDate();
  return Promise.all(nodes.map(async node => {
    const info = merge(node[0] || node);
    const players = await roster(req, res, info.team_key, today).catch(() => []);
    return {
      key: info.team_key, name: info.name, manager: nick(node), mine: info.team_key === ctx.teamKey,
      players: players.map(p => {
        const r = ratesFor(p, espn);
        return {
          key: p.key, name: p.name, team: nbaTeam(p.team), pos: p.displayPos, slot: p.slot, status: p.status,
          rates: r.rates, src: r.src, avail: availability(p),
          durability: durabilityOf(p.name, espn), ...rosOf(p.name, espn),
        };
      }),
    };
  }));
}

function durabilityOf(name, espn) {
  const e = espn.get(normName(name));
  return e ? durability(e) : 1;
}

export async function trade(req, res) {
  const ctx = await myContext(req, res);
  const espn = await espnRates();
  const teams = await leagueRosters(req, res, ctx, espn);
  const me = teams.find(t => t.mine);
  if (!me) throw Object.assign(new Error('Could not find your team in this league'), { status: 404 });
  const slim = t => ({ key: t.key, name: t.name, manager: t.manager, players: t.players.map(p => ({ key: p.key, name: p.name, pos: p.pos, team: p.team, status: p.status, rosRank: p.rosRank })) });
  if (!req.query.partner) return { me: slim(me), teams: teams.filter(t => !t.mine).map(slim) };

  const partner = teams.find(t => t.key === req.query.partner);
  if (!partner) throw Object.assign(new Error('Unknown trade partner'), { status: 400 });
  const give = new Set(String(req.query.give || '').split(',').filter(Boolean));
  const get = new Set(String(req.query.get || '').split(',').filter(Boolean));
  if (!give.size && !get.size) throw Object.assign(new Error('Pick at least one player'), { status: 400 });

  const active = t => t.players.filter(p => !IL_SLOTS.has(p.slot));
  const meAfter = [...active(me).filter(p => !give.has(p.key)), ...active(partner).filter(p => get.has(p.key))];
  const ptAfter = [...active(partner).filter(p => !get.has(p.key)), ...active(me).filter(p => give.has(p.key))];
  const others = teams.filter(t => t.key !== me.key && t.key !== partner.key).map(active);

  const before = seasonStrength(active(me), [active(partner), ...others]);
  const after = seasonStrength(meAfter, [ptAfter, ...others]);
  const pBefore = seasonStrength(active(partner), [active(me), ...others]);
  const pAfter = seasonStrength(ptAfter, [meAfter, ...others]);
  const diff = (a, b) => b.cats.map((c, i) => ({ name: c.name, before: a.cats[i].winProb, after: c.winProb, change: c.winProb - a.cats[i].winProb }));

  return {
    partner: { name: partner.name, manager: partner.manager },
    give: active(me).filter(p => give.has(p.key)).map(p => p.name),
    get: active(partner).filter(p => get.has(p.key)).map(p => p.name),
    rosterChange: get.size - give.size,
    me: { before: before.expected, after: after.expected, change: after.expected - before.expected, cats: diff(before, after) },
    partnerResult: { before: pBefore.expected, after: pAfter.expected, change: pAfter.expected - pBefore.expected, cats: diff(pBefore, pAfter) },
    unrated: [...meAfter, ...ptAfter].filter(p => p.src === 'none').map(p => p.name),
  };
}
