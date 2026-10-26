import { useEffect, useState } from 'react';
import { getReview } from '../api/yahoo';

const RESULT = { W: ['Won', 'tag-green'], L: ['Lost', 'tag-red'], T: ['Tied', 'tag-gold'] };
const fmt = (c, v) => (v == null ? '–' : c.pct ? v.toFixed(3).replace(/^0/, '') : Math.round(v));
const day = ymd => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

// Last week's final result next to what This Week projected, plus your moves
export default function ReviewCard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    getReview().then(r => live && setData(r.data)).catch(e => live && setError(e.response?.data?.error || e.message));
    return () => { live = false; };
  }, []);

  if (error) return <section className="card"><h3>Last week</h3><p className="settings-verdict settings-err">{error}</p></section>;
  if (!data || data.none) return null;
  const { record, projection: proj } = data;

  return (
    <section className="card">
      <div className="tw-addshead">
        <h3>Week {data.week} review{data.opp ? ` vs ${data.opp.name}` : ''}</h3>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Details'}</button>
      </div>
      <p>
        <b>{record.w}–{record.l}{record.t ? `–${record.t}` : ''}</b> in categories{data.final ? '' : ' (not final yet)'}.
        {proj
          ? <> Projected {proj.expectedWins.toFixed(1)} wins (as of {new Date(proj.savedAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}); the projection called {proj.right} of {proj.calls} clear-cut categories right.</>
          : <> No projection was saved for that week, so there’s nothing to grade it against.</>}
      </p>
      {open && (
        <>
          <div className="table-wrap">
            <table className="gn-cats">
              <thead><tr><th>Cat</th><th>Result</th><th>You</th><th>Them</th><th>Projected</th></tr></thead>
              <tbody>
                {data.categories.map(c => {
                  const [label, cls] = RESULT[c.result];
                  return (
                    <tr key={c.name}>
                      <td className="stat">{c.name}</td>
                      <td className="stat"><span className={`tag ${cls}`}>{label}</span></td>
                      <td className="stat">{fmt(c, c.mine)}</td>
                      <td className="stat">{fmt(c, c.opp)}</td>
                      <td className="stat">{c.projWin == null ? '–' : `${Math.round(c.projWin * 100)}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="settings-note"><b>Your moves ({day(data.start)} – {day(data.end)}):</b>{' '}
            {data.moves == null ? 'Yahoo didn’t return transactions.'
              : data.moves.length === 0 ? 'none.'
              : data.moves.map((m, i) => <span key={i} className={`tag ${m.type === 'add' ? 'tag-green' : 'tag-red'}`}>{m.type === 'add' ? '+' : '−'} {m.name}</span>)}
          </p>
          <p className="meta">“Projected” is your win chance for that category the first time you opened This Week that week.</p>
        </>
      )}
    </section>
  );
}
