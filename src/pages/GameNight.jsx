import { useCallback, useEffect, useRef, useState } from 'react';
import { getGameNight } from '../api/yahoo';
import PageHeader from '../components/PageHeader';

const LIVE_MS = 30_000;
const IDLE_MS = 5 * 60_000;

const fmtCat = (c, v) => (v == null ? '–' : c.pct ? v.toFixed(3).replace(/^0/, '') : Number.isInteger(v) ? v : v.toFixed(1));
const tipTime = utc => (utc ? new Date(utc).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');

function gameLabel(g) {
  if (!g) return 'No game';
  if (g.status === 1) return `${g.home ? 'vs' : '@'} ${g.opp} · ${tipTime(g.utc)}`;
  if (g.status === 3) return `Final ${g.score || ''}`;
  return g.statusText || `Q${g.period} ${g.clock}`;
}

function liveLine(l) {
  if (!l) return null;
  const parts = [`${l.pts} pts`, `${l.reb} reb`, `${l.ast} ast`];
  if (l.stl) parts.push(`${l.stl} stl`);
  if (l.blk) parts.push(`${l.blk} blk`);
  if (l.tpm) parts.push(`${l.tpm} 3pm`);
  parts.push(`${l.fgm}-${l.fga} fg`);
  if (l.fta) parts.push(`${l.ftm}-${l.fta} ft`);
  if (l.to) parts.push(`${l.to} to`);
  return `${l.min}m · ${parts.join(' · ')}`;
}

const order = p => (p.game?.status === 2 ? 0 : p.game?.status === 1 ? 1 : p.game?.status === 3 ? 2 : 3) + (p.active ? 0 : 10);

export default function GameNight() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);
  const [side, setSide] = useState('me');
  const timer = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      const { data } = await getGameNight();
      setData(data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!auto || !data) return;
    timer.current = setTimeout(fetchData, data.liveCount > 0 ? LIVE_MS : IDLE_MS);
    return () => clearTimeout(timer.current);
  }, [auto, data, fetchData]);

  // Refresh immediately when the phone/tab comes back to the foreground
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible' && auto) fetchData(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [auto, fetchData]);

  if (loading) {
    return (
      <div>
        <PageHeader title="GAME NIGHT" subtitle="Loading live matchup…" />
        <div className="loading-container">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton skeleton-row" />)}</div>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div>
        <PageHeader title="GAME NIGHT" />
        <div className="error-state">
          <h3>Failed to load</h3>
          <p style={{ marginBottom: 16 }}>{error}</p>
          <button className="btn btn-primary" onClick={() => { setLoading(true); fetchData(); }}>Retry</button>
        </div>
      </div>
    );
  }

  const { me, opp, score, projScore, categories, games, players, alerts, liveCount } = data;
  const roster = [...(side === 'me' ? players.me : players.opp)].sort((a, b) => order(a) - order(b));
  const counting = list => list.filter(p => p.counting && p.game?.status !== 3).length;

  return (
    <div>
      <PageHeader title="GAME NIGHT" subtitle={`Week ${data.week} · ${data.date}${liveCount ? ` · ${liveCount} live` : ''}`} />

      <div className="gn-score">
        <div className="gn-team">
          <div className="gn-name">{me.name}</div>
          <div className="meta">{counting(players.me)} still to play tonight</div>
        </div>
        <div className="gn-mid">
          <div className="gn-big">
            <span style={{ color: 'var(--green)' }}>{score.me}</span>
            <span style={{ color: 'var(--muted)' }}>–</span>
            <span style={{ color: 'var(--red)' }}>{score.opp}</span>
            {score.tie > 0 && <span style={{ color: 'var(--muted)', fontSize: '0.5em' }}> ({score.tie} tied)</span>}
          </div>
          <div className="meta">Projected final {projScore.me}–{projScore.opp}{projScore.tie ? `–${projScore.tie}` : ''}</div>
        </div>
        <div className="gn-team" style={{ textAlign: 'right' }}>
          <div className="gn-name">{opp?.name || 'No opponent'}</div>
          <div className="meta">{counting(players.opp)} still to play tonight</div>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="gn-alerts">
          {alerts.map((a, i) => <div key={i} className={`notice ${a.level === 'action' ? 'action' : 'err'}`}><b>{a.when === 'tomorrow' ? 'TOMORROW' : 'TODAY'}:</b> {a.text}</div>)}
        </div>
      )}

      <div className="table-wrap">
        <table className="gn-cats">
          <thead>
            <tr><th>Cat</th><th>You</th><th>Opp</th><th title="Live from tonight's box scores (active slots only)">Tonight</th><th>Proj. final</th></tr>
          </thead>
          <tbody>
            {categories.map(c => (
              <tr key={c.id} className={c.close ? 'gn-close' : ''}>
                <td className="stat">{c.name}{c.close && <span className="tag tag-gold">swing</span>}</td>
                <td className={`stat ${c.leader === 'me' ? 'win' : c.leader === 'opp' ? 'lose' : ''}`}>{fmtCat(c, c.me)}</td>
                <td className={`stat ${c.leader === 'opp' ? 'win' : c.leader === 'me' ? 'lose' : ''}`}>{fmtCat(c, c.opp)}</td>
                <td className="stat meta">{fmtCat(c, c.tonightMe)} / {fmtCat(c, c.tonightOpp)}</td>
                <td className={`stat ${c.projLeader === 'me' ? 'win' : c.projLeader === 'opp' ? 'lose' : ''}`}>
                  {fmtCat(c, c.projMe)} / {fmtCat(c, c.projOpp)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="meta" style={{ margin: '6px 0 20px' }}>
        Week totals are Yahoo's official numbers (can lag a few minutes). "Tonight" is straight from the NBA live feed.
        Projection adds per-game averages for remaining games through {data.weekEnd}.
      </p>

      <div className="gn-games">
        {games.map(g => (
          <div key={g.gameId} className={`gn-game ${g.status === 2 ? 'live' : ''}`}>
            <div className="stat">{g.away} {g.status > 1 ? g.awayScore : ''}</div>
            <div className="stat">{g.home} {g.status > 1 ? g.homeScore : ''}</div>
            <div className="meta">{g.status === 1 ? tipTime(g.utc) : g.statusText}</div>
          </div>
        ))}
        {!games.length && <div className="meta">No NBA games on the live scoreboard today.{data.feedError ? ` (${data.feedError})` : ''}</div>}
      </div>

      <div className="tabs">
        <button className={`tab ${side === 'me' ? 'active' : ''}`} onClick={() => setSide('me')}>{me.name}</button>
        {opp && <button className={`tab ${side === 'opp' ? 'active' : ''}`} onClick={() => setSide('opp')}>{opp.name}</button>}
      </div>
      <div className="gn-players">
        {roster.map(p => (
          <div key={p.key} className={`gn-player ${p.active ? '' : 'benched'} ${p.game?.status === 2 ? 'live' : ''}`}>
            <div className="gn-prow">
              <span className="pos-badge">{p.slot || '–'}</span>
              <span className="pname">{p.name}</span>
              {p.live?.onCourt && <span className="oncourt" title="On the court">●</span>}
              <span className="meta">{p.team}</span>
              {p.status && <span className="status-out meta">{p.status}</span>}
              <span className="meta gn-gstat">{gameLabel(p.game)}</span>
            </div>
            {p.live && <div className="gn-line stat">{liveLine(p.live)}</div>}
            {!p.active && p.game && p.game.status !== 3 && !['IL', 'IL+'].includes(p.slot) && <div className="meta status-gtd">Bench — not counting</div>}
          </div>
        ))}
      </div>

      <div className="gn-footer meta">
        Updated {new Date(data.asOf).toLocaleTimeString()} {error && <span className="status-out">· refresh failed: {error}</span>}
        <label style={{ marginLeft: 12 }}><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> auto-refresh ({liveCount ? '30s' : '5m'})</label>
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 12 }} onClick={fetchData}>Refresh now</button>
      </div>
    </div>
  );
}
