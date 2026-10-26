// Weekly review: last week's final category results next to what This Week
// projected and the adds/drops you made, so we can tell whether the
// projections and add suggestions actually help.
import { yget, merge, each, parseTeamInfo, myContext } from './yahoo.js';
import { etDate } from './nba.js';
import { CATS, yahooLine, catValue, weekBounds } from './gamenight.js';
import { storeConfigured, getJson } from './store.js';

const result = (cat, mine, opp) => {
  if (Math.abs(mine - opp) < (cat.pct ? 0.0005 : 0.001)) return 'T';
  return (cat.low ? mine < opp : mine > opp) ? 'W' : 'L';
};

// The projection to grade against: the first one saved that week
async function savedProjection(week) {
  if (!storeConfigured()) return null;
  const first = await getJson(`snap:week:${week}:first`).catch(() => null);
  if (first) return first;
  const latest = await getJson('snap:week').catch(() => null);
  return latest && Number(latest.week) === Number(week) ? latest : null;
}

// Yahoo transactions → your adds and drops (transaction_data is an object or an array)
export function parseMoves(data, teamKey, start, end) {
  const out = [];
  const txs = each(merge(data?.fantasy_content?.league?.slice?.(1) || []).transactions, 'transaction');
  for (const t of txs) {
    const meta = merge(t[0] || t);
    const day = meta.timestamp ? etDate(new Date(Number(meta.timestamp) * 1000)) : null;
    if (!day || day < start || day > end) continue;
    for (const pl of each(merge(t.slice?.(1) || []).players, 'player')) {
      const info = merge(pl[0]);
      const tdRaw = merge(pl.slice(1)).transaction_data;
      for (const td of Array.isArray(tdRaw) ? tdRaw : [tdRaw]) {
        if (!td) continue;
        if (td.type === 'add' && td.destination_team_key === teamKey) out.push({ day, type: 'add', name: info.name?.full });
        if (td.type === 'drop' && td.source_team_key === teamKey) out.push({ day, type: 'drop', name: info.name?.full });
      }
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

export async function weekReview(req, res) {
  const ctx = await myContext(req, res);
  if (!ctx.teamKey) throw Object.assign(new Error('Could not find your team in this league'), { status: 404 });
  const week = Number(req.query.week) || ctx.currentWeek - 1;
  if (week < 1) return { week: 0, none: true };

  const [md, bounds, proj, txData] = await Promise.all([
    yget(req, res, `team/${ctx.teamKey}/matchups;weeks=${week}`),
    weekBounds(req, res, week),
    savedProjection(week),
    yget(req, res, `league/${ctx.leagueKey}/transactions;team_key=${ctx.teamKey};types=add,drop`).catch(() => null),
  ]);
  const mt = merge(md.fantasy_content.team.slice(1));
  const m = each(mt.matchups, 'matchup')[0] || {};
  const teams = each(merge(m['0'] ? m['0'] : m).teams, 'team').map(parseTeamInfo);
  const me = teams.find(t => t.key === ctx.teamKey) || teams[0];
  const opp = teams.find(t => t.key !== ctx.teamKey) || null;
  const mine = yahooLine(me?.stats || {});
  const theirs = yahooLine(opp?.stats || {});

  const winners = {};
  for (const sw of m.stat_winners || []) {
    const s = sw.stat_winner;
    if (s) winners[s.stat_id] = Number(s.is_tied) ? 'T' : s.winner_team_key === ctx.teamKey ? 'W' : 'L';
  }
  const projected = new Map((proj?.categories || []).map(c => [c.name, c]));
  const cats = CATS.map(cat => {
    const a = catValue(cat, mine), b = catValue(cat, theirs);
    const p = projected.get(cat.name);
    return {
      name: cat.name, pct: !!cat.pct, mine: a, opp: b,
      result: winners[cat.id] || result(cat, a, b),
      projWin: p ? p.winProb : null, projMine: p ? p.mineEnd : null, projOpp: p ? p.oppEnd : null,
    };
  });
  const count = r => cats.filter(c => c.result === r).length;
  // Did the projection lean the right way on the categories it called?
  const called = cats.filter(c => c.projWin != null && Math.abs(c.projWin - 0.5) >= 0.1);
  const right = called.filter(c => (c.projWin > 0.5) === (c.result === 'W')).length;

  return {
    week, start: bounds.start, end: bounds.end,
    final: m.status ? m.status === 'postevent' : bounds.end < etDate(),
    opp: opp ? { name: opp.name } : null,
    record: { w: count('W'), l: count('L'), t: count('T') },
    categories: cats,
    projection: proj ? { savedAt: proj.savedAt, expectedWins: proj.expectedWins, calls: called.length, right } : null,
    moves: txData ? parseMoves(txData, ctx.teamKey, bounds.start, bounds.end) : null,
  };
}
