import { useEffect, useState } from 'react';
import { getLineupConfig, setLineupMode, startAuth, getNotifyConfig, sendTestNotification, saveDiscordWebhook } from '../api/yahoo';

const MODES = [
  ['off', 'Off', 'Nothing runs at night.'],
  ['suggest', 'Suggest', 'Each evening (about 9pm ET) the app works out tomorrow’s best lineup and posts the moves to your Discord. You make them in Yahoo.'],
  ['auto', 'Auto', 'Each evening (about 9pm ET) the app sets tomorrow’s lineup in Yahoo for you.'],
];
const when = iso => new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });

// Settings card: nightly lineup mode, roster-edit permission, last run
export default function NightlyLineup() {
  const [cfg, setCfg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notify, setNotify] = useState(null);
  const [test, setTest] = useState(null);
  const [hook, setHook] = useState('');
  const saveHook = () => {
    setTest(null);
    saveDiscordWebhook(hook).then(r => { setNotify(r.data); setHook(''); return sendTestNotification(); })
      .then(r => setTest(r.data.sent ? 'Connected: check your Discord channel.' : r.data.reason))
      .catch(e => setTest(e.response?.data?.error || e.message));
  };

  useEffect(() => {
    let live = true;
    getLineupConfig().then(r => live && setCfg(r.data)).catch(e => live && setError(e.response?.data?.error || e.message));
    getNotifyConfig().then(r => live && setNotify(r.data)).catch(() => {});
    return () => { live = false; };
  }, []);

  const choose = mode => {
    setBusy(true); setError(null);
    setLineupMode(mode).then(r => setCfg(r.data)).catch(e => setError(e.response?.data?.error || e.message)).finally(() => setBusy(false));
  };

  const run = cfg?.lastRun;
  return (
    <section className="card">
      <h3>Nightly lineup</h3>
      {error && <p className="settings-verdict settings-err">{error}</p>}
      {!cfg ? <p className="meta">Loading…</p> : (
        <>
          <div className="lineup-modes">
            {MODES.map(([m, label]) => (
              <button key={m} className={`btn btn-sm ${cfg.mode === m ? 'btn-primary' : 'btn-ghost'}`} disabled={busy} onClick={() => choose(m)}>{label}</button>
            ))}
          </div>
          <p className="settings-note">{MODES.find(([m]) => m === cfg.mode)?.[2]} It benches anyone who’s out or has no game and starts your best available players, rearranging positions so every slot is filled.</p>
          {cfg.mode === 'auto' && cfg.canWrite === false && (
            <p className="notice action">Auto needs permission to edit your roster, and the app only has read access right now. Allow it below.</p>
          )}
          {notify && (
            <div className="notify-setup">
              <p className="settings-note"><b>Discord</b> {notify.connected ? <span className="tag tag-green">Connected</span> : <span className="tag">Not connected</span>}</p>
              {!notify.fromEnv && (
                <>
                  <ol className="settings-steps">
                    <li>In Discord, open your server → the channel you want → <b>Edit Channel → Integrations → Webhooks → New Webhook</b>.</li>
                    <li><b>Copy Webhook URL</b> and paste it here. It’s stored encrypted; don’t share it anywhere else.</li>
                  </ol>
                  <div className="notify-row">
                    <input type="password" className="notify-input" placeholder="https://discord.com/api/webhooks/…" value={hook} onChange={e => setHook(e.target.value)} autoComplete="off" />
                    <button className="btn btn-primary btn-sm" disabled={!hook} onClick={saveHook}>{notify.connected ? 'Replace' : 'Connect'}</button>
                  </div>
                </>
              )}
              {notify.connected && <button className="btn btn-ghost btn-sm" onClick={() => sendTestNotification().then(r => setTest(r.data.sent ? 'Sent: check Discord.' : r.data.reason)).catch(e => setTest(e.message))}>Send test</button>}
              {test && <span className="meta"> {test}</span>}
              <p className="meta">You only get a message when there’s something to change.</p>
            </div>
          )}
          <div>
            <button className="btn btn-ghost btn-sm" onClick={() => startAuth({ write: true })}>Allow lineup changes</button>
            <span className="meta"> {cfg.canWrite ? 'Roster edits allowed ✓' : 'Only for Auto. Needs a Yahoo app with Fantasy Read/Write.'}</span>
          </div>
          <p className="meta">Yahoo may email you a “new sign in” notice on nights the job runs.</p>
          {run && (
            <p className={`settings-verdict ${run.error ? 'settings-err' : run.applied ? 'settings-ok' : ''}`}>
              Last run {when(run.ranAt)}{run.date ? ` for ${run.date}` : ''}: {run.error || (run.applied ? 'lineup set' : run.steps?.length ? `${run.steps.length} change${run.steps.length === 1 ? '' : 's'} suggested${run.reason && run.mode === 'auto' ? ` (not applied: ${run.reason})` : ''}` : 'lineup already right')}.
              {run.steps?.length > 0 && <><br />{run.steps.join(' · ')}</>}
            </p>
          )}
        </>
      )}
    </section>
  );
}
