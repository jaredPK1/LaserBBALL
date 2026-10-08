import { useState, useEffect } from 'react';
import { getLeagues, getWaivers, getMatchup, getScheduleRemaining } from '../api/yahoo';
import { extractTeamInfo, extractLeagueData, findInArray, YAHOO_TO_NBA, STAT_MAP } from '../api/helpers';
import PageHeader from '../components/PageHeader';

const POSITIONS = ['ALL', 'PG', 'SG', 'SF', 'PF', 'C'];

export default function WaiverWire() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [players, setPlayers] = useState([]);
  const [posFilter, setPosFilter] = useState('ALL');
  const [weakCats, setWeakCats] = useState([]);
  const [catFilter, setCatFilter] = useState('ALL');
  const [schedule, setSchedule] = useState({});

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [leagueRes, scheduleRes] = await Promise.all([
        getLeagues(),
        getScheduleRemaining(),
      ]);

      const { teamKey, leagueId } = extractTeamInfo(leagueRes.data);
      const { currentWeek } = extractLeagueData(leagueRes.data);
      const remaining = scheduleRes.data.remaining || {};
      setSchedule(remaining);

      // Fetch matchup to find weak categories
      const [waiverRes, matchupRes] = await Promise.all([
        getWaivers(leagueId),
        getMatchup(leagueId, teamKey, currentWeek),
      ]);

      const weak = findWeakCategories(matchupRes.data);
      setWeakCats(weak);
      setPlayers(parseWaivers(waiverRes.data, weak, remaining));
    } catch (err) {
      console.error('Waiver fetch error:', err);
      setError(err.message || 'Failed to load waivers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  let filtered = players;
  if (posFilter !== 'ALL') {
    filtered = filtered.filter(p => p.position.includes(posFilter));
  }
  if (catFilter !== 'ALL') {
    filtered = filtered.filter(p => p.helpsCategories.includes(catFilter));
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="WAIVER WIRE" subtitle="Loading..." />
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
        <PageHeader title="WAIVER WIRE" />
        <div className="error-state">
          <h3>Failed to Load Waivers</h3>
          <p style={{ marginBottom: 16 }}>{error}</p>
          <button className="btn btn-primary" onClick={fetchData}>Retry</button>
        </div>
      </div>
    );
  }

  const catOptions = ['ALL', ...Object.values(STAT_MAP)];

  return (
    <div>
      <PageHeader title="WAIVER WIRE" subtitle="Top available players — ranked by matchup impact" />

      {/* Weak categories alert */}
      {weakCats.length > 0 && (
        <div style={styles.weakAlert}>
          <span className="stat" style={{ color: 'var(--red)', fontSize: 11 }}>LOSING</span>
          <span style={{ fontSize: 13 }}>
            You're behind in: {weakCats.map(c => c.name).join(', ')}
          </span>
          <span className="stat" style={{ color: 'var(--text2)', fontSize: 11 }}>
            — filter by category to find help
          </span>
        </div>
      )}

      {/* Filters */}
      <div style={styles.filterRow}>
        <div style={styles.filters}>
          <span className="stat" style={{ fontSize: 10, color: 'var(--muted)' }}>POSITION</span>
          {POSITIONS.map(pos => (
            <button
              key={pos}
              className={`btn ${posFilter === pos ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '4px 12px', fontSize: 11 }}
              onClick={() => setPosFilter(pos)}
            >
              {pos}
            </button>
          ))}
        </div>
        <div style={styles.filters}>
          <span className="stat" style={{ fontSize: 10, color: 'var(--muted)' }}>CATEGORY</span>
          {catOptions.map(cat => (
            <button
              key={cat}
              className={`btn ${catFilter === cat ? 'btn-primary' : 'btn-ghost'}`}
              style={{
                padding: '4px 10px', fontSize: 11,
                ...(weakCats.some(w => w.name === cat) ? { borderColor: 'var(--red)' } : {}),
              }}
              onClick={() => setCatFilter(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos</th>
              <th>Team</th>
              <th>Games Left</th>
              <th>Owned</th>
              <th>PTS</th>
              <th>REB</th>
              <th>AST</th>
              <th>STL</th>
              <th>BLK</th>
              <th>3PM</th>
              <th>Helps</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={12} style={{ textAlign: 'center', color: 'var(--text2)', padding: 40 }}>No players found</td></tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.playerKey}>
                  <td style={{ fontWeight: 500 }}>{p.name}</td>
                  <td><span className="pos-badge">{p.position}</span></td>
                  <td className="stat">{p.team}</td>
                  <td className="stat" style={{ color: p.gamesLeft >= 3 ? 'var(--green)' : p.gamesLeft >= 2 ? 'var(--text)' : 'var(--muted)' }}>
                    {p.gamesLeft}
                  </td>
                  <td className="stat">{p.ownership}%</td>
                  <td className="stat">{p.pts}</td>
                  <td className="stat">{p.reb}</td>
                  <td className="stat">{p.ast}</td>
                  <td className="stat">{p.stl}</td>
                  <td className="stat">{p.blk}</td>
                  <td className="stat">{p.threes}</td>
                  <td>
                    {p.helpsCategories.length > 0 ? (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {p.helpsCategories.map(cat => (
                          <span key={cat} className="stat" style={{
                            fontSize: 9, padding: '1px 5px', borderRadius: 2,
                            background: weakCats.some(w => w.name === cat) ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.1)',
                            color: weakCats.some(w => w.name === cat) ? 'var(--red)' : 'var(--green)',
                          }}>
                            {cat}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="stat" style={{ color: 'var(--muted)', fontSize: 11 }}>—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function findWeakCategories(matchupData) {
  try {
    const team = matchupData.fantasy_content.team;
    const matchups = (Array.isArray(team) ? team : [team])[1]?.matchups;
    const matchup = matchups?.[0]?.matchup;
    const teams = matchup?.teams || matchup?.[0]?.teams;
    if (!teams) return [];

    let myStats = {}, theirStats = {};
    for (let i = 0; i < (teams.count || 2); i++) {
      const t = teams[i]?.team;
      if (!t) continue;
      const info = t[0];
      const isOwned = Array.isArray(info) ? info.some(x => x.is_owned_by_current_login) : false;
      const statsWrapper = t[1]?.team_stats?.stats || [];
      const stats = {};
      statsWrapper.forEach(s => {
        if (s.stat) stats[s.stat.stat_id] = parseFloat(s.stat.value) || 0;
      });
      if (isOwned) myStats = stats;
      else theirStats = stats;
    }

    const weak = [];
    for (const [id, name] of Object.entries(STAT_MAP)) {
      const my = myStats[id] || 0;
      const their = theirStats[id] || 0;
      const isTO = name === 'TO';
      const losing = isTO ? my > their : my < their;
      if (losing) weak.push({ name, statId: id, diff: Math.abs(my - their) });
    }
    return weak;
  } catch (e) {
    return [];
  }
}

function parseWaivers(data, weakCats, schedule) {
  try {
    const fc = data.fantasy_content;
    const league = fc.league;
    const leagueArr = Array.isArray(league) ? league : [league];
    const playersObj = leagueArr[1]?.players;
    if (!playersObj) return [];

    const weakStatIds = new Set(weakCats.map(c => c.statId));
    const players = [];
    const count = playersObj.count || 0;

    for (let i = 0; i < count; i++) {
      const p = playersObj[i]?.player;
      if (!p) continue;

      const info = p[0];
      const name = findInArray(info, 'name');
      const playerName = typeof name === 'object' ? name.full : name;
      const ownership = findInArray(info, 'percent_owned');
      const ownershipVal = ownership != null ? (typeof ownership === 'object' ? (ownership.value ?? ownership.coverage_value ?? 0) : ownership) : 0;
      const teamAbbr = (findInArray(info, 'editorial_team_abbr') || '').toUpperCase();
      const nbaTeam = YAHOO_TO_NBA[teamAbbr] || teamAbbr;
      const gamesLeft = schedule[nbaTeam] || 0;

      const statsArr = p.find(el => el && el.player_stats)?.player_stats?.stats || [];
      const stats = {};
      statsArr.forEach(s => {
        if (s.stat) stats[s.stat.stat_id] = parseFloat(s.stat.value) || 0;
      });

      // Determine which categories this player helps
      const helpsCategories = [];
      for (const [id, catName] of Object.entries(STAT_MAP)) {
        if (catName === 'TO') continue;
        const val = stats[id] || 0;
        if (catName === 'FG%' || catName === 'FT%') {
          if (val > 0.45) helpsCategories.push(catName);
        } else if (catName === '3PTM' && val >= 1) {
          helpsCategories.push(catName);
        } else if ((catName === 'STL' || catName === 'BLK') && val >= 0.7) {
          helpsCategories.push(catName);
        } else if (catName === 'PTS' && val >= 10) {
          helpsCategories.push(catName);
        } else if (catName === 'REB' && val >= 5) {
          helpsCategories.push(catName);
        } else if (catName === 'AST' && val >= 3) {
          helpsCategories.push(catName);
        }
      }

      players.push({
        playerKey: findInArray(info, 'player_key') || i,
        name: playerName || 'Unknown',
        position: findInArray(info, 'display_position') || '',
        team: teamAbbr,
        gamesLeft,
        ownership: ownershipVal != null ? Math.round(parseFloat(ownershipVal)) : 0,
        pts: stats[12] || 0,
        reb: stats[15] || 0,
        ast: stats[16] || 0,
        stl: stats[17] || 0,
        blk: stats[18] || 0,
        threes: stats[10] || 0,
        helpsCategories,
        // Score: prioritize players who help weak categories and have more games
        score: helpsCategories.filter(c => weakStatIds.has(
          Object.entries(STAT_MAP).find(([, n]) => n === c)?.[0]
        )).length * 10 + gamesLeft,
      });
    }

    return players.sort((a, b) => b.score - a.score || b.ownership - a.ownership);
  } catch (err) {
    console.error('Error parsing waivers:', err);
    return [];
  }
}

const styles = {
  weakAlert: {
    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)',
    borderRadius: 8, padding: '12px 20px', marginBottom: 20,
  },
  filterRow: {
    display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20,
  },
  filters: {
    display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
  },
};
