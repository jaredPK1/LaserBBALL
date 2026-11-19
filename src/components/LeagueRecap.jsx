import { useEffect, useState } from 'react';
import { getNotifyConfig, saveLeagueWebhook, getRecapConfig, setRecapOn, previewRecap, sendRecapNow, previewMonday } from '../api/yahoo';

const errOf = e => e.response?.data?.error || e.message;
// Discord markdown → plain text for the in-app preview
const plain = s => String(s || '').replace(/\*\*/g, '');

// Settings card: the league-wide morning recap ("The Morning Whistle")
export default function LeagueRecap() {
  const [notify, setNotify] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [hook, setHook] = useState('');
  const [msg, setMsg] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    getNotifyConfig().then(r => live && setNotify(r.data)).catch(e => live && setMsg(errOf(e)));
    getRecapConfig().then(r => live && setCfg(r.data)).catch(() => {});
    return () => { live = false; };
  }, []);

  const connect = () => saveLeagueWebhook(hook).then(r => { setNotify(r.data); setHook(''); setMsg('League channel connected.'); }).catch(e => setMsg(errOf(e)));
  const toggle = () => setRecapOn(!cfg.on).then(r => setCfg(r.data)).catch(e => setMsg(errOf(e)));
  const run = (fn, done) => { setBusy(true); setMsg(null); fn().then(done).catch(e => setMsg(errOf(e))).finally(() => setBusy(false)); };

  return (
    <section className="card">
      <h3>League recap · The Morning Whistle</h3>
      <p className="settings-note">Every morning (about 9am ET) a fun recap goes to your league’s Discord channel: every matchup’s score and odds, categories that changed hands overnight, stars of the night, a stat corner, and the projected standings. Mondays add last week’s results and power rankings, plus a Monday special at 10am ET: playoff odds, awards, rivalry history, the Trade Desk and pick’em results. It treats every team the same and never includes your private advice.</p>
      {notify && (
        <>
          <p className="settings-note"><b>League channel</b> {notify.league ? <span className="tag tag-green">Connected</span> : <span className="tag">Not connected</span>}</p>
          <p className="meta">In the league’s Discord channel: Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL, then paste it here (not in chats).</p>
          <div className="notify-row">
            <input type="password" className="notify-input" placeholder="https://discord.com/api/webhooks/…" value={hook} onChange={e => setHook(e.target.value)} autoComplete="off" />
            <button className="btn btn-primary btn-sm" disabled={!hook} onClick={connect}>{notify.league ? 'Replace' : 'Connect'}</button>
          </div>
        </>
      )}
      <div className="lineup-modes">
        {cfg && <button className={`btn btn-sm ${cfg.on ? 'btn-primary' : 'btn-ghost'}`} onClick={toggle}>{cfg.on ? 'Daily recap: on' : 'Daily recap: off'}</button>}
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(previewRecap, r => setPreview(r.data.embeds))}>{busy ? 'Working…' : 'Preview'}</button>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(previewMonday, r => setPreview(r.data.embeds))}>Preview Monday special</button>
        {notify?.league && <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(sendRecapNow, r => setMsg(r.data.sent ? 'Posted to the league channel.' : r.data.reason))}>Send now</button>}
      </div>
      {msg && <p className="meta">{msg}</p>}
      {cfg?.lastRun && <p className="meta">Last post {new Date(cfg.lastRun.ranAt).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}: {cfg.lastRun.error || (cfg.lastRun.sent ? 'sent' : cfg.lastRun.reason || 'not sent')}.</p>}
      {preview && (
        <div className="recap-preview">
          {preview.map((e, i) => (
            <div key={i} className="recap-embed">
              <b>{e.title}</b>
              {e.description && <p>{plain(e.description)}</p>}
              {e.fields?.map((f, j) => <div key={j} className="recap-field"><b>{plain(f.name)}</b><p>{plain(f.value)}</p></div>)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
