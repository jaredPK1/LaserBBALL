import { useEffect, useState } from 'react';
import { getAlerts } from '../api/yahoo';

// Injuries and tomorrow's lineup fixes. Lineups lock a day ahead in this
// league, so "tomorrow" items are the ones you can still act on.
export default function AlertsCard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    getAlerts().then(r => live && setData(r.data)).catch(e => live && setError(e.response?.data?.error || e.message));
    return () => { live = false; };
  }, []);

  if (error) return <section className="card"><h3>Alerts</h3><p className="settings-verdict settings-err">{error}</p></section>;
  if (!data) return <section className="card"><h3>Alerts</h3><p className="meta">Checking injuries and tomorrow’s lineup…</p></section>;

  const actions = data.alerts.filter(a => a.level === 'action');
  return (
    <section className={`card ${actions.length ? 'alerts-hot' : ''}`}>
      <h3>Alerts {actions.length > 0 && <span className="tag tag-red">{actions.length} to do</span>}</h3>
      {data.alerts.length === 0 && <p className="settings-verdict settings-ok">All clear: no injuries and tomorrow’s lineup is set.</p>}
      <ul className="alerts-list">
        {data.alerts.map((a, i) => (
          <li key={i} className={a.level}>
            <span className="tag">{a.kind === 'injury' ? 'Injury' : 'Lineup'}{a.when === 'tomorrow' ? ' · tomorrow' : ''}</span> {a.text}
          </li>
        ))}
      </ul>
      {data.replacements?.length > 0 && (
        <>
          <p className="settings-note"><b>Best available replacements</b> (rest-of-season rank, closest positional fit first):</p>
          <ul className="alerts-list">
            {data.replacements.map(r => (
              <li key={r.name}>{r.name} <span className="meta">{r.team} · {r.pos} · #{r.rosRank}{r.fits ? ' · fits' : ''}</span></li>
            ))}
          </ul>
        </>
      )}
      <p className="meta">IL slots used: {data.ilUsed} of {data.ilCapacity}. Lineup changes in your league take effect tomorrow.</p>
    </section>
  );
}
