// Draft engine: 9-cat z-score valuation, snake order, lineup-slot fill, and
// need-weighted recommendations. Pure functions — no React, no I/O.

export const CATS = [
  { k: 'fg', label: 'FG%', pct: ['fgm', 'fga'] },
  { k: 'ft', label: 'FT%', pct: ['ftm', 'fta'] },
  { k: 'tpm', label: '3PM' },
  { k: 'pts', label: 'PTS' },
  { k: 'reb', label: 'REB' },
  { k: 'ast', label: 'AST' },
  { k: 'stl', label: 'STL' },
  { k: 'blk', label: 'BLK' },
  { k: 'to', label: 'TO', low: true },
];

// This league: PG, SG, G, SF, PF, F, C, C, Util, Util + 3 BN (IL not drafted)
export const SLOTS = ['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'C', 'Util', 'Util'];
export const DEFAULT_SETTINGS = { teams: 10, rounds: 13, slot: null, weights: Object.fromEntries(CATS.map(c => [c.k, 1])) };

const eligible = (slot, pos) => {
  if (slot === 'Util') return pos.length > 0;
  if (slot === 'G') return pos.includes('PG') || pos.includes('SG');
  if (slot === 'F') return pos.includes('SF') || pos.includes('PF');
  return pos.includes(slot);
};

function meanSd(xs) {
  const n = xs.length || 1;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1;
  return { mean, sd };
}

function zScores(players, ref) {
  const fgAvg = ref.reduce((a, p) => a + p.fgm, 0) / (ref.reduce((a, p) => a + p.fga, 0) || 1);
  const ftAvg = ref.reduce((a, p) => a + p.ftm, 0) / (ref.reduce((a, p) => a + p.fta, 0) || 1);
  // Percentages are volume-weighted: makes above league-average on this many attempts
  const raw = p => ({
    fg: p.fgm - fgAvg * p.fga,
    ft: p.ftm - ftAvg * p.fta,
    tpm: p.tpm, pts: p.pts, reb: p.reb, ast: p.ast, stl: p.stl, blk: p.blk, to: p.to,
  });
  const refRaw = ref.map(raw);
  const dist = Object.fromEntries(CATS.map(c => [c.k, meanSd(refRaw.map(r => r[c.k]))]));
  return players.map(p => {
    const r = raw(p);
    const z = {};
    for (const c of CATS) {
      const v = (r[c.k] - dist[c.k].mean) / dist[c.k].sd;
      z[c.k] = c.low ? -v : v;
    }
    return z;
  });
}

const total = (z, weights) => CATS.reduce((a, c) => a + (weights[c.k] ?? 1) * z[c.k], 0);

// Returns players sorted by value with { z, value, valueRank, tier }.
// Players without stats (rookies, etc.) are kept at the bottom, ordered by Yahoo rank.
// Share of games a player is expected to play. Missed games are lost weekly
// volume in H2H, so per-game stats are scaled by this before valuing.
export const FULL_SEASON_GP = 78;
export function availability(p) {
  if (!p.gp || p.gp <= 1) return 1; // unknown (e.g. CSV without GP)
  return Math.min(1, Math.max(0.25, p.gp / FULL_SEASON_GP));
}
const COUNTING = ['fgm', 'fga', 'ftm', 'fta', 'tpm', 'pts', 'reb', 'ast', 'stl', 'blk', 'to'];

export function computeValues(players, { teams = 10, rounds = 13, weights = DEFAULT_SETTINGS.weights, durability = true } = {}) {
  const withStats = players.filter(p => p.hasStats !== false && p.pts > 0);
  const without = players.filter(p => !(p.hasStats !== false && p.pts > 0));
  const draftable = Math.max(teams * rounds, 20);

  // Value on expected weekly production (per-game × share of games played)
  const eff = withStats.map(p => {
    const a = durability ? availability(p) : 1;
    return a === 1 ? p : { ...p, ...Object.fromEntries(COUNTING.map(k => [k, (p[k] || 0) * a])) };
  });

  // Two passes: reference pool = top-N by market rank, then top-N by our own value
  let ref = [...eff].sort((a, b) => (a.yahooRank ?? 999) - (b.yahooRank ?? 999)).slice(0, draftable);
  let zs = zScores(eff, ref);
  for (let pass = 0; pass < 2; pass++) {
    const order = eff.map((p, i) => ({ p, v: total(zs[i], weights) })).sort((a, b) => b.v - a.v);
    ref = order.slice(0, draftable).map(o => o.p);
    zs = zScores(eff, ref);
  }

  const valued = withStats
    .map((p, i) => ({ ...p, z: zs[i], value: total(zs[i], weights) }))
    .sort((a, b) => b.value - a.value);
  valued.forEach((p, i) => { p.valueRank = i + 1; });
  assignTiers(valued);

  const rest = without
    .sort((a, b) => (a.yahooRank ?? 999) - (b.yahooRank ?? 999))
    .map(p => ({ ...p, z: null, value: null, valueRank: null, tier: null }));
  return [...valued, ...rest];
}

// New tier when the value drop to the next player is large relative to local spread
function assignTiers(sorted) {
  let tier = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const gap = sorted[i - 1].value - sorted[i].value;
      const threshold = i < 30 ? 0.55 : 0.4;
      if (gap > threshold || (i % 24 === 0 && i > 0)) tier++;
    }
    sorted[i].tier = tier;
  }
}

// ── Snake order ─────────────────────────────────────────────────────────────
export function teamOnClock(pick, teams) {
  const round = Math.ceil(pick / teams);
  const idx = (pick - 1) % teams; // 0-based within round
  return { round, team: round % 2 === 1 ? idx + 1 : teams - idx, inRound: idx + 1 };
}

export function picksForSlot(slot, teams, rounds) {
  const out = [];
  for (let r = 1; r <= rounds; r++) out.push((r - 1) * teams + (r % 2 === 1 ? slot : teams + 1 - slot));
  return out;
}

// ── Lineup fill (maximum matching of players to starting slots) ─────────────
export function slotFill(players) {
  const order = SLOTS.map((s, i) => ({ s, i }))
    .sort((a, b) => players.filter(p => eligible(a.s, p.pos || [])).length - players.filter(p => eligible(b.s, p.pos || [])).length);
  let best = { count: -1, assign: [] };
  const used = new Set();
  const assign = [];
  function go(k, count) {
    if (count + (order.length - k) <= best.count) return;
    if (k === order.length) { best = { count, assign: [...assign] }; return; }
    const { s, i } = order[k];
    for (const p of players) {
      if (!used.has(p.key) && eligible(s, p.pos || [])) {
        used.add(p.key); assign.push({ slotIndex: i, slot: s, player: p });
        go(k + 1, count + 1);
        used.delete(p.key); assign.pop();
        if (best.count === order.length) return;
      }
    }
    go(k + 1, count);
  }
  go(0, 0);
  const filled = SLOTS.map((s, i) => ({ slot: s, player: best.assign.find(a => a.slotIndex === i)?.player || null }));
  const starters = new Set(best.assign.map(a => a.player.key));
  return { filled, bench: players.filter(p => !starters.has(p.key)), open: filled.filter(f => !f.player).map(f => f.slot) };
}

// ── Recommendations ─────────────────────────────────────────────────────────
export function teamProfile(myPlayers) {
  const n = myPlayers.filter(p => p.z).length;
  const sums = Object.fromEntries(CATS.map(c => [c.k, myPlayers.reduce((a, p) => a + (p.z?.[c.k] || 0), 0)]));
  const avg = Object.fromEntries(CATS.map(c => [c.k, n ? sums[c.k] / n : 0]));
  return { n, sums, avg };
}

// Weak categories get more weight, stacked ones less (H2H only needs 5 of 9).
// Punted categories (weight 0) stay at 0.
// How much each category should count for the next pick.
//  mode 'linear' (legacy): mild boost for weak cats, mild cut for strong ones.
//  mode 'h2h': weight by how much a pick moves your chance of WINNING the category.
//    Projected end-of-draft surplus in z units is compared to a typical opponent;
//    categories you'll win anyway (or can't win) count less — surplus is wasted in H2H.
export function needWeights(myPlayers, weights, { mode = 'linear', sigma = 4, rosterSize = 13 } = {}) {
  const { n, avg } = teamProfile(myPlayers);
  return Object.fromEntries(CATS.map(c => {
    const w = weights[c.k] ?? 1;
    if (w === 0 || n < 2) return [c.k, w];
    if (mode === 'h2h') {
      const confidence = Math.min(1, n / 6);
      const projected = avg[c.k] * rosterSize * confidence;
      // Behind: worth more (fixable in a draft). Ahead: diminishing returns.
      if (projected <= 0) return [c.k, w * (1 + Math.min(0.75, -projected / (2 * sigma)))];
      return [c.k, w * Math.max(0.15, Math.exp(-(projected ** 2) / (2 * sigma ** 2)))];
    }
    return [c.k, w * Math.min(1.5, Math.max(0.6, 1 - 0.3 * avg[c.k]))];
  }));
}

export function recommend(available, myPlayers, weights, picksLeft, needOpts) {
  const nw = needWeights(myPlayers, weights, needOpts);
  const base = slotFill(myPlayers);
  const scarce = picksLeft <= base.open.length + 2;
  return available.map(p => {
    if (!p.z) return { ...p, fit: null, fillsSlot: false };
    let fit = CATS.reduce((a, c) => a + nw[c.k] * p.z[c.k], 0);
    let fillsSlot = false;
    // The slot check is costly and only changes the score when slots are scarce
    if (base.open.length && scarce) {
      fillsSlot = slotFill([...myPlayers, p]).open.length < base.open.length;
      if (fillsSlot && scarce) fit += 1.0;
      if (!fillsSlot && scarce) fit -= 1.0;
    }
    return { ...p, fit, fillsSlot };
  });
}

// ── CSV projections import ──────────────────────────────────────────────────
const ALIASES = {
  name: ['name', 'player', 'player name', 'playername'],
  team: ['team', 'tm'],
  pos: ['pos', 'position', 'positions'],
  gp: ['gp', 'g', 'games'],
  pts: ['pts', 'points', 'p'],
  reb: ['reb', 'trb', 'rebounds', 'r'],
  ast: ['ast', 'assists', 'a'],
  stl: ['stl', 'st', 'steals', 's'],
  blk: ['blk', 'bk', 'blocks', 'b'],
  tpm: ['3pm', '3ptm', 'tpm', '3pt', '3p', 'threes', 'fg3m'],
  to: ['to', 'tov', 'turnovers'],
  fgm: ['fgm'], fga: ['fga'], ftm: ['ftm'], fta: ['fta'],
  fgPct: ['fg%', 'fgpct', 'fg_pct', 'fg'],
  ftPct: ['ft%', 'ftpct', 'ft_pct', 'ft'],
};

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(c => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(c => c.trim())) rows.push(row);
  return rows;
}

export function normName(name) {
  return (name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[.'’-]/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/\s+/g, ' ').trim();
}

// Merge projection rows into the pool. Returns { players, matched, added, skipped }.
export function importProjections(pool, csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) throw new Error('CSV needs a header row and at least one player');
  const header = rows[0].map(h => h.trim().toLowerCase());
  const col = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const i = header.findIndex(h => names.includes(h));
    if (i >= 0) col[field] = i;
  }
  if (col.name === undefined) throw new Error('CSV needs a Name/Player column');
  if (col.pts === undefined) throw new Error('CSV needs a PTS column');

  const byName = new Map(pool.map(p => [normName(p.name), p]));
  const out = new Map(pool.map(p => [p.key, { ...p }]));
  let matched = 0, added = 0, skipped = 0;
  const num = (r, f) => {
    if (col[f] === undefined) return undefined;
    const v = parseFloat(String(r[col[f]]).replace('%', ''));
    return Number.isFinite(v) ? v : undefined;
  };

  for (const r of rows.slice(1)) {
    const name = (r[col.name] || '').trim();
    if (!name) { skipped++; continue; }
    const existing = byName.get(normName(name));
    const p = existing ? out.get(existing.key) : {
      key: `csv:${normName(name)}`, name, team: (r[col.team] || '').trim().toUpperCase(),
      pos: String(r[col.pos] ?? '').split(/[,/ ]+/).map(s => s.trim().toUpperCase()).filter(s => ['PG', 'SG', 'SF', 'PF', 'C'].includes(s)),
      yahooRank: 900 + added, status: '', fgm: 0, fga: 0, ftm: 0, fta: 0,
    };
    for (const f of ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'to', 'fgm', 'fga', 'ftm', 'fta', 'gp']) {
      const v = num(r, f);
      if (v !== undefined) p[f] = v;
    }
    for (const [pctField, m, a] of [['fgPct', 'fgm', 'fga'], ['ftPct', 'ftm', 'fta']]) {
      let v = num(r, pctField);
      if (v === undefined || col[m] !== undefined) continue;
      if (v > 1) v /= 100;
      if (!p[a]) p[a] = a === 'fga' ? 10 : 3; // no volume known: assume roughly average
      p[m] = v * p[a];
    }
    p.hasStats = (p.pts || 0) > 0;
    p.projected = true;
    if (existing) matched++; else { added++; out.set(p.key, p); }
  }
  return { players: [...out.values()], matched, added, skipped };
}
