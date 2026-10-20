import { useEffect, useState } from 'react';
import { getTrade } from '../api/yahoo';
import PageHeader from '../components/PageHeader';

const pct = p => `${Math.round(p * 100)}%`;
const signed = (v, d = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;

export default function Trade() {
  const [league, setLeague] = useState(null);
  const [error, setError] = useState(null);
  const [partner, setPartner] = useState('');
  const [give, setGive] = useState([]);
  const [get, setGet] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    getTrade().then(r => live && setLeague(r.data)).catch(e => live && setError(e.response?.data?.error || e.message));
    return () => { live = false; };
  }, []);

  const toggle = (list, set, key) => { set(list.includes(key) ? list.filter(k => k !== key) : [...list, key]); setResult(null); };

  const check = async () => {
    setBusy(true); setError(null);
    try {
      setResult((await getTrade({ partner, give: give.join(','), get: get.join(',') })).data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
    setBusy(false);
  };

  if (!league) {
    return (
      <div>
        <PageHeader title="Trade Checker" />
        {error ? <div className="error-state"><h3>Couldn’t load rosters</h3><p>{error}</p></div> : <p className="meta">Loading every roster in the league…</p>}
      </div>
    );
  }

  const them = league.teams.find(t => t.key === partner);
  return (
    <div>
      <PageHeader title="Trade Checker" subtitle="Simulates your season before and after a trade: average category wins per week against every team" />

      <section className="card">
        <label className="trade-partner">
          <span>Trade with</span>
          <select value={partner} onChange={e => { setPartner(e.target.value); setGet([]); setResult(null); }}>
            <option value="">Choose a team…</option>
            {league.teams.map(t => <option key={t.key} value={t.key}>{t.name}{t.manager ? ` (${t.manager})` : ''}</option>)}
          </select>
        </label>
        <div className="trade-cols">
          <div>
            <h3>You give</h3>
            <PlayerList players={league.me.players} picked={give} onToggle={k => toggle(give, setGive, k)} />
          </div>
          <div>
            <h3>You get</h3>
            {them ? <PlayerList players={them.players} picked={get} onToggle={k => toggle(get, setGet, k)} /> : <p className="meta">Choose a team first.</p>}
          </div>
        </div>
        <button className="btn btn-primary" disabled={!partner || (!give.length && !get.length) || busy} onClick={check}>
          {busy ? 'Simulating…' : 'Check this trade'}
        </button>
        {error && <p className="settings-verdict settings-err">{error}</p>}
        <p className="meta">#rank = rest-of-season rank for your build (assists punted).</p>
      </section>

      {result && (
        <section className="card">
          <h3>{result.give.join(', ') || 'nothing'} for {result.get.join(', ') || 'nothing'}</h3>
          <div className="trade-verdict">
            <div>
              <div className={`tw-big ${result.me.change >= 0 ? 'settings-ok' : 'settings-err'}`}>{signed(result.me.change)}</div>
              <div className="meta">your category wins per week ({result.me.before.toFixed(2)} → {result.me.after.toFixed(2)})</div>
            </div>
            <div>
              <div className={`tw-big ${result.partnerResult.change >= 0 ? 'settings-ok' : 'settings-err'}`}>{signed(result.partnerResult.change)}</div>
              <div className="meta">{result.partner.manager || result.partner.name}’s change</div>
            </div>
          </div>
          <p className="settings-note">{verdict(result)}</p>
          <div className="table-wrap">
            <table className="gn-cats">
              <thead><tr><th>Cat</th><th>Change</th><th>Before</th><th>After</th></tr></thead>
              <tbody>
                {result.me.cats.map(c => (
                  <tr key={c.name}>
                    <td className="stat">{c.name}</td>
                    <td className={`stat ${c.change > 0.01 ? 'win' : c.change < -0.01 ? 'lose' : ''}`}>{signed(c.change * 100, 0)} pts</td>
                    <td className="stat">{pct(c.before)}</td>
                    <td className="stat">{pct(c.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="meta">
            Win chance per category, averaged over every opponent. Uses ESPN projections and each player’s projected games played.
            {result.rosterChange !== 0 && ` This trade ${result.rosterChange > 0 ? `needs ${result.rosterChange} open roster spot${result.rosterChange > 1 ? 's' : ''} (you’d drop someone)` : `opens ${-result.rosterChange} roster spot${result.rosterChange < -1 ? 's' : ''} for a free agent`}, which isn’t counted here.`}
            {result.unrated.length > 0 && ` No projections for ${result.unrated.join(', ')}.`}
          </p>
        </section>
      )}
    </div>
  );
}

function PlayerList({ players, picked, onToggle }) {
  return (
    <ul className="trade-list">
      {players.map(p => (
        <li key={p.key}>
          <label>
            <input type="checkbox" checked={picked.includes(p.key)} onChange={() => onToggle(p.key)} />
            <span>{p.name}</span>
            <span className="meta">{p.pos}{p.status ? ` · ${p.status}` : ''}{p.rosRank ? ` · #${p.rosRank}` : ''}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function verdict(r) {
  const me = r.me.change, them = r.partnerResult.change;
  if (me <= 0.02) return 'This doesn’t help you. Skip it, or ask for more.';
  if (them >= 0) return 'Helps you, and it helps them too: a realistic pitch. Lead with what they gain.';
  if (them > -0.15) return 'Helps you and costs them only a little. Worth pitching, framed around the categories they gain.';
  return 'Great for you, clearly bad for them. Expect a no unless they value these players differently.';
}
