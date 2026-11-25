// Extra signals for "who can I drop?": can you get him back (rostered %), his
// playoff schedule (weeks 19-21 vs the average NBA team), whether his role is
// growing or shrinking (shots per game, last month vs season), and whether
// dropping him leaves a lineup slot nobody can fill. Each piece is optional:
// if Yahoo won't give it, that column is just blank.
import { yget, merge, each, parsePlayer } from './yahoo.js';
import { gamesBetween, nbaTeam } from './nba.js';
import { yahooLine } from './gamenight.js';
import { playoffWeeks } from './manage.js';
import { fitsSlot, SLOTS } from './lineup.js';
import { storeConfigured, getJson, setJson } from './store.js';

export const OWNED_STICKY = 50;   // % rostered above which a dropped player won't last
const TREND = 0.2;                // ±20% shots per game = a role change worth flagging

const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function playersBatch(req, res, lk, keys, sub) {
  const out = new Map();
  for (const part of chunk(keys, 25)) {
    const data = await yget(req, res, `league/${lk}/players;player_keys=${part.join(',')}/${sub}`);
    for (const node of each(merge(data.fantasy_content.league).players, 'player')) {
      const p = parsePlayer(node);
      out.set(p.key, p);
    }
  }
  return out;
}

// Playoff games per NBA team (the schedule is fixed, so it's cached)
export async function playoffGames(req, res, lk) {
  const key = `cache:playoffGames:${lk}`;
  const cached = storeConfigured() ? await getJson(key).catch(() => null) : null;
  if (cached?.teams) return cached;
  const weeks = await playoffWeeks(req, res, lk);
  if (!weeks.length) return null;
  const games = (await Promise.all(weeks.map(w => gamesBetween(w.start, w.end)))).flat();
  const teams = {};
  for (const g of games) for (const t of [g.home, g.away]) teams[t] = (teams[t] || 0) + 1;
  const vals = Object.values(teams);
  const doc = { teams, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0 };
  if (storeConfigured() && vals.length) await setJson(key, doc).catch(() => {});
  return doc;
}

// Positions only this player can cover: drop him and no one else on the
// (healthy) roster is eligible for that slot at all
export function slotShortages(roster) {
  const healthy = roster.filter(p => !['IL', 'IL+', 'IL+LT', 'NA'].includes(p.slot) && !['O', 'INJ', 'OUT', 'SUSP', 'NA'].includes(p.status));
  const kinds = [...new Set(SLOTS)];
  return new Map(healthy.map(p => [p.id, kinds.filter(slot => fitsSlot(slot, p.posList || []) && !healthy.some(x => x !== p && fitsSlot(slot, x.posList || [])))]));
}

// roster: weekState players ({id, name, team, pos, slot, status, stats, posList})
export async function swapSignals(req, res, lk, roster) {
  const keys = roster.map(p => p.id).filter(Boolean);
  const [owned, recent, po] = await Promise.all([
    playersBatch(req, res, lk, keys, 'percent_owned').catch(() => null),
    playersBatch(req, res, lk, keys, 'stats;type=average_lastmonth').catch(() => null),
    playoffGames(req, res, lk).catch(() => null),
  ]);
  const short = slotShortages(roster);
  return new Map(roster.map(p => {
    const own = owned?.get(p.id)?.owned;
    const season = yahooLine(p.stats || {});
    const last = recent?.get(p.id) ? yahooLine(recent.get(p.id).stats || {}) : null;
    const trend = last && season.fga > 2 && last.fga > 0 ? last.fga / season.fga - 1 : null;
    const pg = po ? po.teams[nbaTeam(p.team)] ?? 0 : null;
    const flags = [];
    if (own != null && own >= OWNED_STICKY) flags.push(`${Math.round(own)}% rostered: he won’t last on waivers`);
    if (trend != null && trend <= -TREND) flags.push(`Role shrinking: ${Math.round(-trend * 100)}% fewer shots lately`);
    if (trend != null && trend >= TREND) flags.push(`Role growing: ${Math.round(trend * 100)}% more shots lately`);
    if (po && pg <= po.avg - 1) flags.push(`Light playoff schedule (${pg} games vs ${po.avg.toFixed(1)} avg)`);
    if (po && pg >= po.avg + 1) flags.push(`Busy playoff schedule (${pg} games vs ${po.avg.toFixed(1)} avg)`);
    if (short.get(p.id)?.length) flags.push(`Only healthy ${short.get(p.id).filter(x => !['G', 'F', 'Util'].includes(x)).join('/') || short.get(p.id).join('/')}: if you drop him, add one back`);
    return [p.id, { owned: own ?? null, trend, playoffGames: pg, playoffAvg: po?.avg ?? null, shortSlots: short.get(p.id) || [], flags }];
  }));
}

// Nudge a player's season value by these signals (same units as rosValue,
// a sum of category z-scores): harder to replace and busier playoffs = keep
export function adjustedValue(rosValue, s) {
  let v = rosValue ?? -9;
  if (!s) return v;
  if (s.owned != null && s.owned >= OWNED_STICKY) v += 1.5;
  if (s.playoffGames != null && s.playoffAvg) v += 0.4 * (s.playoffGames - s.playoffAvg);
  if (s.trend != null) v += 2 * Math.max(-0.6, Math.min(0.6, s.trend));
  if (s.shortSlots?.length) v += 1; // dropping him means the add must cover his position
  return v;
}
