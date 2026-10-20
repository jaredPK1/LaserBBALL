import { useEffect, useState } from 'react';
import { getPlayoffs } from '../api/yahoo';
import PageHeader from '../components/PageHeader';

const dayLabel = ymd => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function Playoffs() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    getPlayoffs().then(r => live && setData(r.data)).catch(e => live && setError(e.response?.data?.error || e.message));
    return () => { live = false; };
  }, []);

  if (error) return <div><PageHeader title="Playoff Planner" /><div className="error-state"><h3>Couldn’t load the playoff schedule</h3><p>{error}</p></div></div>;
  if (!data) return <div><PageHeader title="Playoff Planner" /><p className="meta">Counting playoff games…</p></div>;

  const avg = data.leagueAvgTotal;
  const tone = total => (total >= avg + 1 ? 'win' : total <= avg - 1 ? 'lose' : '');
  const myTotal = data.mine.reduce((a, p) => a + p.total, 0);
  const top = data.teams.slice(0, 8);
  const bottom = data.teams.slice(-6).reverse();

  return (
    <div>
      <PageHeader
        title="Playoff Planner"
        subtitle={`Weeks ${data.weeks[0].week}–${data.weeks.at(-1).week} · ${dayLabel(data.weeks[0].start)} – ${dayLabel(data.weeks.at(-1).end)} · trade deadline ${dayLabel(data.tradeDeadline)}`}
      />
      <p className="settings-note">
        The team with the most games played tends to win the playoffs. Use this before the trade deadline: trade for players on busy schedules, away from light ones.
        Average NBA team: {avg.toFixed(1)} games across the three weeks.
      </p>

      <section className="card">
        <h3>Your roster ({myTotal} player-games)</h3>
        <div className="table-wrap">
          <table className="gn-cats">
            <thead><tr><th>Player</th>{data.weeks.map(w => <th key={w.week}>Wk {w.week}</th>)}<th>Total</th></tr></thead>
            <tbody>
              {data.mine.map(p => (
                <tr key={p.name}>
                  <td className="stat">{p.name} <span className="meta">{p.team}</span></td>
                  {p.games.map((g, i) => <td key={i} className="stat">{g}</td>)}
                  <td className={`stat ${tone(p.total)}`}><b>{p.total}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="meta">Green = at least one game above average, grey = at least one below.</p>
      </section>

      <div className="po-cols">
        <section className="card">
          <h3>Busiest teams</h3>
          <ul className="alerts-list">{top.map(t => <li key={t.team}><b>{t.team}</b> {t.total} <span className="meta">({t.games.join(' / ')})</span></li>)}</ul>
        </section>
        <section className="card">
          <h3>Lightest teams</h3>
          <ul className="alerts-list">{bottom.map(t => <li key={t.team}><b>{t.team}</b> {t.total} <span className="meta">({t.games.join(' / ')})</span></li>)}</ul>
        </section>
      </div>
    </div>
  );
}
