import { useState, useEffect } from 'react';
import { getLeagues, getRoster, getScheduleWeekly } from '../api/yahoo';
import { extractTeamInfo, extractLeagueData, findInArray, YAHOO_TO_NBA } from '../api/helpers';
import PageHeader from '../components/PageHeader';

// All 30 NBA teams
const ALL_NBA_TEAMS = [
  'ATL','BOS','BKN','CHA','CHI','CLE','DAL','DEN','DET','GSW',
  'HOU','IND','LAC','LAL','MEM','MIA','MIL','MIN','NOP','NYK',
  'OKC','ORL','PHI','PHX','POR','SAC','SAS','TOR','UTA','WAS',
];

export default function ScheduleStrength() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [showMyOnly, setShowMyOnly] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [leagueRes, scheduleRes] = await Promise.all([
        getLeagues(),
        getScheduleWeekly(),
      ]);

      const { teamKey, leagueId } = extractTeamInfo(leagueRes.data);
      const rosterRes = await getRoster(leagueId, teamKey);

      const myTeams = extractMyNbaTeams(rosterRes.data);
      const weeks = scheduleRes.data.weeks;

      setData({ weeks, myTeams });
    } catch (err) {
      console.error('Schedule error:', err);
      setError(err.message || 'Failed to load schedule');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  if (loading) {
    return (
      <div>
        <PageHeader title="SCHEDULE STRENGTH" subtitle="Loading..." />
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
        <PageHeader title="SCHEDULE STRENGTH" />
        <div className="error-state">
          <h3>Failed to Load</h3>
          <p style={{ marginBottom: 16 }}>{error}</p>
          <button className="btn btn-primary" onClick={fetchData}>Retry</button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { weeks, myTeams } = data;
  const weekKeys = Object.keys(weeks).sort();
  const teamsToShow = showMyOnly
    ? ALL_NBA_TEAMS.filter(t => myTeams.has(t))
    : ALL_NBA_TEAMS;

  // Sort by total games descending
  const sorted = [...teamsToShow].sort((a, b) => {
    const totalA = weekKeys.reduce((s, wk) => s + (weeks[wk].teams[a] || 0), 0);
    const totalB = weekKeys.reduce((s, wk) => s + (weeks[wk].teams[b] || 0), 0);
    return totalB - totalA;
  });

  return (
    <div>
      <PageHeader title="SCHEDULE STRENGTH" subtitle="NBA games per team — next 4 weeks" />

      <div style={{ marginBottom: 20, display: 'flex', gap: 8 }}>
        <button
          className={`btn ${!showMyOnly ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setShowMyOnly(false)}
        >
          All Teams
        </button>
        <button
          className={`btn ${showMyOnly ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setShowMyOnly(true)}
        >
          My Players' Teams
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Team</th>
              {weekKeys.map(wk => (
                <th key={wk}>
                  <div>{wk.replace('week', 'Wk ')}</div>
                  <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 400 }}>
                    {weeks[wk].start.substring(5)} — {weeks[wk].end.substring(5)}
                  </div>
                </th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(team => {
              const isMine = myTeams.has(team);
              const total = weekKeys.reduce((s, wk) => s + (weeks[wk].teams[team] || 0), 0);
              return (
                <tr key={team} style={isMine ? { background: 'rgba(249, 115, 22, 0.05)' } : undefined}>
                  <td style={{ fontWeight: 500 }}>
                    <span className="stat">{team}</span>
                    {isMine && <span style={styles.myBadge}>MY TEAM</span>}
                  </td>
                  {weekKeys.map(wk => {
                    const g = weeks[wk].teams[team] || 0;
                    return (
                      <td key={wk} className="stat" style={{ textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 3,
                          background: getGameCountColor(g),
                          color: '#fff',
                          fontWeight: 600,
                          fontSize: 13,
                          minWidth: 28,
                        }}>
                          {g}
                        </span>
                      </td>
                    );
                  })}
                  <td className="stat" style={{ textAlign: 'center', fontWeight: 600 }}>
                    {total}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getGameCountColor(count) {
  if (count >= 4) return 'rgba(34, 197, 94, 0.7)';
  if (count === 3) return 'rgba(59, 130, 246, 0.5)';
  if (count === 2) return 'rgba(245, 158, 11, 0.5)';
  if (count === 1) return 'rgba(239, 68, 68, 0.5)';
  return 'rgba(75, 85, 99, 0.3)';
}

function extractMyNbaTeams(rosterData) {
  const teams = new Set();
  if (!rosterData) return teams;
  try {
    const fc = rosterData.fantasy_content;
    const team = fc.team;
    const rosterWrapper = Array.isArray(team) ? team[1]?.roster : team?.roster;
    const roster = rosterWrapper?.players ? rosterWrapper : rosterWrapper?.['0'];
    const playersList = roster?.players;
    if (!playersList) return teams;

    const count = playersList.count || 0;
    for (let i = 0; i < count; i++) {
      const p = playersList[i]?.player;
      if (!p) continue;
      const info = p[0];
      const abbr = (findInArray(info, 'editorial_team_abbr') || '').toUpperCase();
      const nba = YAHOO_TO_NBA[abbr] || abbr;
      if (nba) teams.add(nba);
    }
  } catch (e) {}
  return teams;
}

const styles = {
  myBadge: {
    fontFamily: "'DM Mono', monospace",
    fontSize: 9,
    color: 'var(--accent)',
    marginLeft: 8,
    padding: '1px 5px',
    borderRadius: 2,
    border: '1px solid var(--accent)',
  },
};
