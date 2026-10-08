// League history: walk the league's renewal chain and pull each past season's
// standings, draft results (with how those players actually performed), and
// weekly category winners. Past seasons never change, so the client caches them.
import { yget, merge, each, parsePlayer, myContext } from './yahoo.js';
import { yahooLine } from './gamenight.js';

const LEAGUE_KEY = /^\d+\.l\.\d+$/;
const renewToKey = r => (r && /^\d+_\d+$/.test(r) ? r.replace('_', '.l.') : null);

function parseManager(info) {
  const m = merge((info.managers || []).map(x => x.manager));
  return {
    guid: m.guid && m.guid !== '--' ? m.guid : null,
    nickname: m.nickname || '',
    isMe: !!Number(m.is_current_login || 0),
  };
}

function parseTeam(node) {
  const info = merge(node[0]);
  const extra = merge(node.slice(1));
  const st = extra.team_standings || {};
  const ot = st.outcome_totals || {};
  const mgr = parseManager(info);
  return {
    teamKey: info.team_key,
    name: info.name,
    managerId: mgr.guid || `nick:${mgr.nickname}`,
    nickname: mgr.nickname,
    isMe: mgr.isMe || !!info.is_owned_by_current_login,
    rank: Number(st.rank) || null,
    seed: Number(st.playoff_seed) || null,
    wins: Number(ot.wins) || 0,
    losses: Number(ot.losses) || 0,
    ties: Number(ot.ties) || 0,
    moves: Number(info.number_of_moves) || 0,
    trades: Number(info.number_of_trades) || 0,
  };
}

async function leagueMeta(req, res, lk) {
  const data = await yget(req, res, `league/${lk}`);
  return merge(data.fantasy_content.league);
}

// Current league + every prior season it was renewed from.
export async function historySeasons(req, res) {
  const ctx = await myContext(req, res);
  const seasons = [];
  let lk = ctx.leagueKey;
  const seen = new Set();
  while (lk && !seen.has(lk) && seasons.length < 12) {
    seen.add(lk);
    let meta;
    try { meta = await leagueMeta(req, res, lk); } catch { break; } // no access to that season
    seasons.push({
      leagueKey: lk,
      season: Number(meta.season),
      name: meta.name,
      numTeams: Number(meta.num_teams),
      isFinished: !!Number(meta.is_finished || 0),
      draftStatus: meta.draft_status,
      current: lk === ctx.leagueKey,
    });
    lk = renewToKey(meta.renew);
  }

  const teamsData = await yget(req, res, `league/${ctx.leagueKey}/teams`);
  const currentTeams = each(merge(teamsData.fantasy_content.league).teams, 'team').map(parseTeam);
  return { league: ctx.leagueName, current: ctx.leagueKey, seasons, currentTeams };
}

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  return out;
}

export async function historySeason(req, res) {
  const lk = req.params.leagueKey;
  if (!LEAGUE_KEY.test(lk)) throw Object.assign(new Error('Bad league key'), { status: 400 });

  const [meta, standingsData, draftData] = await Promise.all([
    leagueMeta(req, res, lk),
    yget(req, res, `league/${lk}/standings`),
    yget(req, res, `league/${lk}/draftresults`),
  ]);

  const standings = merge(merge(standingsData.fantasy_content.league).standings);
  const teams = each(standings.teams, 'team').map(parseTeam);

  const picks = each(merge(draftData.fantasy_content.league).draft_results, 'draft_result')
    .filter(d => d.player_key)
    .map(d => ({ pick: Number(d.pick), round: Number(d.round), teamKey: d.team_key, playerKey: d.player_key }));

  // Drafted players: that season's stats + Yahoo's average draft position
  const keyBatches = [];
  for (let i = 0; i < picks.length; i += 25) keyBatches.push(picks.slice(i, i + 25).map(p => p.playerKey));
  const playerInfo = new Map();
  await inBatches(keyBatches, 3, async keys => {
    const [statsData, adpData] = await Promise.all([
      yget(req, res, `league/${lk}/players;player_keys=${keys.join(',')}/stats;type=season`),
      yget(req, res, `league/${lk}/players;player_keys=${keys.join(',')}/draft_analysis`).catch(() => null),
    ]);
    for (const node of each(merge(statsData.fantasy_content.league).players, 'player')) {
      const p = parsePlayer(node);
      playerInfo.set(p.key, { name: p.name, team: p.team, pos: p.pos.filter(x => ['PG', 'SG', 'SF', 'PF', 'C'].includes(x)), gp: Number(p.stats['0']) || null, ...yahooLine(p.stats) });
    }
    if (adpData) {
      for (const node of each(merge(adpData.fantasy_content.league).players, 'player')) {
        const info = merge(node[0]);
        const da = merge(merge(node.slice(1)).draft_analysis);
        const adp = Number(da.average_pick);
        if (playerInfo.has(info.player_key) && Number.isFinite(adp) && adp > 0) playerInfo.get(info.player_key).adp = adp;
      }
    }
  });
  const draft = picks.map(p => ({ ...p, ...(playerInfo.get(p.playerKey) || { name: p.playerKey }) }));

  // Weekly category winners
  const endWeek = Number(meta.end_week) || Number(meta.current_week) || 0;
  const startWeek = Number(meta.start_week) || 1;
  const lastWeek = meta.is_finished ? endWeek : Math.min(endWeek, Number(meta.current_week) - 1);
  const weeksList = [];
  for (let w = startWeek; w <= lastWeek; w++) weeksList.push(w);
  const weeks = await inBatches(weeksList, 4, async w => {
    const data = await yget(req, res, `league/${lk}/scoreboard;week=${w}`);
    const sb = merge(merge(data.fantasy_content.league).scoreboard);
    const matchups = each(sb['0']?.matchups || sb.matchups, 'matchup').map(m => {
      const teamKeys = each(merge(m['0'] || m).teams, 'team').map(t => merge(t[0]).team_key);
      const winners = {};
      for (const sw of m.stat_winners || []) {
        const s = sw.stat_winner;
        if (s) winners[s.stat_id] = Number(s.is_tied) ? 'tie' : s.winner_team_key;
      }
      return { teams: teamKeys, winners, isPlayoffs: !!Number(m.is_playoffs || 0), isConsolation: !!Number(m.is_consolation || 0) };
    });
    return { week: w, matchups };
  });

  return {
    leagueKey: lk,
    season: Number(meta.season),
    name: meta.name,
    isFinished: !!Number(meta.is_finished || 0),
    numTeams: Number(meta.num_teams),
    teams,
    draft,
    weeks,
    fetchedAt: new Date().toISOString(),
  };
}
