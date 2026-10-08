// Draft player pool: Yahoo's preseason rank order + last season's per-game stats.
import { yget, merge, each, parsePlayer, myContext } from './yahoo.js';
import { yahooLine } from './gamenight.js';

const PAGE = 25;

async function page(req, res, leagueKey, start, season, statType, sort) {
  const data = await yget(req, res,
    `league/${leagueKey}/players;sort=${sort};start=${start};count=${PAGE}/stats;type=${statType};season=${season}`);
  const league = merge(data.fantasy_content.league);
  return each(league.players, 'player').map(parsePlayer);
}

async function fetchAll(req, res, leagueKey, total, season, statType, sort) {
  const starts = [];
  for (let s = 0; s < total; s += PAGE) starts.push(s);
  const pages = [];
  // Small batches — Yahoo rate-limits bursts
  for (let i = 0; i < starts.length; i += 4) {
    pages.push(...await Promise.all(starts.slice(i, i + 4).map(s => page(req, res, leagueKey, s, season, statType, sort))));
  }
  return pages.flat();
}

const hasStats = players => players.some(p => Number(p.stats['12']) > 0);

export async function draftPool(req, res) {
  const ctx = await myContext(req, res);
  const total = Math.min(Number(req.query.count) || 250, 400);
  const season = Number(req.query.season) || new Date().getFullYear() - 1;

  // Prefer Yahoo's preseason rank (OR); fall back to last season's actual rank (AR)
  let players, sort = 'OR', statType = 'average_season';
  try {
    players = await fetchAll(req, res, ctx.leagueKey, total, season, statType, sort);
  } catch {
    sort = 'AR';
    players = await fetchAll(req, res, ctx.leagueKey, total, season, statType, sort);
  }
  let perGame = true;
  if (!hasStats(players)) {
    // average_season unsupported → totals; convert with games played if Yahoo sends it (stat 0)
    statType = 'season';
    players = await fetchAll(req, res, ctx.leagueKey, total, season, statType, sort);
    perGame = false;
  }

  const out = players.map((p, i) => {
    const line = yahooLine(p.stats);
    const gp = Number(p.stats['0']) || null;
    if (!perGame && gp) {
      for (const k of ['fgm', 'fga', 'ftm', 'fta', 'tpm', 'pts', 'reb', 'ast', 'stl', 'blk', 'to']) line[k] /= gp;
    }
    return {
      key: p.key, name: p.name, team: p.team, pos: p.pos.filter(x => !['G', 'F', 'Util', 'IL', 'IL+', 'BN'].includes(x)),
      status: p.status, yahooRank: i + 1, gp,
      hasStats: line.pts > 0,
      ...line,
    };
  });
  // Dedupe in case Yahoo pages overlapped
  const seen = new Set();
  const unique = out.filter(p => !seen.has(p.key) && seen.add(p.key));

  return {
    league: ctx.leagueName, leagueKey: ctx.leagueKey, draftStatus: ctx.draftStatus,
    season, sort, statType, perGame: perGame || unique.some(p => p.gp),
    fetchedAt: new Date().toISOString(),
    players: unique,
  };
}
