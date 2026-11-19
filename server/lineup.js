// Lineup setter: the best legal lineup for a day (who plays, who's healthy,
// which slots each can fill), the moves to get there, and applying it in
// Yahoo. A nightly cron sets tomorrow's lineup when auto mode is on, or just
// saves the plan in suggest mode.
import { yput, myContext, ownerSession } from './yahoo.js';
import { gamesBetween, etDate, addDays, nbaTeam } from './nba.js';
import { roster } from './gamenight.js';
import { IL_SLOTS, OUT, espnRates, rosOf, ratesFor, realWeight, teamGames } from './weekly.js';
import { storeConfigured, getJson, setJson } from './store.js';

// Can a player with these eligible positions fill this lineup slot?
export function fitsSlot(slot, pos = []) {
  if (slot === 'Util') return pos.some(p => ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F'].includes(p));
  if (slot === 'G') return pos.includes('PG') || pos.includes('SG') || pos.includes('G');
  if (slot === 'F') return pos.includes('SF') || pos.includes('PF') || pos.includes('F');
  return pos.includes(slot);
}

export const SLOTS = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'C', 'Util', 'Util'];
const DOUBTFUL = new Set(['GTD', 'DTD', 'Q']);
const FILL = 1000; // any player who plays beats an empty slot

// Best assignment of players to the 10 starting slots. Exact search over
// slots × used-player sets (rosters are ~13 non-IL players). Ties keep a
// player where he already is, so the lineup doesn't churn for nothing.
export function bestLineup(players, { plays, value }) {
  const pool = players.filter(p => !IL_SLOTS.has(p.slot));
  const cand = pool.filter(p => plays(p) && !OUT.has(p.status));
  const n = cand.length;
  const val = new Map(cand.map(p => { const v = value(p); return [p.key, Number.isFinite(v) ? Math.max(-100, Math.min(100, v)) : 0]; }));
  const score = (i, p) => FILL + val.get(p.key) - (DOUBTFUL.has(p.status) ? 3 : 0) + (p.slot === SLOTS[i] ? 0.01 : 0);
  const memo = new Map();
  const f = (i, mask) => {
    if (i === SLOTS.length) return 0;
    const k = i * (1 << n) + mask;
    if (memo.has(k)) return memo.get(k);
    let best = f(i + 1, mask); // leave empty
    for (let j = 0; j < n; j++) {
      if (mask & (1 << j) || !fitsSlot(SLOTS[i], cand[j].pos)) continue;
      best = Math.max(best, score(i, cand[j]) + f(i + 1, mask | (1 << j)));
    }
    memo.set(k, best);
    return best;
  };
  const target = new Map(pool.map(p => [p.key, 'BN']));
  let mask = 0;
  for (let i = 0; i < SLOTS.length; i++) {
    const here = f(i, mask);
    if (Math.abs(here - f(i + 1, mask)) < 1e-9) continue;
    for (let j = 0; j < n; j++) {
      if (mask & (1 << j) || !fitsSlot(SLOTS[i], cand[j].pos)) continue;
      if (Math.abs(here - (score(i, cand[j]) + f(i + 1, mask | (1 << j)))) < 1e-9) {
        target.set(cand[j].key, SLOTS[i]);
        mask |= 1 << j;
        break;
      }
    }
  }
  const moves = pool.filter(p => p.slot !== target.get(p.key))
    .map(p => ({ key: p.key, name: p.name, from: p.slot, to: target.get(p.key), plays: plays(p), status: p.status }));
  return {
    lineup: pool.map(p => ({ key: p.key, name: p.name, pos: p.displayPos, status: p.status, plays: plays(p), slot: target.get(p.key) })),
    moves,
    starters: [...target.values()].filter(s => s !== 'BN').length,
    // Starters today who won't play (out or no game): what the current lineup wastes
    idleStarters: pool.filter(p => p.slot !== 'BN' && !(plays(p) && !OUT.has(p.status))).map(p => p.name),
    benchedPlaying: cand.filter(p => target.get(p.key) === 'BN').map(p => p.name),
  };
}

// Plain-English steps for the moves
export function describe(moves) {
  return moves.map(m => (m.to === 'BN'
    ? `Bench ${m.name}${m.status && OUT.has(m.status) ? ` (${m.status})` : !m.plays ? ' (no game)' : ''}`
    : m.from === 'BN' ? `Start ${m.name} at ${m.to}` : `Move ${m.name} from ${m.from} to ${m.to}`));
}

export function rosterXml(date, lineup) {
  const esc = s => String(s).replace(/[<>&'"]/g, c => `&#${c.charCodeAt(0)};`);
  const players = lineup.map(p => `<player><player_key>${esc(p.key)}</player_key><position>${esc(p.slot)}</position></player>`).join('');
  return `<?xml version="1.0"?><fantasy_content><roster><coverage_type>date</coverage_type><date>${esc(date)}</date><players>${players}</players></roster></fantasy_content>`;
}

// Tomorrow by default: this league's lineup changes take effect the next day
async function planFor(req, res, date) {
  const ctx = await myContext(req, res);
  if (!ctx.teamKey) throw Object.assign(new Error('Could not find your team in this league'), { status: 404 });
  const [players, games, espn] = await Promise.all([
    roster(req, res, ctx.teamKey, date),
    gamesBetween(date, date).catch(() => []),
    espnRates(),
  ]);
  const by = teamGames(games);
  const w = realWeight(ctx.currentWeek);
  const plays = p => !!by[nbaTeam(p.team)]?.has(date);
  const value = p => rosOf(p.name, espn, ratesFor(p, espn, w).rates).rosValue ?? -5;
  return { ctx, date, noGames: games.length === 0, ...bestLineup(players, { plays, value }) };
}

const dateParam = q => (/^\d{4}-\d{2}-\d{2}$/.test(q || '') ? q : addDays(etDate(), 1));

export async function lineupPlan(req, res) {
  const p = await planFor(req, res, dateParam(req.query.date));
  return { date: p.date, noGames: p.noGames, moves: p.moves, steps: describe(p.moves), lineup: p.lineup, idleStarters: p.idleStarters, benchedPlaying: p.benchedPlaying };
}

async function apply(req, res, p) {
  if (!p.moves.length) return { applied: false, reason: 'Lineup is already the best one' };
  try {
    await yput(req, res, `team/${p.ctx.teamKey}/roster`, rosterXml(p.date, p.lineup));
    return { applied: true };
  } catch (e) {
    const perm = /40[13]/.test(e.message);
    return { applied: false, reason: perm ? 'Yahoo refused the change: the app needs permission to edit your roster (Settings → Nightly lineup → Allow lineup changes).' : e.message };
  }
}

export async function lineupApply(req, res) {
  const p = await planFor(req, res, dateParam(req.query.date));
  const r = await apply(req, res, p);
  if (r.applied) await saveRun({ date: p.date, mode: 'manual', steps: describe(p.moves), ...r });
  return { date: p.date, steps: describe(p.moves), ...r };
}

// ── Nightly mode ────────────────────────────────────────────────────────────
const CFG = 'cfg:lineup';
const RUN = 'snap:lineup';
export const MODES = ['off', 'suggest', 'auto'];

export async function lineupConfig(req) {
  if (!storeConfigured()) throw Object.assign(new Error('Cloud storage is not set up'), { status: 503 });
  if (req.method === 'POST') {
    const mode = String(req.body?.mode || '');
    if (!MODES.includes(mode)) throw Object.assign(new Error('Unknown mode'), { status: 400 });
    await setJson(CFG, { mode, updatedAt: new Date().toISOString() });
  }
  const [cfg, last, owner] = await Promise.all([getJson(CFG).catch(() => null), getJson(RUN).catch(() => null), ownerSession().catch(() => null)]);
  return { mode: cfg?.mode || 'suggest', lastRun: last, ownerConnected: !!owner, canWrite: owner?.scope ? /fspt-w/.test(owner.scope) : null };
}

const saveRun = doc => (storeConfigured() ? setJson(RUN, { ranAt: new Date().toISOString(), ...doc }).catch(() => {}) : null);

// Tomorrow's lineup for the morning job: plan, apply in auto mode
export async function lineupRun(req, res, mode) {
  const p = await planFor(req, res, addDays(etDate(), 1));
  const r = mode === 'auto' ? await apply(req, res, p) : { applied: false, reason: 'Suggest mode' };
  const doc = { date: p.date, mode, steps: describe(p.moves), idleStarters: p.idleStarters, lineup: p.lineup, ...r };
  await saveRun({ ...doc, lineup: undefined });
  return doc;
}

// Suggestions only, nothing saved: for league-mates' morning reports
export async function lineupSuggest(req, res) {
  const p = await planFor(req, res, addDays(etDate(), 1));
  return { date: p.date, steps: describe(p.moves), idleStarters: p.idleStarters, lineup: p.lineup, applied: false };
}

export const lineupMode = async () => (await getJson(CFG).catch(() => null))?.mode || 'suggest';
export const lastRun = () => getJson(RUN).catch(() => null);
export { saveRun };
