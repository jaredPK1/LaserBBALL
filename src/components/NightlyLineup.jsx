import { useEffect, useState } from 'react';
import { getLineupConfig, setLineupMode, startAuth, getNotifyConfig, sendTestNotification } from '../api/yahoo';

const MODES = [
  ['off', 'Off', 'Nothing runs at night.'],
  ['suggest', 'Suggest', 'Each evening (about 9pm ET) the app works out tomorrow’s best lineup and sends the moves to your phone. You make them in Yahoo.'],
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
              <p className="settings-note"><b>Get it on your phone</b> (free, no account):</p>
              <ol className="settings-steps">
                <li>Install the <b>ntfy</b> app (App Store or Google Play).</li>
                <li>Tap <b>+</b>, and subscribe to this topic: <code className="notify-topic">{notify.topic}</code></li>
                <li>Send a test: <button className="btn btn-ghost btn-sm" onClick={() => sendTestNotification().then(r => setTest(r.data.sent ? 'Sent: check your phone.' : r.data.reason)).catch(e => setTest(e.message))}>Send test</button> {test && <span className="meta">{test}</span>}</li>
              </ol>
              <p className="meta">Keep the topic private: anyone who has it can read your lineup notes. You only get a notification when there’s something to change.</p>
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
