import { useState, useEffect } from 'react';
import { getLeagues, getRoster, getMatchup, getTodayGames } from '../api/yahoo';
import { extractTeamInfo, extractLeagueData, findInArray, statusText, getStatusClass, isPlayerOut, YAHOO_TO_NBA } from '../api/helpers';
import PageHeader from '../components/PageHeader';

export default function Today() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [leagueRes, todayRes] = await Promise.all([
        getLeagues(),
        getTodayGames(),
      ]);

      const { teamKey, leagueId, teamName } = extractTeamInfo(leagueRes.data);
      const { currentWeek } = extractLeagueData(leagueRes.data);
      const teamsPlaying = new Set(todayRes.data.teamsPlaying || []);
      const todayGames = todayRes.data.games || [];

      // Fetch my roster and matchup to get opponent key
      const matchupRes = await getMatchup(leagueId, teamKey, currentWeek);
      const oppKey = extractOpponentKey(matchupRes.data);

      const rosterPromises = [
        getRoster(leagueId, teamKey),
        oppKey ? getRoster(leagueId, oppKey) : Promise.resolve(null),
      ];
      const [myRosterRes, oppRosterRes] = await Promise.all(rosterPromises);

      const myPlayers = parsePlayersWithSchedule(myRosterRes.data, teamsPlaying);
      const oppPlayers = oppRosterRes ? parsePlayersWithSchedule(oppRosterRes.data, teamsPlaying) : [];
      const oppName = extractOpponentName(matchupRes.data);

      const myPlaying = myPlayers.filter(p => p.playsToday && !isPlayerOut(p.statusRaw));
      const myNotPlaying = myPlayers.filter(p => !p.playsToday || isPlayerOut(p.statusRaw));
      const oppPlaying = oppPlayers.filter(p => p.playsToday && !isPlayerOut(p.statusRaw));
      const oppNotPlaying = oppPlayers.filter(p => !p.playsToday || isPlayerOut(p.statusRaw));

      setData({
        today: todayRes.data.today,
        teamName, oppName, todayGames,
        myPlaying, myNotPlaying, oppPlaying, oppNotPlaying,
        myPlayingCount: myPlaying.length,
        oppPlayingCount: oppPlaying.length,
      });
    } catch (err) {
      console.error('Today fetch error:', err);
      setError(err.response?.data?.details || err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  if (loading) {
    return (
      <div>
        <PageHeader title="TODAY" subtitle="Loading today's games..." />
        <div className="loading-container">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skeleton skeleton-row" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="TODAY" />
        <div className="error-state">
          <h3>Failed to Load</h3>
          <p style={{ marginBottom: 16 }}>{typeof error === 'string' ? error : JSON.stringify(error)}</p>
          <button className="btn btn-primary" onClick={fetchData}>Retry</button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { teamName, oppName, myPlaying, myNotPlaying, oppPlaying, oppNotPlaying, myPlayingCount, oppPlayingCount, todayGames } = data;
  const advantage = myPlayingCount - oppPlayingCount;

  return (
    <div>
      <PageHeader title="TODAY" subtitle={data.today} />

      {/* Games advantage card */}
      <div style={styles.advantageCard}>
        <div style={styles.advSide}>
          <div style={styles.advCount} className="stat">{myPlayingCount}</div>
          <div style={{ color: 'var(--text2)', fontSize: 13 }}>{teamName}</div>
          <div className="stat" style={{ fontSize: 11, color: 'var(--text2)' }}>players active</div>
        </div>
        <div style={styles.advMiddle}>
          <div style={{
            ...styles.advBadge,
            background: advantage > 0 ? 'rgba(34,197,94,0.15)' : advantage < 0 ? 'rgba(239,68,68,0.15)' : 'rgba(75,85,99,0.15)',
            color: advantage > 0 ? 'var(--green)' : advantage < 0 ? 'var(--red)' : 'var(--muted)',
          }}>
            {advantage > 0 ? `+${advantage} ADVANTAGE` : advantage < 0 ? `${advantage} DISADVANTAGE` : 'EVEN'}
          </div>
          <div className="stat" style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
            {todayGames.length} NBA games today
          </div>
        </div>
        <div style={{ ...styles.advSide, textAlign: 'right' }}>
          <div style={styles.advCount} className="stat">{oppPlayingCount}</div>
          <div style={{ color: 'var(--text2)', fontSize: 13 }}>{oppName}</div>
          <div className="stat" style={{ fontSize: 11, color: 'var(--text2)' }}>players active</div>
        </div>
      </div>

      {/* Your players playing today */}
      <h2 style={styles.sectionTitle}>
        YOUR PLAYERS — ACTIVE TODAY
        <span className="stat" style={{ fontSize: 14, color: 'var(--green)', marginLeft: 12 }}>
          {myPlaying.length}
        </span>
      </h2>
      {myPlaying.length === 0 ? (
        <div style={styles.emptyRow}>None of your players have games today</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Player</th><th>Pos</th><th>Team</th><th>Matchup</th><th>Status</th></tr></thead>
            <tbody>
              {myPlaying.map(p => (
                <tr key={p.playerKey}>
                  <td style={{ fontWeight: 500 }}>{p.name}</td>
                  <td><span className="pos-badge">{p.position}</span></td>
                  <td className="stat">{p.team}</td>
                  <td className="stat">{p.gameMatchup}</td>
                  <td><span className={getStatusClass(p.status)}>{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Your players NOT playing today */}
      <h2 style={styles.sectionTitle}>
        YOUR PLAYERS — OFF TODAY
        <span className="stat" style={{ fontSize: 14, color: 'var(--muted)', marginLeft: 12 }}>
          {myNotPlaying.length}
        </span>
      </h2>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Player</th><th>Pos</th><th>Team</th><th>Reason</th></tr></thead>
          <tbody>
            {myNotPlaying.map(p => (
              <tr key={p.playerKey} style={{ opacity: 0.6 }}>
                <td style={{ fontWeight: 500 }}>{p.name}</td>
                <td><span className="pos-badge">{p.position}</span></td>
                <td className="stat">{p.team}</td>
                <td className="stat" style={{ fontSize: 12 }}>
                  {isPlayerOut(p.statusRaw)
                    ? <span className="status-out">{p.status}</span>
                    : 'No game scheduled'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Opponent playing today */}
      <h2 style={styles.sectionTitle}>
        OPPONENT — ACTIVE TODAY
        <span className="stat" style={{ fontSize: 14, color: 'var(--red)', marginLeft: 12 }}>
          {oppPlaying.length}
        </span>
      </h2>
      {oppPlaying.length === 0 ? (
        <div style={styles.emptyRow}>None of opponent's players have games today</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Player</th><th>Pos</th><th>Team</th><th>Matchup</th><th>Status</th></tr></thead>
            <tbody>
              {oppPlaying.map(p => (
                <tr key={p.playerKey}>
                  <td style={{ fontWeight: 500 }}>{p.name}</td>
                  <td><span className="pos-badge">{p.position}</span></td>
                  <td className="stat">{p.team}</td>
                  <td className="stat">{p.gameMatchup}</td>
                  <td><span className={getStatusClass(p.status)}>{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Opponent NOT playing */}
      <h2 style={styles.sectionTitle}>
        OPPONENT — OFF TODAY
        <span className="stat" style={{ fontSize: 14, color: 'var(--muted)', marginLeft: 12 }}>
          {oppNotPlaying.length}
        </span>
      </h2>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Player</th><th>Pos</th><th>Team</th><th>Reason</th></tr></thead>
          <tbody>
            {oppNotPlaying.map(p => (
              <tr key={p.playerKey} style={{ opacity: 0.6 }}>
                <td style={{ fontWeight: 500 }}>{p.name}</td>
                <td><span className="pos-badge">{p.position}</span></td>
                <td className="stat">{p.team}</td>
                <td className="stat" style={{ fontSize: 12 }}>
                  {isPlayerOut(p.statusRaw)
                    ? <span className="status-out">{p.status}</span>
                    : 'No game scheduled'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function extractOpponentKey(data) {
  try {
    const team = data.fantasy_content.team;
    const matchups = (Array.isArray(team) ? team : [team])[1]?.matchups;
    const matchup = matchups?.[0]?.matchup;
    const teams = matchup?.teams || matchup?.[0]?.teams;
    if (!teams) return null;
    for (let i = 0; i < (teams.count || 2); i++) {
      const t = teams[i]?.team;
      if (!t) continue;
      const info = t[0];
      const isOwned = Array.isArray(info) ? info.some(x => x.is_owned_by_current_login) : false;
      if (!isOwned) {
        return Array.isArray(info) ? info.find(x => x.team_key)?.team_key : info?.team_key;
      }
    }
  } catch (e) { console.error('Error extracting opponent key:', e); }
  return null;
}

function extractOpponentName(data) {
  try {
    const team = data.fantasy_content.team;
    const matchups = (Array.isArray(team) ? team : [team])[1]?.matchups;
    const matchup = matchups?.[0]?.matchup;
    const teams = matchup?.teams || matchup?.[0]?.teams;
    if (!teams) return 'Opponent';
    for (let i = 0; i < (teams.count || 2); i++) {
      const t = teams[i]?.team;
      if (!t) continue;
      const info = t[0];
      const isOwned = Array.isArray(info) ? info.some(x => x.is_owned_by_current_login) : false;
      if (!isOwned) return findInArray(info, 'name') || 'Opponent';
    }
  } catch (e) {}
  return 'Opponent';
}

function parsePlayersWithSchedule(data, teamsPlaying) {
  if (!data) return [];
  try {
    const fc = data.fantasy_content;
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
      const nbaTeam = YAHOO_TO_NBA[teamAbbr] || teamAbbr;
      const playsToday = teamsPlaying.has(nbaTeam);

      // Find their matchup today
      let gameMatchup = '';
      if (playsToday) {
        // We don't have individual game times from our data, but we can show vs who
        gameMatchup = nbaTeam; // Will be enhanced below
      }

      players.push({
        playerKey: findInArray(info, 'player_key') || i,
        name: playerName || 'Unknown',
        position: findInArray(info, 'display_position') || '',
        team: teamAbbr,
        nbaTeam,
        status: statusText(status),
        statusRaw: status,
        playsToday,
        gameMatchup,
      });
    }

    // Enhance game matchups from todayGames
    return players;
  } catch (err) {
    console.error('Error parsing players:', err);
    return [];
  }
}

const styles = {
  advantageCard: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '24px 32px', marginBottom: 32,
  },
  advSide: { flex: 1 },
  advCount: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: 48, letterSpacing: '0.05em',
  },
  advMiddle: { textAlign: 'center', padding: '0 24px' },
  advBadge: {
    fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 700,
    padding: '6px 16px', borderRadius: 4,
  },
  sectionTitle: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: 24,
    marginTop: 32, marginBottom: 16, color: 'var(--text)',
    display: 'flex', alignItems: 'center',
  },
  emptyRow: {
    padding: '20px', background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 8, color: 'var(--text2)', textAlign: 'center',
  },
};
