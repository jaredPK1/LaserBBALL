// Phone notifications through a Discord webhook: the nightly lineup job posts
// tomorrow's moves to a channel in your own server. The webhook URL works like
// a password, so it's kept encrypted in the store (or in DISCORD_WEBHOOK_URL)
// and never sent back to the browser.
import { isAuthed } from './yahoo.js';
import { seal, unseal } from './session.js';
import { storeConfigured, getJson, setJson } from './store.js';

const CFG = 'cfg:notify';
const WEBHOOK = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

async function webhookUrl() {
  if (process.env.DISCORD_WEBHOOK_URL) return process.env.DISCORD_WEBHOOK_URL.trim();
  if (!storeConfigured()) return null;
  const cfg = await getJson(CFG).catch(() => null);
  return cfg?.discord ? unseal(cfg.discord)?.url || null : null;
}

export async function notify({ title, message, click }) {
  const url = await webhookUrl();
  if (!url) return { sent: false, reason: 'Discord isn’t connected yet' };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'LaserBBALL', embeds: [{ title, description: message.slice(0, 4000), ...(click ? { url: click } : {}) }] }),
  });
  return r.ok ? { sent: true } : { sent: false, reason: `Discord ${r.status}` };
}

export const appUrl = req => (process.env.PUBLIC_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/$/, '');

const needAuth = req => { if (!isAuthed(req)) throw Object.assign(new Error('Not connected to Yahoo'), { status: 401 }); };

// GET: whether Discord is connected. POST {webhook}: save it (or '' to remove).
export async function notifyConfig(req) {
  needAuth(req);
  if (req.method === 'POST') {
    if (!storeConfigured()) throw Object.assign(new Error('Cloud storage is not set up'), { status: 503 });
    const url = String(req.body?.webhook || '').trim();
    if (url && !WEBHOOK.test(url)) throw Object.assign(new Error('That doesn’t look like a Discord webhook URL (https://discord.com/api/webhooks/…)'), { status: 400 });
    await setJson(CFG, url ? { discord: seal({ url }), updatedAt: new Date().toISOString() } : {});
  }
  const url = await webhookUrl();
  return { connected: !!url, fromEnv: !!process.env.DISCORD_WEBHOOK_URL };
}

export async function notifyTest(req) {
  needAuth(req);
  return notify({ title: 'LaserBBALL is connected', message: 'You’ll get tomorrow’s lineup moves here each evening (about 9pm ET), only when there’s something to change.', click: `${appUrl(req)}/week` });
}
