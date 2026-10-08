// Encrypted cookie session. Yahoo tokens live server-side only (httpOnly cookie),
// never in localStorage or URLs. No database needed.
import crypto from 'node:crypto';

const COOKIE = 'hi_sess';
const MAX_AGE = 60 * 60 * 24 * 180; // 180 days; Yahoo refresh tokens are long-lived

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET env var must be set (32+ random characters)');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

export function seal(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url');
}

export function unseal(str) {
  try {
    const buf = Buffer.from(str, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    const dec = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
    return JSON.parse(dec.toString('utf8'));
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isSecure(req) {
  return (req.headers['x-forwarded-proto'] || '').includes('https') || req.secure;
}

export function setCookie(req, res, name, value, maxAge) {
  const attrs = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (isSecure(req)) attrs.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
  res.setHeader('Set-Cookie', [...list.filter(c => !c.startsWith(`${name}=`)), attrs.join('; ')]);
}

export function loadSession(req) {
  if (req._session !== undefined) return req._session;
  const raw = parseCookies(req)[COOKIE];
  return raw ? unseal(raw) : null;
}

export function saveSession(req, res, session) {
  // Browsers cap cookies near 4KB; drop the cached access token if needed —
  // it will be re-minted from the refresh token on the next request.
  req._session = session;
  let value = seal(session);
  if (value.length > 3800) value = seal({ ...session, access_token: null, expires_at: 0 });
  setCookie(req, res, COOKIE, value, MAX_AGE);
}

export function clearSession(req, res) {
  req._session = null;
  setCookie(req, res, COOKIE, '', 0);
}
