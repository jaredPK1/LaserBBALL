// Tiny key-value store on a Supabase table (PostgREST, no SDK needed).
// Table public.laserbball_draft_sync(key text primary key, doc jsonb, updated_at) with RLS
// on and no policies, so only the server's secret key can read or write it.
const url = () => (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const secret = () => process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TABLE = 'laserbball_draft_sync';

export const storeConfigured = () => !!(url() && secret());

async function rest(path, opts = {}) {
  if (!storeConfigured()) throw Object.assign(new Error('Cloud sync storage is not set up'), { status: 503 });
  const key = secret();
  const headers = { apikey: key, 'Content-Type': 'application/json', ...opts.headers };
  // Legacy service_role keys are JWTs and also go in Authorization; new sb_secret_ keys don't
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  const r = await fetch(`${url()}/rest/v1/${path}`, { ...opts, headers });
  const text = await r.text();
  if (!r.ok) {
    let msg = String(r.status);
    try { msg = JSON.parse(text).message || msg; } catch { /* keep status */ }
    throw Object.assign(new Error(`Storage error: ${msg}`), { status: 502 });
  }
  return text ? JSON.parse(text) : null;
}

export async function getJson(key) {
  const rows = await rest(`${TABLE}?key=eq.${encodeURIComponent(key)}&select=doc`);
  return rows?.[0]?.doc ?? null;
}

export async function setJson(key, value) {
  await rest(`${TABLE}?on_conflict=key`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, doc: value, updated_at: new Date().toISOString() }),
  });
}

// All documents whose key starts with prefix (e.g. 'hist:')
export async function listJson(prefix) {
  const rows = await rest(`${TABLE}?key=like.${encodeURIComponent(prefix)}*&select=key,doc`);
  return (rows || []).map(r => ({ key: r.key, doc: r.doc }));
}
