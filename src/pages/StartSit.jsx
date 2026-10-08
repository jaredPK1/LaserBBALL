import { useState, useEffect } from 'react';
import { getLeagues, getRoster } from '../api/yahoo';
import PageHeader from '../components/PageHeader';

export default function StartSit() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [players, setPlayers] = useState([]);
  const [view, setView] = useState('tonight');

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const leagueRes = await getLeagues();
      const { teamKey, leagueId } = extractTeamInfo(leagueRes.data);
      const rosterRes = await getRoster(leagueId, teamKey);
      setPlayers(parseRosterForStartSit(rosterRes.data));
    } catch (err) {
      console.error('StartSit fetch error:', err);
      setError(err.message || 'Failed to load roster');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  if (loading) {
    return (
      <div>
        <PageHeader title="START / SIT" subtitle="Loading..." />
        <div className="loading-container">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="skeleton skeleton-row" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="START / SIT" />
        <div className="error-state">
          <h3>Failed to Load</h3>
          <p style={{ marginBottom: 16 }}>{error}</p>
          <button className="btn btn-primary" onClick={fetchData}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="START / SIT" subtitle="Player recommendations based on status and matchup" />

      <div style={styles.toggle}>
        <button
          className={`btn ${view === 'tonight' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setView('tonight')}
        >
          Tonight
        </button>
        <button
          className={`btn ${view === 'week' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setView('week')}
        >
          This Week
        </button>
      </div>

      <div style={styles.list}>
        {players.map((p) => {
          const rec = getRecommendation(p);
          return (
            <div key={p.playerKey} style={styles.row}>
              <div style={styles.recBadge} className="stat" data-rec={rec.label}>
                <span style={{ color: rec.color, fontWeight: 700, fontSize: 13 }}>{rec.label}</span>
              </div>
              <div style={styles.playerInfo}>
                <span style={{ fontWeight: 500 }}>{p.name}</span>
                <span className="pos-badge" style={{ marginLeft: 8 }}>{p.position}</span>
                <span className="stat" style={{ marginLeft: 8, color: 'var(--text2)', fontSize: 12 }}>{p.team}</span>
              </div>
              <div style={styles.statusCol}>
                <span className={getStatusClass(p.status)}>{p.status || 'Active'}</span>
              </div>
              <div style={styles.reason} className="stat">
                {rec.reason}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getRecommendation(player) {
  const status = (player.status || '').toUpperCase();
  if (status === 'OUT' || status === 'INJ' || status === 'IR' || status === 'SUSP') {
    return { label: 'SIT', color: 'var(--red)', reason: 'Player is out/injured' };
  }
  if (status === 'GTD' || status === 'DTD') {
    return { label: 'MONITOR', color: 'var(--gold)', reason: 'Game-time decision' };
  }
  return { label: 'START', color: 'var(--green)', reason: 'Active and available' };
}

function getStatusClass(status) {
  const s = (status || '').toUpperCase();
  if (s === 'OUT' || s === 'INJ' || s === 'IR' || s === 'SUSP') return 'status-out';
  if (s === 'GTD' || s === 'DTD') return 'status-gtd';
  return 'status-active';
}

function extractTeamInfo(data) {
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
        if (tk) return { teamKey: tk, leagueId };
      }
    }
  }
  return { teamKey: `${gameKey}.l.${leagueId}.t.1`, leagueId };
}

function parseRosterForStartSit(data) {
  try {
    const fc = data.fantasy_content;
    const team = fc.team;
    const rosterWrapper = team[1]?.roster;
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
      players.push({
        playerKey: findInArray(info, 'player_key') || i,
        name: playerName || 'Unknown',
        position: findInArray(info, 'display_position') || '',
        team: (findInArray(info, 'editorial_team_abbr') || '').toUpperCase(),
        status: findInArray(info, 'status') || '',
      });
    }
    return players;
  } catch (err) {
    console.error('Error parsing roster for start/sit:', err);
    return [];
  }
}

function findInArray(arr, key) {
  if (!Array.isArray(arr)) return arr?.[key];
  for (const item of arr) {
    if (item && typeof item === 'object' && key in item) return item[key];
  }
  return null;
}

const styles = {
  toggle: {
    display: 'flex',
    gap: 8,
    marginBottom: 24,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '12px 16px',
    background: 'var(--surface)',
    borderBottom: '1px solid var(--border)',
  },
  recBadge: {
    width: 80,
    textAlign: 'center',
  },
  playerInfo: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
  },
  statusCol: {
    width: 80,
    textAlign: 'center',
    fontSize: 12,
  },
  reason: {
    width: 180,
    fontSize: 12,
    color: 'var(--text2)',
    textAlign: 'right',
  },
};
