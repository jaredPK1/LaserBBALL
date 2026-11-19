import { useEffect, useState } from 'react';
import { getBotStatus, registerBotCommands } from '../api/yahoo';

const errOf = e => e.response?.data?.error || e.message;

// Settings card: the Discord bot behind /odds, /matchup, /trades, pick'em…
export default function DiscordBot() {
  const [st, setSt] = useState(null);
  const [msg, setMsg] = useState(null);
  const [invite, setInvite] = useState(null);

  useEffect(() => {
    let live = true;
    getBotStatus().then(r => live && setSt(r.data)).catch(e => live && setMsg(errOf(e)));
    return () => { live = false; };
  }, []);

  const register = () => registerBotCommands().then(r => { setInvite(r.data.invite); setMsg(`Commands registered: /${r.data.registered.join(', /')}`); }).catch(e => setMsg(errOf(e)));

  return (
    <section className="card">
      <h3>Discord bot</h3>
      <p className="settings-note">Lets anyone in your server type <code>/odds</code>, <code>/matchup</code>, <code>/rivalry</code>, <code>/compare</code>, <code>/trades</code> (private to them), and play the weekly pick’em with buttons.</p>
      {st && (
        <p className="settings-note">
          {st.configured ? <span className="tag tag-green">Keys set</span> : <span className="tag">Keys missing</span>}{' '}
          {st.channelSet ? <span className="tag tag-green">Pick’em channel set</span> : <span className="tag">No pick’em channel</span>}
        </p>
      )}
      <ol className="settings-steps">
        <li>Go to <b>discord.com/developers/applications → New Application</b> (name it LaserBBALL).</li>
        <li>From <b>General Information</b>, copy the <b>Application ID</b> and <b>Public Key</b>. From <b>Bot</b>, press <b>Reset Token</b> and copy it. Put them in Vercel as <code>DISCORD_APP_ID</code>, <code>DISCORD_PUBLIC_KEY</code>, <code>DISCORD_BOT_TOKEN</code> (don’t paste them anywhere else), then redeploy.</li>
        <li>Back in <b>General Information</b>, set <b>Interactions Endpoint URL</b> to {st ? <code className="notify-topic">{st.endpoint}</code> : 'this app’s /api/discord/interactions'} and save.</li>
        <li>Press <button className="btn btn-ghost btn-sm" onClick={register} disabled={!st?.configured}>Register commands</button> then open the invite link to add the bot to your server.{invite && <> <a href={invite} target="_blank" rel="noreferrer">Add bot to server</a></>}</li>
        <li>In the league channel, type <code>/setup</code>. That’s where the Monday pick’em gets posted.</li>
      </ol>
      <p className="meta">Re-press Register commands if team names change. Players link themselves with <code>/iam</code>.</p>
      {msg && <p className="meta">{msg}</p>}
    </section>
  );
}
