// Draft pool from ESPN Fantasy's public player data: season projections, the
// category (ROTO) ranking, ADP and injury status. No login required — this is
// the fallback while Yahoo's Fantasy API is gated behind its approval program.
const PLAYERS = season => `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${season}/segments/0/leaguedefaults/1?view=kona_player_info`;
const TEAMS = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (HoopIntel)', Accept: 'application/json' };

// ESPN fantasy stat ids (per-game averages)
const S = { pts: '0', blk: '1', stl: '2', ast: '3', reb: '6', to: '11', fgm: '13', fga: '14', ftm: '15', fta: '16', tpm: '17', gp: '42' };
// eligibleSlots ids that are real positions
const SLOT_POS = { 0: 'PG', 1: 'SG', 2: 'SF', 3: 'PF', 4: 'C' };
const INJURY = { OUT: 'O', DAY_TO_DAY: 'DTD', INJURY_RESERVE: 'INJ', SUSPENSION: 'SUSP' };
const ESPN_TO_NBA = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS' };

let cache = null;

export const espnSeason = (d = new Date()) => (d.getUTCMonth() >= 7 ? d.getUTCFullYear() + 1 : d.getUTCFullYear());

async function teamMap() {
  try {
    const r = await fetch(TEAMS, { headers: HEADERS });
    const j = await r.json();
    const teams = j.sports?.[0]?.leagues?.[0]?.teams || [];
    return Object.fromEntries(teams.map(({ team }) => [String(team.id), ESPN_TO_NBA[team.abbreviation] || team.abbreviation]));
  } catch {
    return {};
  }
}

export function parseEspnPlayers(json, teams, season) {
  const rows = [];
  for (const entry of json.players || []) {
    const p = entry.player || {};
    const stats = p.stats || [];
    const proj = stats.find(s => s.id === `10${season}` && s.averageStats);
    const last = stats.find(s => s.id === `00${season - 1}` && s.averageStats);
    const src = proj || last;
    const a = src?.averageStats || {};
    const n = k => Number(a[S[k]]) || 0;
    const pos = (p.eligibleSlots || []).map(id => SLOT_POS[id]).filter(Boolean);
    rows.push({
      key: `espn:${p.id}`,
      name: p.fullName,
      team: teams[String(p.proTeamId)] || (p.proTeamId ? '' : 'FA'),
      pos,
      status: INJURY[p.injuryStatus] || '',
      adp: Number(p.ownership?.averageDraftPosition) || null,
      rotoRank: p.draftRanksByRankType?.ROTO?.rank || null,
      gp: n('gp') || null,
      statSource: proj ? 'projection' : last ? 'last season' : null,
      hasStats: n('pts') > 0,
      pts: n('pts'), reb: n('reb'), ast: n('ast'), stl: n('stl'), blk: n('blk'),
      tpm: n('tpm'), to: n('to'), fgm: n('fgm'), fga: n('fga'), ftm: n('ftm'), fta: n('fta'),
      projected: !!proj,
    });
  }
  // "Market rank": the order people actually draft in (ADP), falling back to ESPN's ROTO rank
  const sorted = [...rows].sort((x, y) => (x.adp || 999) - (y.adp || 999) || (x.rotoRank || 999) - (y.rotoRank || 999));
  sorted.forEach((r, i) => { r.yahooRank = i + 1; });
  return sorted;
}

export async function espnDraftPool(req) {
  const count = Math.min(Number(req.query.count) || 300, 500);
  const season = Number(req.query.season) || espnSeason();
  if (cache && cache.season === season && cache.count === count && Date.now() - cache.t < 3600_000) return cache.v;

  const filter = {
    players: {
      limit: count,
      sortDraftRanks: { sortPriority: 100, sortAsc: true, value: 'ROTO' },
      filterStatsForSourceIds: { value: [0, 1] },
      filterStatsForSplitTypeIds: { value: [0] },
    },
  };
  const [r, teams] = await Promise.all([
    fetch(PLAYERS(season), { headers: { ...HEADERS, 'X-Fantasy-Filter': JSON.stringify(filter) } }),
    teamMap(),
  ]);
  if (!r.ok) throw Object.assign(new Error(`ESPN fantasy ${r.status}`), { status: 502 });
  const players = parseEspnPlayers(await r.json(), teams, season);
  const v = {
    source: 'espn', season, count: players.length,
    withProjections: players.filter(p => p.projected).length,
    fetchedAt: new Date().toISOString(),
    players,
  };
  cache = { season, count, t: Date.now(), v };
  return v;
}
