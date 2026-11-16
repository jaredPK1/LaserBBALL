import { useState } from 'react';
import { sendExport } from '../api/yahoo';

// Saves a full league snapshot where Claude can read it (and offers it as a file)
export default function SendToClaude() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const send = () => {
    setBusy(true);
    sendExport().then(r => setState({ ok: true, ...r.data })).catch(e => setState({ ok: false, error: e.response?.data?.error || e.message })).finally(() => setBusy(false));
  };
  const failed = state?.ok ? Object.entries(state.sections || {}).filter(([, v]) => v !== 'ok') : [];
  return (
    <section className="card">
      <div className="tw-addshead">
        <h3>Send league data to Claude</h3>
        <button className="btn btn-primary btn-sm" onClick={send} disabled={busy}>{busy ? 'Gathering… (up to a minute)' : 'Send'}</button>
      </div>
      <p className="settings-note">Saves standings, every week’s category results, all rosters, this week’s projections, every free agent ranked for this week, power rankings and league transactions where Claude can read them. Press it, then tell Claude it’s sent.</p>
      {state && !state.ok && <p className="settings-verdict settings-err">{state.error}</p>}
      {state?.ok && (
        <p className={`settings-verdict ${failed.length || !state.stored ? 'settings-warn' : 'settings-ok'}`}>
          {state.stored ? `Sent at ${new Date(state.savedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.` : `Couldn’t save it to cloud storage (${state.storeError}). Download the file below and attach it in the Claude app instead.`}
          {failed.length > 0 && ` Missing: ${failed.map(([k]) => k).join(', ')}.`}
        </p>
      )}
      <p className="meta">Or <a href="/api/export?download=1">download it as a file</a> and attach it in the Claude app.</p>
    </section>
  );
}
