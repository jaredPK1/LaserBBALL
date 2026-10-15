import { useEffect, useState } from 'react';
import axios from 'axios';
import { startAuth, clearTokens, getYahooCheck } from '../api/yahoo';
import PageHeader from '../components/PageHeader';

// NBA seasons straddle two years; Yahoo labels them by the starting year
const currentSeason = () => {
  const d = new Date();
  return String(d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1);
};

function verdict(check, authed) {
  if (!authed || !check?.session) return { tone: 'warn', text: 'Not connected to Yahoo.', next: 'Use step 4 below to connect.' };
  const calls = Object.values(check.calls || {});
  if (calls.length && calls.every(c => c.status === 403)) {
    return { tone: 'err', text: 'Yahoo is refusing this app (403).', next: 'Yahoo hasn’t switched on Fantasy API access for the app yet. Nothing to fix on your side.' };
  }
  const leagues = Array.isArray(check.nbaLeagues) ? check.nbaLeagues : null;
  if (!leagues) return { tone: 'err', text: 'Couldn’t list your leagues.', next: check.nbaLeagues?.error || 'Try again in a minute.' };
  const season = currentSeason();
  const now = leagues.filter(l => String(l.season) === season);
  if (now.length) return { tone: 'ok', text: `Connected. This season: ${now.map(l => l.name).join(', ')}.`, next: '' };
  if (leagues.length) {
    return { tone: 'warn', text: 'Right kind of account, but no league for this season yet.', next: 'Your league has older seasons on this account, so it hasn’t been renewed on Yahoo for this season. Ask your commissioner to renew it and enter the draft results.' };
  }
  return { tone: 'warn', text: 'This Yahoo account has no NBA leagues.', next: 'You’re probably signed into a different Yahoo account than the one in your league. Follow “Switch Yahoo account” below.' };
}

export default function Settings({ authed }) {
  const [check, setCheck] = useState(null);
  const [checking, setChecking] = useState(false);
  const [sync, setSync] = useState(null);

  const runCheck = async () => {
    setChecking(true);
    try { setCheck((await getYahooCheck()).data); } catch (e) { setCheck({ failed: e.message }); }
    setChecking(false);
  };

  useEffect(() => {
    let live = true;
    getYahooCheck().then(r => live && setCheck(r.data)).catch(e => live && setCheck({ failed: e.message }));
    axios.get('/api/me/draft').then(r => live && setSync(r.data)).catch(() => live && setSync({ failed: true }));
    return () => { live = false; };
  }, []);

  const v = check ? verdict(check, authed) : null;
  const leagues = Array.isArray(check?.nbaLeagues) ? check.nbaLeagues : [];

  return (
    <div>
      <PageHeader title="Settings" subtitle="Yahoo connection, account switching and sync" />

      <section className="card">
        <h3>Yahoo connection</h3>
        {!check ? <p className="meta">Checking…</p> : (
          <>
            <p className={`settings-verdict settings-${v.tone}`}>{v.text}</p>
            {v.next && <p className="settings-note">{v.next}</p>}
            {leagues.length > 0 && (
              <ul className="settings-leagues">
                {leagues.map(l => (
                  <li key={l.leagueKey}>
                    <span>{l.name}</span>
                    <span className={`tag ${String(l.season) === currentSeason() ? 'tag-green' : ''}`}>{l.season}–{String(Number(l.season) + 1).slice(2)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <button className="btn btn-ghost btn-sm" onClick={runCheck} disabled={checking}>{checking ? 'Checking…' : 'Check again'}</button>
      </section>

      <section className="card">
        <h3>Switch Yahoo account</h3>
        <p className="settings-note">Use this when the app is signed into a different Yahoo account than the one in your league. Do the steps in order, in this browser.</p>
        <ol className="settings-steps">
          <li>
            <strong>Find the right account.</strong> In Yahoo Fantasy, open your profile and note the account that shows your league.
            <div><a className="btn btn-ghost btn-sm" href="https://sports.yahoo.com/fantasy/" target="_blank" rel="noopener noreferrer">Open Yahoo Fantasy ↗</a></div>
          </li>
          <li>
            <strong>Disconnect this app.</strong>
            <div>
              <button className="btn btn-ghost btn-sm" disabled={!authed}
                onClick={async () => { await clearTokens(); window.location.reload(); }}>
                {authed ? 'Disconnect' : 'Already disconnected'}
              </button>
            </div>
          </li>
          <li>
            <strong>Sign out of Yahoo.</strong> On Yahoo, tap your name or picture, then <em>Sign out</em> (all accounts if it lists several).
            <div><a className="btn btn-ghost btn-sm" href="https://login.yahoo.com/" target="_blank" rel="noopener noreferrer">Open Yahoo sign-in page ↗</a></div>
          </li>
          <li>
            <strong>Connect with the right account.</strong> Yahoo will ask you to sign in; use the account from step 1.
            <div><button className="btn btn-primary btn-sm" onClick={() => startAuth({ switchAccount: true })}>Connect Yahoo</button></div>
          </li>
          <li>
            <strong>Check it worked.</strong> The Yahoo connection box above should list your league for this season.
            <div><button className="btn btn-ghost btn-sm" onClick={runCheck} disabled={checking}>Check connection</button></div>
          </li>
        </ol>
        <p className="meta">Yahoo emails a “New sign in” notice each time you connect. That one is expected.</p>
      </section>

      <section className="card">
        <h3>Draft board sync</h3>
        {!sync ? <p className="meta">Checking…</p>
          : sync.failed ? <p className="settings-verdict settings-err">Couldn’t reach the sync server.</p>
          : !sync.configured ? <p className="settings-verdict settings-warn">Cloud sync isn’t set up on the server.</p>
          : <p className="settings-verdict settings-ok">
              On. Same draft on every device{sync.doc ? ` · ${sync.doc.picks?.length || 0} picks · last saved ${new Date(sync.doc.updatedAt).toLocaleString()}` : ''}.
            </p>}
        <p className="settings-note">No login needed. Anyone who opens the draft board link can see and edit it, so keep the link to yourself.</p>
      </section>
    </div>
  );
}
