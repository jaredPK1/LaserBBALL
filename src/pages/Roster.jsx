import { useState, useEffect } from 'react';
import { getLeagues, getRoster } from '../api/yahoo';
import PageHeader from '../components/PageHeader';
import StatTable from '../components/StatTable';

export default function Roster() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [players, setPlayers] = useState([]);
  const [teamName, setTeamName] = useState('');

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const leagueRes = await getLeagues();
      console.log('Leagues response:', JSON.stringify(leagueRes.data).substring(0, 2000));
      const { teamKey, leagueId, teamName: tn } = extractTeamInfo(leagueRes.data);
      console.log('Extracted team:', { teamKey, leagueId, teamName: tn });
      setTeamName(tn);

      const rosterRes = await getRoster(leagueId, teamKey);
      console.log('Roster response:', JSON.stringify(rosterRes.data).substring(0, 2000));
      const parsed = parseRoster(rosterRes.data);
      console.log('Parsed players:', parsed.length, parsed[0]);
      setPlayers(parsed);
    } catch (err) {
      console.error('Roster fetch error:', err);
      setError(err.response?.data?.details || err.message || 'Failed to load roster');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const columns = [
    { key: 'name', label: 'Player' },
    { key: 'position', label: 'Pos', render: (v) => <span className="pos-badge">{v}</span> },
    { key: 'team', label: 'Team', mono: true },
    {
      key: 'status', label: 'Status',
      render: (v) => {
        const cls = !v || v === 'Active' ? 'status-active' : v === 'GTD' ? 'status-gtd' : 'status-out';
        return <span className={cls}>{v || 'Active'}</span>;
      }
    },
    { key: 'pts', label: 'PTS', mono: true },
    { key: 'reb', label: 'REB', mono: true },
    { key: 'ast', label: 'AST', mono: true },
    { key: 'stl', label: 'STL', mono: true },
    { key: 'blk', label: 'BLK', mono: true },
    { key: 'fgPct', label: 'FG%', mono: true, render: (v) => v != null ? v.toFixed(3) : '-' },
    { key: 'ftPct', label: 'FT%', mono: true, render: (v) => v != null ? v.toFixed(3) : '-' },
    { key: 'threes', label: '3PM', mono: true },
  ];

  if (loading) {
    return (
      <div>
        <PageHeader title="MY ROSTER" subtitle="Loading..." />
        <div className="loading-container">
          {Array.from({ length: 13 }, (_, i) => (
            <div key={i} className="skeleton skeleton-row" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="MY ROSTER" />
        <div className="error-state">
          <h3>Failed to Load Roster</h3>
          <p style={{ marginBottom: 16 }}>{typeof error === 'string' ? error : JSON.stringify(error)}</p>
          <button className="btn btn-primary" onClick={fetchData}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="MY ROSTER" subtitle={teamName} />
      {players.length === 0 ? (
        <div className="empty-state"><h3>No players found</h3></div>
      ) : (
        <StatTable columns={columns} data={players} defaultSort="pts" />
      )}
    </div>
  );
}

function extractTeamInfo(data) {
  try {
    const fc = data.fantasy_content;
    const user = fc.users[0].user;
    const game = user[1].games[0].game;
    const league = game[1].leagues[0].league;
    const leagueInfo = Array.isArray(league) ? league[0] : league;
    const leagueId = leagueInfo.league_id;
    const gameKey = leagueInfo.league_key?.split('.l.')[0];

    // Try to find user's team
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
  } catch (err) {
    console.error('Error extracting team info:', err);
    throw new Error('Could not find team info');
  }
}

function parseRoster(data) {
  try {
    const fc = data.fantasy_content;
    const team = fc.team;
    const rosterWrapper = team[1]?.roster;
    // Yahoo nests roster as roster["0"].players or roster.players
    const roster = rosterWrapper?.players ? rosterWrapper : rosterWrapper?.["0"];
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
      const position = findInArray(info, 'display_position') || findInArray(info, 'primary_position') || '';
      const teamAbbr = findInArray(info, 'editorial_team_abbr') || '';
      const status = findInArray(info, 'status') || findInArray(info, 'injury_note') || '';
      const playerKey = findInArray(info, 'player_key') || '';

      // Stats may or may not be present
      const statsArr = p.find(el => el && el.player_stats)?.player_stats?.stats || [];
      const stats = {};
      statsArr.forEach(s => {
        if (s.stat) stats[s.stat.stat_id] = parseFloat(s.stat.value) || 0;
      });

      players.push({
        _key: playerKey,
        name: playerName || 'Unknown',
        position,
        team: teamAbbr.toUpperCase(),
        status: statusText(status),
        pts: stats[12] || 0,
        reb: stats[15] || 0,
        ast: stats[16] || 0,
        stl: stats[17] || 0,
        blk: stats[18] || 0,
        fgPct: stats[5] || null,
        ftPct: stats[8] || null,
        threes: stats[10] || 0,
      });
    }

    return players;
  } catch (err) {
    console.error('Error parsing roster:', err);
    return [];
  }
}

function statusText(s) {
  if (!s) return 'Active';
  const upper = String(s).toUpperCase();
  if (upper === 'INJ' || upper === 'O' || upper === 'OUT' || upper === 'IR') return 'Out';
  if (upper === 'GTD' || upper === 'DTD') return 'GTD';
  if (upper === 'SUSP') return 'Out';
  return s;
}

function findInArray(arr, key) {
  if (!Array.isArray(arr)) return arr?.[key];
  for (const item of arr) {
    if (item && typeof item === 'object' && key in item) return item[key];
  }
  return null;
}
