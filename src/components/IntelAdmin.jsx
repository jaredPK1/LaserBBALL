import { useEffect, useState } from 'react';
import { getIntelAdmin, intelAdminAction, postIntelInstructions } from '../api/yahoo';

const errOf = e => e.response?.data?.error || e.message;
const when = iso => (iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '–');

// Settings card: league-mates' private intel sign-ups
export default function IntelAdmin() {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    let live = true;
    getIntelAdmin().then(r => live && setData(r.data)).catch(e => live && setMsg(errOf(e)));
    return () => { live = false; };
  }, []);

  const act = body => intelAdminAction(body).then(r => setData(r.data)).catch(e => setMsg(errOf(e)));
  const post = () => postIntelInstructions().then(r => setMsg(r.data.sent ? 'Posted to the league channel. Pin it in Discord so people can find it.' : r.data.reason)).catch(e => setMsg(errOf(e)));

  return (
    <section className="card">
      <h3>Private intel for the league</h3>
      <p className="settings-note">League-mates can get their own private morning report in their own Discord channel. They sign up with the link below; nobody else needs Yahoo. Reports go out with yours each morning.</p>
      {data && (
        <>
          <p className="settings-note">Sign-up link: <code className="notify-topic">{data.joinUrl}</code></p>
          <div className="lineup-modes">
            <button className="btn btn-primary btn-sm" onClick={post}>Post sign-up instructions to league channel</button>
            <button className="btn btn-ghost btn-sm" onClick={() => act({ regenerate: true })}>New link (old one stops working)</button>
          </div>
          {data.subs.length === 0 ? <p className="meta">No one has signed up yet.</p> : (
            <table className="gn-cats">
              <thead><tr><th>Team</th><th>Last sent</th><th></th></tr></thead>
              <tbody>
                {data.subs.map(s => (
                  <tr key={s.teamKey}>
                    <td className="stat">{s.teamName} <span className="meta">{s.manager}</span>{s.lastError && <div className="meta">⚠ {s.lastError}</div>}</td>
                    <td className="stat">{when(s.lastSent)}</td>
                    <td className="stat"><button className="btn btn-ghost btn-sm" onClick={() => act({ remove: s.teamKey })}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      {msg && <p className="meta">{msg}</p>}
    </section>
  );
}
