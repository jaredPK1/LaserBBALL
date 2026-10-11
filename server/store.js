// Tiny key-value store on Upstash Redis (REST). Vercel's Storage → Upstash
// integration injects these env vars automatically; no SDK needed.
const url = () => (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const token = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

export const storeConfigured = () => !!(url() && token());

async function command(args) {
  if (!storeConfigured()) throw Object.assign(new Error('Cloud sync storage is not set up'), { status: 503 });
  const r = await fetch(url(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw Object.assign(new Error(`Storage error: ${data.error || r.status}`), { status: 502 });
  return data.result;
}

export async function getJson(key) {
  const v = await command(['GET', key]);
  return v ? JSON.parse(v) : null;
}

export async function setJson(key, value) {
  await command(['SET', key, JSON.stringify(value)]);
}
