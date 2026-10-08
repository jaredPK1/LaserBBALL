import { useState, useEffect } from 'react';
import { getLeagues, getMatchup } from '../api/yahoo';
import PageHeader from '../components/PageHeader';
import CatBar from '../components/CatBar';

const CATEGORIES = ['FG%', 'FT%', '3PTM', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO'];

export default function Matchup() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [matchupData, setMatchupData] = useState(null);
  const [week, setWeek] = useState(null);
  const [currentWeek, setCurrentWeek] = useState(null);
  const [teamKey, setTeamKey] = useState(null);
  const [leagueId, setLeagueId] = useState(null);

  const fetchData = async (w) => {
    setLoading(true);
    setError(null);
    try {
      const leagueRes = await getLeagues();
      const fc = leagueRes.data.fantasy_content;
      const users = fc.users;
      const user = users[0].user;
      const games = user[1].games;
      const game = games[0].game;
      const leagues = game[1].leagues;
      const league = leagues[0].league;
      const leagueInfo = Array.isArray(league) ? league[0] : league;
      const lid = leagueInfo.league_id;
      const cw = parseInt(leagueInfo.current_week);
      setLeagueId(lid);
      setCurrentWeek(cw);

      const teams = league[1]?.teams || leagues[0].league[1]?.teams;
      let tk = null;
      if (teams) {
        const teamCount = teams.count;
        for (let i = 0; i < teamCount; i++) {
          const team = teams[i]?.team;
          if (team) {
            const teamInfo = team[0];
            const isMyTeam = teamInfo.find ? teamInfo.find(t => t.is_owned_by_current_login) : false;
            if (isMyTeam) {
              const keyEntry = teamInfo.find ? teamInfo.find(t => t.team_key) : null;
              tk = keyEntry?.team_key || teamInfo[0]?.team_key;
              break;
            }
          }
        }
      }

      if (!tk) {
        // Fallback: construct team key from league info
        const gameKey = leagueInfo.league_key?.split('.l.')[0];
        // Try team key format: gameKey.l.leagueId.t.1 (assuming first team or user's team)
        // We need to find the user's team - let's use a different approach
        tk = `${gameKey}.l.${lid}.t.1`;
      }

      setTeamKey(tk);
      const weekToFetch = w || cw;
      if (!w) setWeek(cw);

      const matchupRes = await getMatchup(lid, tk, weekToFetch);
      setMatchupData(parseMatchup(matchupRes.data));
    } catch (err) {
      console.error('Matchup fetch error:', err);
      setError(err.response?.data?.details || err.message || 'Failed to load matchup');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const changeWeek = (delta) => {
    const newWeek = (week || currentWeek) + delta;
    if (newWeek < 1 || newWeek > 24) return;
    setWeek(newWeek);
    if (teamKey && leagueId) {
      setLoading(true);
      setError(null);
      getMatchup(leagueId, teamKey, newWeek)
        .then(res => setMatchupData(parseMatchup(res.data)))
        .catch(err => setError(err.message))
        .finally(() => setLoading(false));
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="MATCHUP" subtitle="Loading..." />
        <div className="loading-container">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="skeleton skeleton-row" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="MATCHUP" />
        <div className="error-state">
          <h3>Failed to Load Matchup</h3>
          <p style={{ marginBottom: 16 }}>{typeof error === 'string' ? error : JSON.stringify(error)}</p>
          <button className="btn btn-primary" onClick={() => fetchData(week)}>Retry</button>
        </div>
      </div>
    );
  }

  if (!matchupData) {
    return (
      <div>
        <PageHeader title="MATCHUP" />
        <div className="empty-state"><h3>No matchup data available</h3></div>
      </div>
    );
  }

  const { myTeam, opponent, categories, wins, losses, ties } = matchupData;

  return (
    <div>
      <PageHeader title="MATCHUP" subtitle={`Week ${week || currentWeek}`} />

      <div style={styles.weekNav}>
        <button className="btn btn-ghost" onClick={() => changeWeek(-1)}>Prev</button>
        <span className="stat" style={{ fontSize: 16 }}>Week {week || currentWeek}</span>
        <button className="btn btn-ghost" onClick={() => changeWeek(1)}>Next</button>
      </div>

      <div style={styles.scoreCard}>
        <div style={styles.teamSide}>
          <div style={styles.teamName}>{myTeam}</div>
        </div>
        <div style={styles.score}>
          <span style={{ color: 'var(--green)' }}>{wins}</span>
          {' - '}
          <span style={{ color: 'var(--red)' }}>{losses}</span>
          {ties > 0 && <span style={{ color: 'var(--muted)' }}> - {ties}</span>}
        </div>
        <div style={{ ...styles.teamSide, textAlign: 'right' }}>
          <div style={styles.teamName}>{opponent}</div>
        </div>
      </div>

      <div style={styles.catList}>
        {categories.map((cat) => (
          <CatBar
            key={cat.name}
            category={cat.name}
            myValue={cat.myValue}
            theirValue={cat.theirValue}
          />
        ))}
      </div>
    </div>
  );
}

function parseMatchup(data) {
  try {
    const fc = data.fantasy_content;
    const team = fc.team;
    const teamInfo = team[0];
    const myTeam = findInArray(teamInfo, 'name') || 'My Team';

    const matchups = team[1]?.matchups;
    if (!matchups) return null;

    const matchup = matchups[0]?.matchup;
    if (!matchup) return null;

    const teams = matchup.teams || matchup[0]?.teams;
    if (!teams) return null;

    let myStats = {};
    let theirStats = {};
    let opponentName = 'Opponent';

    // Parse teams from matchup
    for (let i = 0; i < (teams.count || 2); i++) {
      const t = teams[i]?.team;
      if (!t) continue;

      const info = t[0];
      const name = findInArray(info, 'name') || `Team ${i + 1}`;
      const isOwned = info.some ? info.some(x => x.is_owned_by_current_login) : false;

      const statsWrapper = t[1]?.team_stats?.stats || [];
      const stats = {};
      statsWrapper.forEach(s => {
        if (s.stat) {
          stats[s.stat.stat_id] = parseFloat(s.stat.value) || 0;
        }
      });

      if (isOwned || i === 0) {
        if (i === 0) {
          myStats = stats;
          // myTeam name already set from top-level
        }
      }
      if (!isOwned && i > 0) {
        opponentName = name;
        theirStats = stats;
      }
      if (isOwned) {
        myStats = stats;
      } else {
        opponentName = name;
        theirStats = stats;
      }
    }

    // Map stat IDs to category names (Yahoo Fantasy Basketball)
    const statMap = {
      5: 'FG%', 8: 'FT%', 10: '3PTM', 12: 'PTS',
      15: 'REB', 16: 'AST', 17: 'STL', 18: 'BLK', 19: 'TO'
    };

    const categories = [];
    let wins = 0, losses = 0, ties = 0;

    for (const [id, name] of Object.entries(statMap)) {
      const myVal = myStats[id] || 0;
      const theirVal = theirStats[id] || 0;
      categories.push({ name, myValue: myVal, theirValue: theirVal });

      const isTO = name === 'TO';
      if (myVal === theirVal) ties++;
      else if (isTO ? myVal < theirVal : myVal > theirVal) wins++;
      else losses++;
    }

    return { myTeam, opponent: opponentName, categories, wins, losses, ties };
  } catch (err) {
    console.error('Error parsing matchup:', err, JSON.stringify(data).substring(0, 500));
    return null;
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
  weekNav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    marginBottom: 24,
  },
  scoreCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '24px 32px',
    marginBottom: 32,
  },
  teamSide: {
    flex: 1,
  },
  teamName: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 22,
    letterSpacing: '0.03em',
  },
  score: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: 48,
    letterSpacing: '0.05em',
    textAlign: 'center',
    minWidth: 120,
  },
  catList: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '16px 24px',
  },
};
