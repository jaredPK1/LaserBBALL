import { useEffect, useState } from 'react';
import { getTrade, getTradeIdeas } from '../api/yahoo';
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

  const check = async (pk = partner, gv = give, gt = get) => {
    setBusy(true); setError(null);
    try {
      setResult((await getTrade({ partner: pk, give: gv.join(','), get: gt.join(',') })).data);
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

      <TradeIdeas onCheck={d => {
        setPartner(d.partner.key); setGive(d.giveKeys); setGet([d.getKey]);
        check(d.partner.key, d.giveKeys, [d.getKey]);
      }} />

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
        <button className="btn btn-primary" disabled={!partner || (!give.length && !get.length) || busy} onClick={() => check()}>
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

function TradeIdeas({ onCheck }) {
  const [ideas, setIdeas] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const find = () => {
    setBusy(true); setErr(null);
    getTradeIdeas().then(r => setIdeas(r.data)).catch(e => setErr(e.response?.data?.error || e.message)).finally(() => setBusy(false));
  };
  return (
    <section className="card">
      <div className="tw-addshead">
        <h3>Trade ideas you can sell</h3>
        <button className="btn btn-ghost btn-sm" onClick={find} disabled={busy}>{busy ? 'Searching…' : ideas ? 'Search again' : 'Find trades'}</button>
      </div>
      <p className="settings-note">Tries every 1-for-1 and 2-for-1 with every team. Keeps only deals that help you and don’t hurt them, so you can pitch each one on what they gain. Win-wins first.</p>
      {err && <p className="settings-verdict settings-err">{err}</p>}
      {ideas && ideas.ideas.length === 0 && <p className="meta">No deal found that helps you without hurting the other team. Check again after injuries or hot streaks shift values.</p>}
      {ideas && ideas.ideas.length > 0 && (
        <ul className="trade-ideas">
          {ideas.ideas.map((d, i) => (
            <li key={i}>
              <div>
                <b>{d.give.join(' + ')}</b> for <b>{d.get}</b> <span className="meta">with {d.partner.manager || d.partner.name}</span>
                {d.winWin && <span className="tag tag-green">Win-win</span>}
              </div>
              <div className="meta">
                You {signed(d.myGain)} cats/week{d.youGain.length ? ` (${d.youGain.join(', ')})` : ''} · them {signed(d.theirGain)}{d.theyGain.length ? ` (${d.theyGain.join(', ')})` : ''}
              </div>
              {d.theyGain.length > 0 && <div className="meta">Pitch: “This helps your {d.theyGain.join(' and ')}.”</div>}
              {d.note && <div className="meta">{d.note}</div>}
              <button className="btn btn-ghost btn-sm" onClick={() => onCheck(d)}>Check it below</button>
            </li>
          ))}
        </ul>
      )}
      {ideas && <p className="meta">Searched {ideas.searched} teams. Season view: injured players count at 75%.</p>}
    </section>
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
