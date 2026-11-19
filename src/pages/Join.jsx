import { useEffect, useState } from 'react';
import { getJoinTeams, joinIntel } from '../api/yahoo';

const errOf = e => e.response?.data?.error || e.message;

// Public sign-up for a league-mate's private morning intel (no Yahoo login)
export default function Join() {
  const code = new URLSearchParams(window.location.search).get('code') || '';
  const [teams, setTeams] = useState(null);
  const [error, setError] = useState(code ? null : 'This page needs the sign-up link from your league’s Discord.');
  const [team, setTeam] = useState('');
  const [hook, setHook] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    if (!code) return undefined;
    let live = true;
    getJoinTeams(code).then(r => live && setTeams(r.data.teams)).catch(e => live && setError(errOf(e)));
    return () => { live = false; };
  }, [code]);

  const submit = () => {
    setBusy(true); setError(null);
    joinIntel({ code, teamKey: team, webhook: hook }).then(r => setDone(r.data.team)).catch(e => setError(errOf(e))).finally(() => setBusy(false));
  };

  return (
    <div className="join-page">
      <h1>Private morning intel</h1>
      <p className="settings-note">Every morning (about 8am ET) your own Discord channel gets: your matchup odds with a chart, last night’s recap, tomorrow’s best lineup moves, and what to watch. No Yahoo login needed.</p>
      {done ? (
        <p className="settings-verdict settings-ok">You’re signed up for <b>{done}</b>. Check your channel for the welcome message. Your first report comes tomorrow morning.</p>
      ) : (
        <section className="card">
          <ol className="settings-steps">
            <li><b>Make a private channel</b> in your league’s Discord server, just for you.</li>
            <li>In that channel’s settings: <b>Integrations → Webhooks → New Webhook → Copy Webhook URL</b>.</li>
            <li>Pick your team and paste the webhook below.</li>
          </ol>
          <p className="meta">Can’t create a channel or webhook? Ask your commissioner to make your private channel and give you Manage Webhooks on it.</p>
          {error && <p className="settings-verdict settings-err">{error}</p>}
          {teams && (
            <>
              <label className="join-field">
                <span>Your team</span>
                <select value={team} onChange={e => setTeam(e.target.value)}>
                  <option value="">Choose…</option>
                  {teams.map(t => <option key={t.key} value={t.key}>{t.name}{t.manager ? ` (${t.manager})` : ''}{t.signedUp ? ' · signed up' : ''}</option>)}
                </select>
              </label>
              <label className="join-field">
                <span>Webhook URL</span>
                <input type="password" className="notify-input" placeholder="https://discord.com/api/webhooks/…" value={hook} onChange={e => setHook(e.target.value)} autoComplete="off" />
              </label>
              <button className="btn btn-primary" disabled={!team || !hook || busy} onClick={submit}>{busy ? 'Checking…' : 'Sign up'}</button>
              <p className="meta">The webhook is stored encrypted and only used to post your report. Treat it like a password. To stop, delete the webhook in Discord.</p>
            </>
          )}
          {!teams && !error && <p className="meta">Loading teams…</p>}
        </section>
      )}
    </div>
  );
}
