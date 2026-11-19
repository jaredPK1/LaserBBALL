// Phone notifications through a Discord webhook: the nightly lineup job posts
// tomorrow's moves to a channel in your own server. The webhook URL works like
// a password, so it's kept encrypted in the store (or in DISCORD_WEBHOOK_URL)
// and never sent back to the browser.
import { isAuthed } from './yahoo.js';
import { seal, unseal } from './session.js';
import { storeConfigured, getJson, setJson } from './store.js';

const CFG = 'cfg:notify';
const WEBHOOK = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

// Two channels: 'me' (your private report) and 'league' (the league's channel)
const FIELD = { me: 'discord', league: 'league' };
async function webhookUrl(channel = 'me') {
  if (channel === 'me' && process.env.DISCORD_WEBHOOK_URL) return process.env.DISCORD_WEBHOOK_URL.trim();
  if (!storeConfigured()) return null;
  const cfg = await getJson(CFG).catch(() => null);
  const sealed = cfg?.[FIELD[channel]];
  return sealed ? unseal(sealed)?.url || null : null;
}

// One message: a single embed ({title, message, click}) or up to 10 embeds
export async function notify({ title, message, click, embeds, channel = 'me' }) {
  const url = await webhookUrl(channel);
  if (!url) return { sent: false, reason: 'Discord isn’t connected yet' };
  const list = (embeds || [{ title, description: message, ...(click ? { url: click } : {}) }])
    .map(e => ({ ...e, description: e.description ? String(e.description).slice(0, 4000) : undefined }));
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: channel === 'league' ? 'The Morning Whistle' : 'LaserBBALL', embeds: list.slice(0, 10) }),
  });
  return r.ok ? { sent: true } : { sent: false, reason: `Discord ${r.status}` };
}

export const appUrl = req => (process.env.PUBLIC_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/$/, '');

const needAuth = req => { if (!isAuthed(req)) throw Object.assign(new Error('Not connected to Yahoo'), { status: 401 }); };

// GET: which channels are connected. POST {webhook} and/or {leagueWebhook}:
// save one (or '' to remove it); the other is left alone.
export async function notifyConfig(req) {
  needAuth(req);
  if (req.method === 'POST') {
    if (!storeConfigured()) throw Object.assign(new Error('Cloud storage is not set up'), { status: 503 });
    const cfg = { ...((await getJson(CFG).catch(() => null)) || {}) };
    for (const [param, field] of [['webhook', 'discord'], ['leagueWebhook', 'league']]) {
      if (req.body?.[param] === undefined) continue;
      const url = String(req.body[param] || '').trim();
      if (url && !WEBHOOK.test(url)) throw Object.assign(new Error('That doesn’t look like a Discord webhook URL (https://discord.com/api/webhooks/…)'), { status: 400 });
      if (url) cfg[field] = seal({ url }); else delete cfg[field];
    }
    await setJson(CFG, { ...cfg, updatedAt: new Date().toISOString() });
  }
  const [me, league, recap] = await Promise.all([webhookUrl('me'), webhookUrl('league'), getJson('cfg:recap').catch(() => null)]);
  return { connected: !!me, fromEnv: !!process.env.DISCORD_WEBHOOK_URL, league: !!league, recapOn: recap?.on !== false };
}

export async function notifyTest(req) {
  needAuth(req);
  return notify({ title: 'LaserBBALL is connected', message: 'You’ll get tomorrow’s lineup moves here each evening (about 9pm ET), only when there’s something to change.', click: `${appUrl(req)}/week` });
}
