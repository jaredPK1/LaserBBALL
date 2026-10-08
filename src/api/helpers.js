// Shared helpers used across multiple pages

export function findInArray(arr, key) {
  if (!Array.isArray(arr)) return arr?.[key];
  for (const item of arr) {
    if (item && typeof item === 'object' && key in item) return item[key];
  }
  return null;
}

export function statusText(s) {
  if (!s) return 'Active';
  const upper = String(s).toUpperCase();
  if (upper === 'INJ' || upper === 'O' || upper === 'OUT' || upper === 'IR') return 'Out';
  if (upper === 'GTD' || upper === 'DTD') return 'GTD';
  if (upper === 'SUSP') return 'Out';
  return s;
}

export function getStatusClass(status) {
  const s = (status || '').toUpperCase();
  if (s === 'OUT' || s === 'INJ' || s === 'IR' || s === 'SUSP') return 'status-out';
  if (s === 'GTD' || s === 'DTD') return 'status-gtd';
  return 'status-active';
}

export function isPlayerOut(statusRaw) {
  if (!statusRaw) return false;
  return ['INJ', 'O', 'OUT', 'IR', 'SUSP'].includes(statusRaw.toUpperCase());
}

export function extractTeamInfo(data) {
  const fc = data.fantasy_content;
  const user = fc.users[0].user;
  const game = user[1].games[0].game;
  const league = game[1].leagues[0].league;
  const leagueInfo = Array.isArray(league) ? league[0] : league;
  const leagueId = leagueInfo.league_id;
  const gameKey = leagueInfo.league_key?.split('.l.')[0];

  const teams = Array.isArray(league) && league[1]?.teams;
  if (teams) {
    for (let i = 0; i < (teams.count || 0); i++) {
      const t = teams[i]?.team;
      if (!t) continue;
      const info = t[0];
      if (Array.isArray(info) && info.some(x => x.is_owned_by_current_login)) {
        const tk = info.find(x => x.team_key)?.team_key;
        const name = info.find(x => x.name)?.name;
        if (tk) return { teamKey: tk, leagueId, teamName: name || 'My Team' };
      }
    }
  }
  return { teamKey: `${gameKey}.l.${leagueId}.t.1`, leagueId, teamName: 'My Team' };
}

export function extractLeagueData(data) {
  const fc = data.fantasy_content;
  const user = fc.users[0].user;
  const game = user[1].games[0].game;
  const league = game[1].leagues[0].league;
  const leagueInfo = Array.isArray(league) ? league[0] : league;
  return {
    currentWeek: parseInt(leagueInfo.current_week),
    leagueId: leagueInfo.league_id,
    leagueName: leagueInfo.name,
  };
}

export function parseRosterPlayers(rosterData) {
  if (!rosterData) return [];
  try {
    const fc = rosterData.fantasy_content;
    const team = fc.team;
    const rosterWrapper = Array.isArray(team) ? team[1]?.roster : team?.roster;
    const roster = rosterWrapper?.players ? rosterWrapper : rosterWrapper?.['0'];
    const playersList = roster?.players;
    if (!playersList) return [];

    const players = [];
    const count = playersList.count || 0;

    for (let i = 0; i < count; i++) {
      const p = playersList[i]?.player;
      if (!p) continue;

      const info = p[0];
      const name = findInArray(info, 'name');
      const playerName = typeof name === 'object' ? name.full : name;
      const teamAbbr = (findInArray(info, 'editorial_team_abbr') || '').toUpperCase();
      const status = findInArray(info, 'status') || '';

      const statsArr = p.find(el => el && el.player_stats)?.player_stats?.stats || [];
      const stats = {};
      statsArr.forEach(s => {
        if (s.stat) stats[s.stat.stat_id] = parseFloat(s.stat.value) || 0;
      });

      players.push({
        playerKey: findInArray(info, 'player_key') || i,
        name: playerName || 'Unknown',
        position: findInArray(info, 'display_position') || '',
        team: teamAbbr,
        status: statusText(status),
        statusRaw: status,
        stats,
      });
    }
    return players;
  } catch (err) {
    console.error('Error parsing roster:', err);
    return [];
  }
}

export function formatStat(val, cat) {
  if (cat === 'FG%' || cat === 'FT%') return val.toFixed(3);
  if (Number.isInteger(val)) return val;
  return val.toFixed(1);
}

export const STAT_MAP = {
  5: 'FG%', 8: 'FT%', 10: '3PTM', 12: 'PTS',
  15: 'REB', 16: 'AST', 17: 'STL', 18: 'BLK', 19: 'TO'
};

export const STAT_IDS = Object.keys(STAT_MAP);

export const YAHOO_TO_NBA = {
  'GS': 'GSW', 'GSW': 'GSW', 'NO': 'NOP', 'NOP': 'NOP', 'NY': 'NYK', 'NYK': 'NYK',
  'PHO': 'PHX', 'PHX': 'PHX', 'SA': 'SAS', 'SAS': 'SAS',
  'ATL': 'ATL', 'BOS': 'BOS', 'BKN': 'BKN', 'CHA': 'CHA', 'CHI': 'CHI',
  'CLE': 'CLE', 'DAL': 'DAL', 'DEN': 'DEN', 'DET': 'DET', 'HOU': 'HOU',
  'IND': 'IND', 'LAC': 'LAC', 'LAL': 'LAL', 'MEM': 'MEM', 'MIA': 'MIA',
  'MIL': 'MIL', 'MIN': 'MIN', 'OKC': 'OKC', 'ORL': 'ORL', 'PHI': 'PHI',
  'POR': 'POR', 'SAC': 'SAC', 'TOR': 'TOR', 'UTA': 'UTA', 'WAS': 'WAS',
};
