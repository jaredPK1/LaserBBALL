import { useEffect, useState } from 'react';
import { getLineupConfig, setLineupMode, startAuth } from '../api/yahoo';

const MODES = [
  ['off', 'Off', 'Nothing runs at night.'],
  ['suggest', 'Suggest', 'Each evening the app works out tomorrow’s best lineup and shows it in Alerts. You make the moves.'],
  ['auto', 'Auto', 'Each evening (about 9pm ET) the app sets tomorrow’s lineup in Yahoo for you.'],
];
const when = iso => new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });

// Settings card: nightly lineup mode, roster-edit permission, last run
export default function NightlyLineup() {
  const [cfg, setCfg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    getLineupConfig().then(r => live && setCfg(r.data)).catch(e => live && setError(e.response?.data?.error || e.message));
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
          <div>
            <button className="btn btn-ghost btn-sm" onClick={() => startAuth({ write: true })}>Allow lineup changes</button>
            <span className="meta"> {cfg.canWrite ? 'Roster edits allowed ✓' : 'Signs you in to Yahoo once more, asking for permission to set your lineup.'}</span>
          </div>
          <p className="meta">First, in the Yahoo developer dashboard (developer.yahoo.com/apps), set this app’s Fantasy Sports permission to Read/Write. Yahoo emails you a “new sign in” notice each night the job runs.</p>
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
