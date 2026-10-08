import React, { useState, useEffect } from 'react';
import { getLeagues, getGamePlan, getScheduleRemaining, getWeekDays } from '../api/yahoo';
import PageHeader from '../components/PageHeader';

const STAT_MAP = {
  5: 'FG%', 8: 'FT%', 10: '3PTM', 12: 'PTS',
  15: 'REB', 16: 'AST', 17: 'STL', 18: 'BLK', 19: 'TO'
};

const STAT_IDS = Object.keys(STAT_MAP);

// Yahoo team abbr to NBA CDN tricode
const YAHOO_TO_NBA = {
  'GS': 'GSW', 'GSW': 'GSW', 'NO': 'NOP', 'NOP': 'NOP', 'NY': 'NYK', 'NYK': 'NYK',
  'PHO': 'PHX', 'PHX': 'PHX', 'SA': 'SAS', 'SAS': 'SAS',
  'ATL': 'ATL', 'BOS': 'BOS', 'BKN': 'BKN', 'CHA': 'CHA', 'CHI': 'CHI',
  'CLE': 'CLE', 'DAL': 'DAL', 'DEN': 'DEN', 'DET': 'DET', 'HOU': 'HOU',
  'IND': 'IND', 'LAC': 'LAC', 'LAL': 'LAL', 'MEM': 'MEM', 'MIA': 'MIA',
  'MIL': 'MIL', 'MIN': 'MIN', 'OKC': 'OKC', 'ORL': 'ORL', 'PHI': 'PHI',
  'POR': 'POR', 'SAC': 'SAC', 'TOR': 'TOR', 'UTA': 'UTA', 'WAS': 'WAS',
};

// Per-game stat display line (shown when player row is expanded)
const DISPLAY_STATS = [
  { id: '5', label: 'FG%', fmt: v => v ? (v * 100).toFixed(1) + '%' : '-' },
  { id: '8', label: 'FT%', fmt: v => v ? (v * 100).toFixed(1) + '%' : '-' },
  { id: '10', label: '3PM', fmt: v => v?.toFixed(1) ?? '-' },
  { id: '12', label: 'PTS', fmt: v => v?.toFixed(1) ?? '-' },
  { id: '15', label: 'REB', fmt: v => v?.toFixed(1) ?? '-' },
  { id: '16', label: 'AST', fmt: v => v?.toFixed(1) ?? '-' },
  { id: '17', label: 'STL', fmt: v => v?.toFixed(1) ?? '-' },
  { id: '18', label: 'BLK', fmt: v => v?.toFixed(1) ?? '-' },
  { id: '19', label: 'TO', fmt: v => v?.toFixed(1) ?? '-' },
];

function StatLine({ stats, gamesLeft, label, compareStats }) {
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
      {label && <span className="stat" style={{ fontSize: 10, color: 'var(--muted)', minWidth: 55 }}>{label}</span>}
      {DISPLAY_STATS.map(({ id, label: l, fmt }) => {
        const val = stats?.[id];
        const cmp = compareStats?.[id];
        const diff = val != null && cmp != null ? val - cmp : null;
        const isTO = id === '19';
        return (
          <div key={id} style={{ textAlign: 'center', minWidth: 44 }}>
            <div className="stat" style={{ fontSize: 9, color: 'var(--muted)' }}>{l}</div>
            <div className="stat" style={{ fontSize: 13, fontWeight: 600 }}>{fmt(val)}</div>
            {diff != null && (
              <div className="stat" style={{
                fontSize: 9,
                color: (isTO ? diff < 0 : diff > 0) ? 'var(--green)' : (isTO ? diff > 0 : diff < 0) ? 'var(--red)' : 'var(--muted)',
              }}>
                {diff > 0 ? '+' : ''}{id === '5' || id === '8' ? (diff * 100).toFixed(1) + '%' : diff.toFixed(1)}
              </div>
            )}
            {gamesLeft > 0 && !compareStats && val != null && id !== '5' && id !== '8' && (
              <div className="stat" style={{ fontSize: 9, color: 'var(--text2)' }}>
                {(val * gamesLeft).toFixed(1)}/wk
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function GamePlan() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [expanded, setExpanded] = useState({});
  const toggleExpand = (key) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [leagueRes, scheduleRes, weekDaysRes] = await Promise.all([
        getLeagues(),
        getScheduleRemaining(),
        getWeekDays(),
      ]);

      const { teamKey, leagueId, teamName } = extractTeamInfo(leagueRes.data);
      const leagueData = extractLeagueData(leagueRes.data);
      const gamePlanRes = await getGamePlan(leagueId, teamKey, leagueData.currentWeek);
      const schedule = scheduleRes.data.remaining || {};
      const weekDays = weekDaysRes.data?.schedule || {};

      const result = buildAnalysis(gamePlanRes.data, schedule, teamName, leagueData.currentWeek, weekDays);
      setAnalysis(result);
    } catch (err) {
      console.error('GamePlan error:', err);
      setError(err.response?.data?.details || err.message || 'Failed to load game plan');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  if (loading) {
    return (
      <div>
        <PageHeader title="GAME PLAN" subtitle="Analyzing your matchup..." />
        <div className="loading-container">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="skeleton skeleton-row" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="GAME PLAN" />
        <div className="error-state">
          <h3>Failed to Load Game Plan</h3>
          <p style={{ marginBottom: 16 }}>{typeof error === 'string' ? error : JSON.stringify(error)}</p>
          <button className="btn btn-primary" onClick={fetchData}>Retry</button>
        </div>
      </div>
    );
  }

  if (!analysis) return null;

  const { myTeam, opponent, categories, strategy, myPlayers, oppPlayers, streamTargets, week } = analysis;

  return (
    <div>
      <PageHeader title="GAME PLAN" subtitle={`Week ${week} Strategy`} />

      {/* Score overview */}
      <div style={styles.scoreCard}>
        <div style={styles.teamSide}>
          <div style={styles.teamName}>{myTeam}</div>
          <div className="stat" style={{ color: 'var(--text2)', fontSize: 12 }}>
            {analysis.myGamesLeft} games left
          </div>
        </div>
        <div style={styles.score}>
          <span style={{ color: 'var(--green)' }}>{strategy.wins}</span>
          {' - '}
          <span style={{ color: 'var(--red)' }}>{strategy.losses}</span>
          {strategy.ties > 0 && <span style={{ color: 'var(--muted)' }}> - {strategy.ties}</span>}
        </div>
        <div style={{ ...styles.teamSide, textAlign: 'right' }}>
          <div style={styles.teamName}>{opponent}</div>
          <div className="stat" style={{ color: 'var(--text2)', fontSize: 12 }}>
            {analysis.oppGamesLeft} games left
          </div>
        </div>
      </div>

      {/* Strategy summary */}
      <div style={styles.strategyBox}>
        <div style={styles.strategyRow}>
          <span className="stat" style={{ color: 'var(--green)', fontSize: 11 }}>TARGET</span>
          <span style={{ fontSize: 14 }}>
            {strategy.target.map(c => c.name).join(', ') || 'None'}
          </span>
        </div>
        <div style={styles.strategyRow}>
          <span className="stat" style={{ color: 'var(--gold)', fontSize: 11 }}>BATTLE</span>
          <span style={{ fontSize: 14 }}>
            {strategy.battle.map(c => c.name).join(', ') || 'None'}
          </span>
        </div>
        <div style={styles.strategyRow}>
          <span className="stat" style={{ color: 'var(--muted)', fontSize: 11 }}>PUNT</span>
          <span style={{ fontSize: 14 }}>
            {strategy.punt.map(c => c.name).join(', ') || 'None'}
          </span>
        </div>
      </div>

      {/* Game plan advice */}
      <div style={styles.adviceBox}>
        <div className="stat" style={{ color: 'var(--accent)', fontSize: 11, marginBottom: 8 }}>GAME PLAN</div>
        {strategy.wins >= 5 ? (
          <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>
            <strong style={{ color: 'var(--green)' }}>Projected to win {strategy.wins}-{strategy.losses}.</strong>{' '}
            Protect your leads — don't chase categories you're losing.
            {strategy.battle.filter(c => c.status === 'AT RISK').length > 0 && (
              <span> Watch <strong style={{ color: 'var(--gold)' }}>
                {strategy.battle.filter(c => c.status === 'AT RISK').map(c => c.name).join(', ')}
              </strong> — {strategy.battle.filter(c => c.status === 'AT RISK').length === 1 ? 'it' : 'they'} could swing. </span>
            )}
            {strategy.punt.length > 0 && (
              <span> Punt <strong style={{ color: 'var(--muted)' }}>
                {strategy.punt.map(c => c.name).join(', ')}
              </strong> — not worth chasing. </span>
            )}
            Stream for <strong>{[...strategy.target, ...strategy.battle].filter(c => c.status !== 'LOCK').map(c => c.name).join(', ') || 'consistency'}</strong>.
          </div>
        ) : strategy.wins >= 4 ? (
          <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>
            <strong style={{ color: 'var(--gold)' }}>Close matchup ({strategy.wins}-{strategy.losses}).</strong>{' '}
            Focus streaming on flippable categories: <strong>
              {strategy.battle.map(c => c.name).join(', ') || 'any close cats'}
            </strong>.
            {strategy.punt.length > 0 && (
              <span> Punt <strong style={{ color: 'var(--muted)' }}>{strategy.punt.map(c => c.name).join(', ')}</strong>.</span>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>
            <strong style={{ color: 'var(--red)' }}>Behind {strategy.losses}-{strategy.wins}.</strong>{' '}
            You need to flip categories. Target: <strong>
              {strategy.battle.filter(c => c.status === 'FLIPPABLE').map(c => c.name).join(', ') || strategy.battle.map(c => c.name).join(', ') || 'closest margins'}
            </strong>. Stream aggressively for those cats.
          </div>
        )}
      </div>

      {/* Category breakdown */}
      <h2 style={styles.sectionTitle}>CATEGORY BREAKDOWN</h2>
      <div style={styles.catGrid}>
        {categories.map((cat) => (
          <div key={cat.name} style={styles.catCard}>
            <div style={styles.catHeader}>
              <span className="stat" style={{ fontSize: 13, fontWeight: 600 }}>{cat.name}</span>
              <span className="stat" style={{
                fontSize: 10,
                padding: '2px 8px',
                borderRadius: 3,
                background: statusColors[cat.status].bg,
                color: statusColors[cat.status].text,
                fontWeight: 700,
              }}>
                {cat.status}
              </span>
            </div>
            <div style={styles.catValues}>
              <span className="stat" style={{ color: cat.iWin ? 'var(--green)' : 'var(--red)', fontSize: 18, fontWeight: 600 }}>
                {formatStat(cat.myValue, cat.name)}
              </span>
              <span className="stat" style={{ color: 'var(--muted)', fontSize: 12 }}>vs</span>
              <span className="stat" style={{ color: cat.iWin ? 'var(--red)' : 'var(--green)', fontSize: 18, fontWeight: 600 }}>
                {formatStat(cat.theirValue, cat.name)}
              </span>
            </div>
            {(cat.currentMy > 0 || cat.currentTheir > 0) && !(cat.name === 'FG%' || cat.name === 'FT%') && (
              <div className="stat" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                Current: {formatStat(cat.currentMy, cat.name)} vs {formatStat(cat.currentTheir, cat.name)}
              </div>
            )}
            <div className="stat" style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
              {cat.insight}
            </div>
          </div>
        ))}
      </div>

      {/* My roster - remaining games & recommendations */}
      <h2 style={styles.sectionTitle}>YOUR ROSTER — REMAINING GAMES</h2>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos</th>
              <th>Team</th>
              <th>Games Left</th>
              <th>Status</th>
              <th>Helps</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {myPlayers.map((p) => (
              <React.Fragment key={p.playerKey}>
                <tr onClick={() => toggleExpand(p.playerKey)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontWeight: 500 }}>
                    <span style={{ color: 'var(--muted)', fontSize: 10, marginRight: 6 }}>{expanded[p.playerKey] ? '▼' : '▶'}</span>
                    {p.name}
                    {p.isIL && <span className="stat" style={{ fontSize: 9, color: 'var(--muted)', marginLeft: 6, padding: '1px 4px', border: '1px solid var(--border)', borderRadius: 3 }}>IL</span>}
                  </td>
                  <td><span className="pos-badge">{p.position}</span></td>
                  <td className="stat">{p.team}</td>
                  <td className="stat" style={{ color: p.gamesLeft > 0 ? 'var(--text)' : 'var(--muted)' }}>
                    {p.gamesLeft}
                  </td>
                  <td>
                    <span className={getStatusClass(p.status)}>{p.status || 'Active'}</span>
                  </td>
                  <td className="stat" style={{ fontSize: 11 }}>{p.helps.join(', ')}</td>
                  <td>
                    <span className="stat" style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: p.action === 'START' ? 'var(--green)' : p.action === 'SIT' ? 'var(--red)' : 'var(--gold)',
                    }}>
                      {p.action}
                    </span>
                  </td>
                </tr>
                {expanded[p.playerKey] && (
                  <tr>
                    <td colSpan={7} style={{ padding: '8px 20px 12px', background: 'var(--bg)' }}>
                      <StatLine stats={p.stats} gamesLeft={p.gamesLeft} label="Per Game" />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Opponent roster */}
      <h2 style={styles.sectionTitle}>OPPONENT ROSTER</h2>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos</th>
              <th>Team</th>
              <th>Games Left</th>
              <th>Status</th>
              <th>Threat In</th>
            </tr>
          </thead>
          <tbody>
            {oppPlayers.map((p) => (
              <React.Fragment key={p.playerKey}>
                <tr onClick={() => toggleExpand('opp-' + p.playerKey)} style={{ cursor: 'pointer' }}>
                  <td style={{ fontWeight: 500 }}>
                    <span style={{ color: 'var(--muted)', fontSize: 10, marginRight: 6 }}>{expanded['opp-' + p.playerKey] ? '▼' : '▶'}</span>
                    {p.name}
                  </td>
                  <td><span className="pos-badge">{p.position}</span></td>
                  <td className="stat">{p.team}</td>
                  <td className="stat" style={{ color: p.gamesLeft > 0 ? 'var(--text)' : 'var(--muted)' }}>
                    {p.gamesLeft}
                  </td>
                  <td>
                    <span className={getStatusClass(p.status)}>{p.status || 'Active'}</span>
                  </td>
                  <td className="stat" style={{ fontSize: 11 }}>{p.threats.join(', ')}</td>
                </tr>
                {expanded['opp-' + p.playerKey] && (
                  <tr>
                    <td colSpan={6} style={{ padding: '8px 20px 12px', background: 'var(--bg)' }}>
                      <StatLine stats={p.stats} gamesLeft={p.gamesLeft} label="Per Game" />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recommended moves */}
      {analysis.moves.length > 0 && (
        <>
          <h2 style={styles.sectionTitle}>RECOMMENDED MOVES</h2>
          <p style={{ color: 'var(--text2)', fontSize: 13, marginBottom: 16 }}>
            Pickups that improve your projected matchup this week
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {analysis.moves.map((move, i) => (
              <div key={i} style={styles.moveCard}>
                <div style={styles.moveHeader}>
                  <span className="stat" style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 700 }}>
                    MOVE {i + 1}
                  </span>
                  <span className="stat" style={{ fontSize: 12 }}>
                    <span style={{ color: 'var(--green)' }}>
                      {move.newScore.wins}
                    </span>-<span style={{ color: 'var(--red)' }}>
                      {move.newScore.losses}
                    </span>
                    {' '}projected
                    {move.newScore.wins > strategy.wins && <span style={{ color: 'var(--green)', marginLeft: 4 }}>({move.newScore.wins - strategy.wins > 0 ? '+' : ''}{move.newScore.wins - strategy.wins} cat)</span>}
                  </span>
                </div>

                {/* ADD / DROP players with game schedules */}
                <div style={styles.moveBody}>
                  <div style={styles.movePlayer}>
                    <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: 12, marginRight: 8 }}>ADD</span>
                    <span style={{ fontWeight: 500 }}>{move.add.name}</span>
                    <span className="pos-badge" style={{ marginLeft: 8 }}>{move.add.position}</span>
                    <span className="stat" style={{ color: 'var(--text2)', fontSize: 12, marginLeft: 8 }}>{move.add.team}</span>
                    <span className="stat" style={{ color: 'var(--green)', fontSize: 11, marginLeft: 8 }}>
                      {move.add.gameDays?.map(g => formatDay(g.date)).join(', ') || `${move.add.gamesLeft} games`}
                    </span>
                  </div>
                  <div style={styles.movePlayer}>
                    <span style={{ color: 'var(--red)', fontWeight: 700, fontSize: 12, marginRight: 8 }}>DROP</span>
                    <span style={{ fontWeight: 500 }}>{move.drop.name}</span>
                    <span className="pos-badge" style={{ marginLeft: 8 }}>{move.drop.position}</span>
                    <span className="stat" style={{ color: 'var(--text2)', fontSize: 12, marginLeft: 8 }}>{move.drop.team}</span>
                    <span className="stat" style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 8 }}>
                      {move.drop.gameDays?.map(g => formatDay(g.date)).join(', ') || `${move.drop.gamesLeft} games`}
                    </span>
                  </div>
                </div>

                {/* Position warning */}
                {move.positionWarnings?.length > 0 && (
                  <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, padding: '6px 12px', marginTop: 8 }}>
                    {move.positionWarnings.map((w, j) => (
                      <div key={j} className="stat" style={{ fontSize: 11, color: 'var(--red)' }}>{w}</div>
                    ))}
                  </div>
                )}

                {/* Timing recommendation */}
                {move.timing && (
                  <div className="stat" style={{ fontSize: 11, color: 'var(--accent)', marginTop: 8 }}>
                    {move.timing}
                  </div>
                )}

                {/* Per-game stat comparison */}
                <div style={{ marginTop: 10, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                  <StatLine stats={move.add.stats} compareStats={move.drop.stats} label="PER GAME NET" />
                </div>

                {/* What-if category projections */}
                {move.whatIf && (
                  <div style={{ marginTop: 8, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                    <div className="stat" style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 6 }}>WHAT-IF PROJECTIONS</div>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {STAT_IDS.map(id => {
                        const w = move.whatIf[id];
                        if (!w) return null;
                        const isPct = w.name === 'FG%' || w.name === 'FT%';
                        const isTO = w.name === 'TO';
                        const iWin = isTO ? w.projected < w.opp : w.projected > w.opp;
                        const wasWin = isTO ? w.current < w.opp : w.current > w.opp;
                        const flipped = iWin !== wasWin;
                        return (
                          <div key={id} style={{ textAlign: 'center', minWidth: 52, padding: '4px 6px', borderRadius: 4, background: flipped ? (iWin ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)') : 'transparent' }}>
                            <div className="stat" style={{ fontSize: 9, color: 'var(--muted)' }}>{w.name}</div>
                            <div className="stat" style={{ fontSize: 12, fontWeight: 600, color: iWin ? 'var(--green)' : 'var(--red)' }}>
                              {isPct ? w.projected.toFixed(3) : w.projected.toFixed(1)}
                            </div>
                            <div className="stat" style={{ fontSize: 9, color: 'var(--text2)' }}>
                              vs {isPct ? w.opp.toFixed(3) : w.opp.toFixed(1)}
                            </div>
                            {w.delta != null && w.delta !== 0 && (
                              <div className="stat" style={{ fontSize: 9, color: (isTO ? w.delta < 0 : w.delta > 0) ? 'var(--green)' : 'var(--red)' }}>
                                {w.delta > 0 ? '+' : ''}{w.delta.toFixed(1)}
                              </div>
                            )}
                            {flipped && <div className="stat" style={{ fontSize: 8, color: iWin ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{iWin ? 'FLIP W' : 'FLIP L'}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="stat" style={{ fontSize: 11, color: 'var(--text2)', marginTop: 8 }}>
                  {move.reason}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Streaming targets */}
      {streamTargets.length > 0 && (
        <>
          <h2 style={styles.sectionTitle}>ALL STREAMING OPTIONS</h2>
          <p style={{ color: 'var(--text2)', fontSize: 13, marginBottom: 16 }}>
            Full list of available pickups ranked by projected impact
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Pos</th>
                  <th>Team</th>
                  <th>Games Left</th>
                  <th>Helps</th>
                  <th>Impact</th>
                </tr>
              </thead>
              <tbody>
                {streamTargets.map((p) => (
                  <React.Fragment key={p.playerKey}>
                    <tr onClick={() => toggleExpand('st-' + p.playerKey)} style={{ cursor: 'pointer' }}>
                      <td style={{ fontWeight: 500 }}>
                        <span style={{ color: 'var(--muted)', fontSize: 10, marginRight: 6 }}>{expanded['st-' + p.playerKey] ? '▼' : '▶'}</span>
                        {p.name}
                      </td>
                      <td><span className="pos-badge">{p.position}</span></td>
                      <td className="stat">{p.team}</td>
                      <td className="stat" style={{ color: 'var(--green)' }}>{p.gamesLeft}</td>
                      <td className="stat" style={{ fontSize: 11 }}>{p.helps.join(', ')}</td>
                      <td>
                        <span className="stat" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                          +{p.impact.toFixed(1)}
                        </span>
                      </td>
                    </tr>
                    {expanded['st-' + p.playerKey] && (
                      <tr>
                        <td colSpan={6} style={{ padding: '8px 20px 12px', background: 'var(--bg)' }}>
                          <StatLine stats={p.stats} gamesLeft={p.gamesLeft} label="Per Game" />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Analysis Logic ──────────────────────────────────────────────────────────

function buildAnalysis(data, schedule, teamName, week, weekDays = {}) {
  const { matchup: matchupData, myRoster, opponentRoster, waivers } = data;

  // Parse matchup scores
  const fc = matchupData.fantasy_content;
  const team = fc.team;
  const teamInfo = team[0] || team[1];
  const myName = findInArray(Array.isArray(teamInfo) ? teamInfo : [teamInfo], 'name') || teamName;

  const matchups = (Array.isArray(team) ? team : [team])[1]?.matchups || team[1]?.matchups;
  const matchup = matchups?.[0]?.matchup;
  const teamsData = matchup?.teams || matchup?.[0]?.teams;

  let myStats = {}, theirStats = {}, opponentName = 'Opponent';

  if (teamsData) {
    for (let i = 0; i < (teamsData.count || 2); i++) {
      const t = teamsData[i]?.team;
      if (!t) continue;
      const info = t[0];
      const name = findInArray(info, 'name') || `Team ${i + 1}`;
      const isOwned = Array.isArray(info) ? info.some(x => x.is_owned_by_current_login) : false;

      const statsWrapper = t[1]?.team_stats?.stats || [];
      const stats = {};
      statsWrapper.forEach(s => {
        if (s.stat) stats[s.stat.stat_id] = parseFloat(s.stat.value) || 0;
      });

      if (isOwned) {
        myStats = stats;
      } else {
        opponentName = name;
        theirStats = stats;
      }
    }
  }

  // Parse rosters
  const myPlayers = parseRosterPlayers(myRoster, schedule, weekDays);
  const oppPlayers = parseRosterPlayers(opponentRoster, schedule, weekDays);

  const myGamesLeft = myPlayers.reduce((sum, p) => sum + (isPlayerOut(p.statusRaw) ? 0 : p.gamesLeft), 0);
  const oppGamesLeft = oppPlayers.reduce((sum, p) => sum + (isPlayerOut(p.statusRaw) ? 0 : p.gamesLeft), 0);

  // Project stats: current week totals + (per-game avg * remaining games) for active players
  const myProjected = projectTeamStats(myPlayers);
  const oppProjected = projectTeamStats(oppPlayers);

  // Build category analysis using current matchup totals + projections
  const categories = [];
  let wins = 0, losses = 0, ties = 0;

  for (const id of STAT_IDS) {
    const name = STAT_MAP[id];
    const currentMy = myStats[id] || 0;
    const currentTheir = theirStats[id] || 0;
    const projMy = myProjected[id] || 0;
    const projTheir = oppProjected[id] || 0;

    // For percentages (FG%, FT%), use current if available, otherwise projected average
    // For counting stats, add current totals + projected remaining
    const isPct = name === 'FG%' || name === 'FT%';
    const allZero = currentMy === 0 && currentTheir === 0;
    let myVal, theirVal;
    if (isPct) {
      // Percentages: use current week's actual percentage if games have been played
      myVal = currentMy > 0 ? currentMy : projMy;
      theirVal = currentTheir > 0 ? currentTheir : projTheir;
    } else {
      myVal = allZero ? projMy : currentMy + projMy;
      theirVal = allZero ? projTheir : currentTheir + projTheir;
    }

    const isTO = name === 'TO';
    const iWin = isTO ? myVal < theirVal : myVal > theirVal;
    const isTied = Math.abs(myVal - theirVal) < 0.001;
    const diff = isTO ? theirVal - myVal : myVal - theirVal;

    if (isTied) ties++;
    else if (iWin) wins++;
    else losses++;

    // Determine category status based on projected margin
    // Scale thresholds by remaining games (more games = more room to flip)
    let status, insight;
    const absDiff = Math.abs(diff);
    const gamesScale = Math.max(1, Math.min(myGamesLeft, oppGamesLeft) / 10); // ~4 early week
    const baseThreshold = isPct ? 0.02 : (name === '3PTM' || name === 'STL' || name === 'BLK' ? 3 : 12);
    const threshold = baseThreshold * gamesScale;
    const puntThreshold = baseThreshold * gamesScale * 3; // only punt if WAY behind

    if (isTied) {
      status = 'BATTLE';
      insight = `Projected dead even — every game matters`;
    } else if (iWin && absDiff > threshold * 2) {
      status = 'LOCK';
      insight = `Projected lead of ${formatStat(absDiff, name)} — comfortable`;
    } else if (iWin && absDiff <= threshold) {
      status = 'AT RISK';
      insight = `Projected lead of only ${formatStat(absDiff, name)} — could swing`;
    } else if (iWin) {
      status = 'WINNING';
      insight = `Projected ahead by ${formatStat(absDiff, name)}`;
    } else if (!iWin && absDiff <= threshold) {
      status = 'FLIPPABLE';
      insight = `Projected down ${formatStat(absDiff, name)} — winnable with streaming`;
    } else if (!iWin && absDiff <= puntThreshold) {
      status = 'FLIPPABLE';
      insight = `Projected down ${formatStat(absDiff, name)} — difficult but possible with streaming`;
    } else {
      status = 'PUNT';
      insight = `Projected down ${formatStat(absDiff, name)} — tough to overcome`;
    }

    categories.push({
      name, myValue: myVal, theirValue: theirVal,
      currentMy, currentTheir, projMy, projTheir,
      diff, iWin, isTied, status, insight, statId: id,
    });
  }

  // Build strategy — never punt more than 4 categories (5 punts = guaranteed loss)
  const target = categories.filter(c => c.status === 'LOCK' || c.status === 'WINNING');
  let battle = categories.filter(c => c.status === 'BATTLE' || c.status === 'AT RISK' || c.status === 'FLIPPABLE');
  let punt = categories.filter(c => c.status === 'PUNT');
  // If too many punts, promote the closest ones to FLIPPABLE
  while (punt.length > 4 && punt.length > 0) {
    // Find the punt category with smallest margin (most flippable)
    punt.sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff));
    const promoted = punt.shift();
    promoted.status = 'FLIPPABLE';
    promoted.insight = `Projected down ${formatStat(Math.abs(promoted.diff), promoted.name)} — streaming target`;
    battle.push(promoted);
  }

  // For streaming recommendations: focus on battle cats + winning cats we want to protect
  // If winning overall (5+), protect leads; if losing, try to flip FLIPPABLE cats
  const streamCats = [...battle, ...target].filter(c => c.status !== 'LOCK'); // everything except LOCKs and PUNTs
  const battleStatIds = new Set(
    (streamCats.length > 0 ? streamCats : categories.filter(c => c.status !== 'PUNT')).map(c => c.statId)
  );

  // Player recommendations based on battle categories
  for (const p of myPlayers) {
    p.helps = getPlayerStrengths(p, battleStatIds);
    const isOut = p.statusRaw && ['INJ', 'O', 'OUT', 'IR', 'SUSP'].includes(p.statusRaw.toUpperCase());
    if (isOut) {
      p.action = 'SIT';
    } else if (p.gamesLeft === 0) {
      p.action = 'SIT';
    } else if (p.helps.length > 0 && p.gamesLeft >= 2) {
      p.action = 'START';
    } else if (p.helps.length > 0) {
      p.action = 'START';
    } else {
      p.action = 'STREAM?';
    }
  }

  // Opponent threat analysis
  for (const p of oppPlayers) {
    p.threats = getPlayerStrengths(p, battleStatIds);
  }

  // Sort players: active starters first
  myPlayers.sort((a, b) => {
    const order = { 'START': 0, 'STREAM?': 1, 'SIT': 2 };
    return (order[a.action] || 1) - (order[b.action] || 1) || b.gamesLeft - a.gamesLeft;
  });
  oppPlayers.sort((a, b) => b.gamesLeft - a.gamesLeft);

  // Streaming targets from waivers
  const streamTargets = buildStreamTargets(waivers, schedule, battleStatIds, weekDays);

  // Build recommended moves with what-if projections
  const moves = buildMoves(streamTargets, myPlayers, categories, battleStatIds, myProjected, oppProjected, myStats, weekDays);

  return {
    myTeam: myName, opponent: opponentName, categories, strategy: { wins, losses, ties, target, battle, punt },
    myPlayers, oppPlayers, streamTargets, moves, myGamesLeft, oppGamesLeft, week, weekDays,
  };
}

function parseRosterPlayers(rosterData, schedule, weekDays = {}) {
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

      // Detect IL slot from selected_position
      const selPos = p.find(el => el && el.selected_position);
      const slotPos = selPos?.selected_position?.find?.(sp => sp.position)?.position
        || (Array.isArray(selPos?.selected_position) ? selPos.selected_position.find(sp => sp.position)?.position : null)
        || '';
      const isIL = slotPos === 'IL' || slotPos === 'IL+' || slotPos === 'IL+LT';
      const nbaTeam = YAHOO_TO_NBA[teamAbbr] || teamAbbr;
      const gamesLeft = schedule[nbaTeam] || 0;

      // Stats can be at p[1], p[2], or p[3] depending on Yahoo response structure
      const statsObj = p.find(el => el && el.player_stats);
      const statsArr = statsObj?.player_stats?.stats || [];
      // Backend requests type=average_season so these are already per-game averages
      const stats = {};
      statsArr.forEach(s => {
        if (s.stat && STAT_MAP[String(s.stat.stat_id)]) {
          stats[String(s.stat.stat_id)] = parseFloat(s.stat.value) || 0;
        }
      });

      players.push({
        playerKey: findInArray(info, 'player_key') || i,
        name: playerName || 'Unknown',
        position: findInArray(info, 'display_position') || '',
        team: teamAbbr,
        status: statusText(status),
        statusRaw: status,
        slot: slotPos,
        isIL,
        gamesLeft,
        stats,
        gameDays: weekDays[nbaTeam] || [],
        helps: [],
        threats: [],
        action: '',
      });
    }
    return players;
  } catch (err) {
    console.error('Error parsing roster for gameplan:', err);
    return [];
  }
}

function getPlayerStrengths(player, battleStatIds) {
  const strengths = [];
  const { stats } = player;
  if (!stats || Object.keys(stats).length === 0) return strengths;

  for (const id of battleStatIds) {
    const name = STAT_MAP[id];
    const val = stats[id];
    if (val == null) continue;

    // Check if player contributes meaningfully to this stat
    if (name === 'FG%' || name === 'FT%') {
      if (val > 0) strengths.push(name);
    } else if (name === 'TO') {
      if (val <= 1.5) strengths.push('Low TO'); // low turnover player is an asset
    } else if (name === '3PTM' && val >= 1) {
      strengths.push(name);
    } else if (name === 'STL' && val >= 0.5) {
      strengths.push(name);
    } else if (name === 'BLK' && val >= 0.5) {
      strengths.push(name);
    } else if ((name === 'PTS' || name === 'REB' || name === 'AST') && val > 0) {
      strengths.push(name);
    }
  }
  return strengths;
}

function buildStreamTargets(waiversData, schedule, battleStatIds, weekDays = {}) {
  if (!waiversData) return [];
  try {
    const fc = waiversData.fantasy_content;
    const league = fc.league;
    const leagueArr = Array.isArray(league) ? league : [league];
    const playersObj = leagueArr[1]?.players;
    if (!playersObj) return [];

    const targets = [];
    const count = playersObj.count || 0;

    for (let i = 0; i < count; i++) {
      const p = playersObj[i]?.player;
      if (!p) continue;

      const info = p[0];
      const name = findInArray(info, 'name');
      const playerName = typeof name === 'object' ? name.full : name;
      const teamAbbr = (findInArray(info, 'editorial_team_abbr') || '').toUpperCase();
      const nbaTeam = YAHOO_TO_NBA[teamAbbr] || teamAbbr;
      const gamesLeft = schedule[nbaTeam] || 0;
      const status = findInArray(info, 'status') || '';

      // Skip injured/out players and teams with no games left
      if (gamesLeft === 0) continue;
      if (isPlayerOut(status)) continue;

      // Backend requests type=average_season so these are already per-game averages
      const statsObj = p.find(el => el && el.player_stats);
      const statsArr = statsObj?.player_stats?.stats || [];
      const stats = {};
      statsArr.forEach(s => {
        if (s.stat && STAT_MAP[String(s.stat.stat_id)]) {
          stats[String(s.stat.stat_id)] = parseFloat(s.stat.value) || 0;
        }
      });

      const helps = [];
      let impact = 0;

      for (const id of battleStatIds) {
        const statName = STAT_MAP[id];
        const val = stats[id] || 0;
        if (statName === 'FG%' || statName === 'FT%') continue;
        if (statName === 'TO') {
          // Low TO is good — bonus for players with low turnovers
          if (val <= 1.5) {
            helps.push('Low TO');
            impact += (2 - val) * gamesLeft; // lower TO = more impact
          }
          continue;
        }
        if (val > 0.5) { // meaningful per-game contribution
          helps.push(statName);
          impact += val * gamesLeft;
        }
      }

      if (helps.length > 0) {
        targets.push({
          playerKey: findInArray(info, 'player_key') || i,
          name: playerName || 'Unknown',
          position: findInArray(info, 'display_position') || '',
          team: teamAbbr,
          gamesLeft,
          helps,
          impact,
          stats,
          gameDays: weekDays[nbaTeam] || [],
        });
      }
    }

    return targets.sort((a, b) => b.impact - a.impact).slice(0, 8);
  } catch (err) {
    console.error('Error building stream targets:', err);
    return [];
  }
}

function buildMoves(streamTargets, myPlayers, categories, battleStatIds, myProjected, oppProjected, myStats, weekDays) {
  if (streamTargets.length === 0) return [];

  // Score each roster player's contribution to battle categories this week
  const rosterScored = myPlayers.map(p => {
    let weekValue = 0;
    if (isPlayerOut(p.statusRaw) || p.gamesLeft === 0) {
      weekValue = 0;
    } else {
      for (const id of battleStatIds) {
        const name = STAT_MAP[id];
        if (name === 'FG%' || name === 'FT%' || name === 'TO') continue;
        weekValue += (p.stats[id] || 0) * p.gamesLeft;
      }
    }
    return { ...p, weekValue };
  });

  // Sort roster by week value ascending (worst contributors first = drop candidates)
  // Exclude IL players — they don't take up active roster spots
  const dropCandidates = [...rosterScored]
    .filter(p => !p.isIL)
    .sort((a, b) => a.weekValue - b.weekValue);

  const moves = [];
  const usedDrops = new Set();
  const usedAdds = new Set();

  for (const target of streamTargets) {
    if (usedAdds.has(target.playerKey)) continue;

    // Find the best drop candidate (lowest week value, not already used)
    const drop = dropCandidates.find(p =>
      !usedDrops.has(p.playerKey) && target.impact > p.weekValue
    );

    if (!drop) continue;

    const netImpact = target.impact - drop.weekValue;
    if (netImpact <= 0) continue;

    // Position warning: check if dropping this position leaves you short
    const dropPositions = (drop.position || '').split(',').map(s => s.trim());
    const addPositions = (target.position || '').split(',').map(s => s.trim());
    const positionWarnings = [];
    for (const pos of dropPositions) {
      if (!pos) continue;
      const playersAtPos = myPlayers.filter(p =>
        !p.isIL && p.playerKey !== drop.playerKey && (p.position || '').includes(pos)
      );
      if (playersAtPos.length <= 1 && !addPositions.includes(pos)) {
        positionWarnings.push(`Dropping ${drop.name} leaves you thin at ${pos}`);
      }
    }

    // What-if projections: compute new projected totals
    const whatIf = {};
    let newWins = 0, newLosses = 0;
    for (const cat of categories) {
      const id = cat.statId;
      const sName = STAT_MAP[id];
      const isPct = sName === 'FG%' || sName === 'FT%';
      // For percentages, we can't simply add/subtract — skip
      if (isPct) {
        whatIf[id] = { current: cat.myValue, projected: cat.myValue, opp: cat.theirValue, name: sName };
        const isTO = sName === 'TO';
        const iWin = isTO ? cat.myValue < cat.theirValue : cat.myValue > cat.theirValue;
        if (iWin) newWins++; else newLosses++;
        continue;
      }
      // Remove drop player's contribution, add pickup's
      const dropContrib = (drop.stats?.[id] || 0) * drop.gamesLeft;
      const addContrib = (target.stats?.[id] || 0) * target.gamesLeft;
      const newVal = cat.myValue - dropContrib + addContrib;
      whatIf[id] = { current: cat.myValue, projected: newVal, opp: cat.theirValue, name: sName, delta: newVal - cat.myValue };
      const isTO = sName === 'TO';
      const iWin = isTO ? newVal < cat.theirValue : newVal > cat.theirValue;
      if (iWin) newWins++; else newLosses++;
    }

    // Build reason text
    const flippable = categories.filter(c => c.status === 'FLIPPABLE');
    let reason = `${target.name} projects +${target.impact.toFixed(1)} in ${target.helps.join(', ')} this week`;
    if (drop.gamesLeft === 0) {
      reason += `. ${drop.name} has 0 games left — dead roster spot`;
    } else if (isPlayerOut(drop.statusRaw)) {
      reason += `. ${drop.name} is out — not contributing`;
    } else {
      reason += `. ${drop.name} projects only +${drop.weekValue.toFixed(1)} in battle cats`;
    }
    if (flippable.length > 0) {
      reason += `. Could flip: ${flippable.map(c => c.name).join(', ')}`;
    }

    // Find best timing: when does add player play next vs drop player?
    const addDays = target.gameDays || [];
    const dropDays = drop.gameDays || [];
    let timing = '';
    if (dropDays.length > 0 && addDays.length > 0) {
      const nextDrop = dropDays[0]?.date;
      const nextAdd = addDays[0]?.date;
      if (nextDrop && nextAdd && nextDrop < nextAdd) {
        timing = `Wait until after ${formatDay(nextDrop)} (${drop.name} plays) then add ${target.name}`;
      } else if (nextAdd) {
        timing = `Add now — ${target.name} plays ${formatDay(nextAdd)}`;
      }
    } else if (addDays.length > 0) {
      timing = `Add now — ${target.name} plays ${formatDay(addDays[0]?.date)}`;
    }

    moves.push({
      add: target,
      drop: { name: drop.name, position: drop.position, team: drop.team, gamesLeft: drop.gamesLeft, stats: drop.stats, gameDays: dropDays },
      netImpact,
      reason,
      positionWarnings,
      whatIf,
      newScore: { wins: newWins, losses: newLosses },
      timing,
    });

    usedDrops.add(drop.playerKey);
    usedAdds.add(target.playerKey);

    if (moves.length >= 3) break; // Top 3 moves
  }

  return moves;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function formatDay(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return DAY_NAMES[d.getDay()] + ' ' + (d.getMonth() + 1) + '/' + d.getDate();
}

function isPlayerOut(statusRaw) {
  if (!statusRaw) return false;
  return ['INJ', 'O', 'OUT', 'IR', 'SUSP'].includes(statusRaw.toUpperCase());
}

function projectTeamStats(players) {
  const projected = {};
  for (const p of players) {
    if (isPlayerOut(p.statusRaw) || p.gamesLeft === 0) continue;
    // stats are per-game averages, multiply by remaining games
    for (const [id, val] of Object.entries(p.stats)) {
      if (STAT_MAP[id] === 'FG%' || STAT_MAP[id] === 'FT%') {
        // For percentages, we'll average across players (weighted approximation)
        if (!projected[id]) projected[id] = { total: 0, count: 0 };
        if (typeof projected[id] === 'object') {
          projected[id].total += val * p.gamesLeft;
          projected[id].count += p.gamesLeft;
        }
      } else {
        if (typeof projected[id] === 'object') projected[id] = 0; // reset if was pct
        projected[id] = (projected[id] || 0) + val * p.gamesLeft;
      }
    }
  }
  // Resolve percentage averages
  for (const [id, val] of Object.entries(projected)) {
    if (typeof val === 'object' && val.count > 0) {
      projected[id] = val.total / val.count;
    }
  }
  return projected;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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
        const name = info.find(x => x.name)?.name;
        if (tk) return { teamKey: tk, leagueId, teamName: name || 'My Team' };
      }
    }
  }
  return { teamKey: `${gameKey}.l.${leagueId}.t.1`, leagueId, teamName: 'My Team' };
}

function extractLeagueData(data) {
  const fc = data.fantasy_content;
  const user = fc.users[0].user;
  const game = user[1].games[0].game;
  const league = game[1].leagues[0].league;
  const leagueInfo = Array.isArray(league) ? league[0] : league;
  return { currentWeek: parseInt(leagueInfo.current_week) };
}

function findInArray(arr, key) {
  if (!Array.isArray(arr)) return arr?.[key];
  for (const item of arr) {
    if (item && typeof item === 'object' && key in item) return item[key];
  }
  return null;
}

function statusText(s) {
  if (!s) return 'Active';
  const upper = String(s).toUpperCase();
  if (upper === 'INJ' || upper === 'O' || upper === 'OUT' || upper === 'IR') return 'Out';
  if (upper === 'GTD' || upper === 'DTD') return 'GTD';
  if (upper === 'SUSP') return 'Out';
  return s;
}

function getStatusClass(status) {
  const s = (status || '').toUpperCase();
  if (s === 'OUT' || s === 'INJ' || s === 'IR' || s === 'SUSP') return 'status-out';
  if (s === 'GTD' || s === 'DTD') return 'status-gtd';
  return 'status-active';
}

function formatStat(val, cat) {
  if (cat === 'FG%' || cat === 'FT%') return val.toFixed(3);
  if (Number.isInteger(val)) return val;
  return val.toFixed(1);
}

const statusColors = {
  'LOCK': { bg: 'rgba(34, 197, 94, 0.15)', text: 'var(--green)' },
  'WINNING': { bg: 'rgba(34, 197, 94, 0.1)', text: 'var(--green)' },
  'AT RISK': { bg: 'rgba(245, 158, 11, 0.15)', text: 'var(--gold)' },
  'BATTLE': { bg: 'rgba(245, 158, 11, 0.15)', text: 'var(--gold)' },
  'FLIPPABLE': { bg: 'rgba(59, 130, 246, 0.15)', text: 'var(--blue)' },
  'PUNT': { bg: 'rgba(75, 85, 99, 0.15)', text: 'var(--muted)' },
};

const styles = {
  scoreCard: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '24px 32px', marginBottom: 24,
  },
  teamSide: { flex: 1 },
  teamName: { fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, letterSpacing: '0.03em' },
  score: {
    fontFamily: "'Bebas Neue', sans-serif", fontSize: 48,
    letterSpacing: '0.05em', textAlign: 'center', minWidth: 120,
  },
  strategyBox: {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '20px 24px', marginBottom: 32,
    display: 'flex', flexDirection: 'column', gap: 12,
  },
  strategyRow: { display: 'flex', alignItems: 'center', gap: 12 },
  adviceBox: {
    background: 'rgba(249, 115, 22, 0.06)', border: '1px solid rgba(249, 115, 22, 0.2)',
    borderRadius: 8, padding: '16px 24px', marginBottom: 32,
  },
  sectionTitle: { fontSize: 24, marginTop: 32, marginBottom: 16, color: 'var(--text)' },
  catGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 12, marginBottom: 16,
  },
  catCard: {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '16px 20px',
  },
  catHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  catValues: { display: 'flex', alignItems: 'center', gap: 12 },
  moveCard: {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderLeft: '3px solid var(--accent)', borderRadius: 8, padding: '16px 20px',
  },
  moveHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12,
  },
  moveBody: {
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  movePlayer: {
    display: 'flex', alignItems: 'center', flexWrap: 'wrap',
  },
};
