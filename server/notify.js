// Phone notifications through ntfy (free app, no account): the server posts
// to a private, randomly named topic that only you subscribe to. Used by the
// nightly lineup job to send tomorrow's moves.
import crypto from 'node:crypto';
import { isAuthed } from './yahoo.js';
import { storeConfigured, getJson, setJson } from './store.js';

const CFG = 'cfg:notify';
const NTFY = 'https://ntfy.sh';

export async function notifyTopic() {
  if (!storeConfigured()) return null;
  const cfg = await getJson(CFG).catch(() => null);
  if (cfg?.topic) return cfg.topic;
  // Hard to guess: anyone who knows the topic can read it
  const topic = `laserbball-${crypto.randomBytes(12).toString('hex')}`;
  await setJson(CFG, { topic, createdAt: new Date().toISOString() });
  return topic;
}

export async function notify({ title, message, click, tags = [] }) {
  const topic = await notifyTopic();
  if (!topic) return { sent: false, reason: 'Cloud storage is not set up' };
  const headers = { Title: title, Tags: tags.join(',') };
  if (click) headers.Click = click;
  const r = await fetch(`${NTFY}/${topic}`, { method: 'POST', headers, body: message });
  return r.ok ? { sent: true } : { sent: false, reason: `ntfy ${r.status}` };
}

const appUrl = req => (process.env.PUBLIC_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/$/, '');

// Only shown to you (logged in): the topic is the only thing protecting it
export async function notifyConfig(req) {
  if (!isAuthed(req)) throw Object.assign(new Error('Not connected to Yahoo'), { status: 401 });
  const topic = await notifyTopic();
  if (!topic) throw Object.assign(new Error('Cloud storage is not set up'), { status: 503 });
  return { topic, subscribeUrl: `${NTFY}/${topic}` };
}

export async function notifyTest(req) {
  if (!isAuthed(req)) throw Object.assign(new Error('Not connected to Yahoo'), { status: 401 });
  return notify({ title: 'LaserBBALL test', message: 'Notifications work. You’ll get tomorrow’s lineup moves here each evening.', click: `${appUrl(req)}/week`, tags: ['basketball'] });
}

export { appUrl };
