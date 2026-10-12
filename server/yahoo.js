// Yahoo OAuth 2.0 + Fantasy API client, plus helpers for Yahoo's awkward JSON.
import crypto from 'node:crypto';
import { loadSession, saveSession, clearSession, setCookie, parseCookies, seal, unseal } from './session.js';
import { storeConfigured, getJson, setJson } from './store.js';

const AUTH_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
const TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
const API = 'https://fantasysports.yahooapis.com/fantasy/v2/';

export class AuthError extends Error {
  constructor(msg) { super(msg); this.status = 401; }
}

export function redirectUri(req) {
  if (process.env.PUBLIC_URL) return `${process.env.PUBLIC_URL.replace(/\/$/, '')}/api/auth/callback`;
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/api/auth/callback`;
}

// Short fingerprint of the Yahoo app a token was issued to, so sessions from a
// deleted/replaced app are discarded instead of producing confusing 403s
export function clientTag() {
  const id = process.env.YAHOO_CLIENT_ID?.trim() || '';
  return crypto.createHash('sha256').update(id).digest('hex').slice(0, 8);
}

function clientCreds() {
  const id = process.env.YAHOO_CLIENT_ID?.trim();
  const secret = process.env.YAHOO_CLIENT_SECRET?.trim();
  if (!id || !secret) throw new Error('YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET env vars are not set');
  return { id, secret };
}

// Only same-site paths, so the login redirect can't be pointed at another site
export function safeNext(next) {
  const n = String(next || '/');
  return /^\/(?![/\\])/.test(n) ? n : '/';
}

export function authRedirect(req, res) {
  const { id } = clientCreds();
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(req, res, 'hi_state', state, 600);
  setCookie(req, res, 'hi_next', safeNext(req.query.next), 600);
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    language: 'en-us',
    // Ask for Fantasy read explicitly; without it Yahoo can issue a token that
    // lacks fantasy access when the app has other permissions (403 "not authorized")
    scope: process.env.YAHOO_SCOPE || 'fspt-r',
    state,
  });
  res.redirect(`${AUTH_URL}?${params}`);
}

async function tokenRequest(req, body) {
  const { id, secret } = clientCreds();
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ redirect_uri: redirectUri(req), ...body }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw Object.assign(new Error(`Yahoo token error: ${data.error_description || data.error || r.status}`), { status: r.status === 400 || r.status === 401 ? 401 : 502 });
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000 - 60_000,
    client: clientTag(),
    scope: data.scope || null,
    guid: data.xoauth_yahoo_guid || null,
  };
}

export async function handleCallback(req, res) {
  const { code, state, error } = req.query;
  if (error) return res.status(400).send(`Yahoo returned an error: ${String(error)}`);
  if (!code || !state || state !== parseCookies(req).hi_state) {
    return res.status(400).send('OAuth state mismatch — start again from the Connect page.');
  }
  const tokens = await tokenRequest(req, { grant_type: 'authorization_code', code: String(code) });
  saveSession(req, res, { ...tokens, login_at: Date.now() });
  if (tokens.guid && storeConfigured()) {
    await setJson(tokenKey(tokens), { at: seal({ at: tokens.access_token }), exp: tokens.expires_at }).catch(() => {});
  }
  const next = safeNext(parseCookies(req).hi_next);
  setCookie(req, res, 'hi_state', '', 0);
  setCookie(req, res, 'hi_next', '', 0);
  res.redirect(next);
}

export function logout(req, res) {
  clearSession(req, res);
  res.json({ ok: true });
}

function currentSession(req) {
  const s = loadSession(req);
  return s?.refresh_token && s.client === clientTag() ? s : null;
}

export function isAuthed(req) {
  return !!currentSession(req);
}

// Every refresh-token grant makes Yahoo email a "New sign in" notice, so refresh
// as rarely as possible: reuse a token another request/device already minted
// (kept encrypted server-side, since the cookie may have to drop it for size),
// and let concurrent calls within one request share a single refresh.
const tokenKey = s => `tok:y:${s.guid}`;

async function sharedToken(s) {
  if (!s.guid || !storeConfigured()) return null;
  try {
    const t = await getJson(tokenKey(s));
    const at = t && Date.now() < t.exp ? unseal(t.at)?.at : null;
    return at ? { access_token: at, expires_at: t.exp } : null;
  } catch { return null; }
}

async function refresh(req, res, s) {
  const t = await tokenRequest(req, { grant_type: 'refresh_token', refresh_token: s.refresh_token });
  const next = { ...t, refresh_token: t.refresh_token || s.refresh_token, login_at: s.login_at, scope: t.scope || s.scope, guid: t.guid || s.guid };
  saveSession(req, res, next);
  if (next.guid && storeConfigured()) {
    await setJson(tokenKey(next), { at: seal({ at: next.access_token }), exp: next.expires_at }).catch(() => {});
  }
  return next.access_token;
}

async function accessToken(req, res, force = false) {
  const s = currentSession(req);
  if (!s) throw new AuthError('Not connected to Yahoo');
  if (!force && s.access_token && Date.now() < s.expires_at) return s.access_token;
  if (!force) {
    const shared = await sharedToken(s);
    if (shared) { req._session = { ...s, ...shared }; return shared.access_token; }
  }
  req._refreshing ||= refresh(req, res, s).finally(() => { req._refreshing = null; });
  try {
    return await req._refreshing;
  } catch (e) {
    if (e.status === 401) { clearSession(req, res); throw new AuthError('Yahoo session expired — reconnect'); }
    throw e;
  }
}

// Called once per page load before any Yahoo calls, so parallel requests that
// follow all carry the fresh token instead of each refreshing on their own
export async function warmToken(req, res) {
  if (!currentSession(req)) return { ok: false };
  await accessToken(req, res);
  return { ok: true };
}

// Fetch a Fantasy API resource path, e.g. "league/nba.l.33458/settings"
export async function yget(req, res, path) {
  const url = `${API}${path}${path.includes('?') ? '&' : '?'}format=json`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(req, res, attempt > 0);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 401 && attempt === 0) continue;
    const text = await r.text();
    if (!r.ok) {
      throw Object.assign(new Error(`Yahoo API ${r.status} on ${path}: ${text.slice(0, 300)}`), { status: r.status === 401 ? 401 : 502 });
    }
    return JSON.parse(text);
  }
}

// ── Yahoo JSON helpers ───────────────────────────────────────────────────────
// Yahoo encodes objects as arrays of single-key objects, and collections as
// {"0": {...}, "1": {...}, count: N}. These flatten that.

export function merge(x, out = {}) {
  if (Array.isArray(x)) x.forEach(v => merge(v, out));
  else if (x && typeof x === 'object') Object.assign(out, x);
  return out;
}

export function each(coll, key) {
  if (!coll || typeof coll !== 'object') return [];
  return Object.keys(coll)
    .filter(k => /^\d+$/.test(k))
    .sort((a, b) => a - b)
    .map(k => coll[k]?.[key])
    .filter(v => v !== undefined);
}

export function statsMap(statsArr) {
  const out = {};
  for (const s of statsArr || []) {
    if (s?.stat) out[String(s.stat.stat_id)] = s.stat.value;
  }
  return out;
}

export function parsePlayer(p) {
  const info = merge(p[0]);
  const extra = merge(p.slice(1));
  const sel = merge(extra.selected_position);
  return {
    key: info.player_key,
    name: info.name?.full || 'Unknown',
    team: (info.editorial_team_abbr || '').toUpperCase(),
    pos: (info.eligible_positions || []).map(e => e.position).filter(Boolean),
    displayPos: info.display_position || '',
    status: info.status || '',
    injury: info.injury_note || '',
    slot: sel.position || '',
    owned: extra.percent_owned ? Number(merge(extra.percent_owned).value) : undefined,
    stats: statsMap(extra.player_stats?.stats),
  };
}

export function parseTeamInfo(teamNode) {
  const info = merge(teamNode[0]);
  const extra = merge(teamNode.slice(1));
  return {
    key: info.team_key,
    name: info.name,
    mine: !!info.is_owned_by_current_login,
    stats: statsMap(extra.team_stats?.stats),
    remainingGames: extra.team_remaining_games,
    extra,
  };
}

// Resolve the user's NBA league + own team. Honors LEAGUE_ID if they have several.
export async function myContext(req, res) {
  const data = await yget(req, res, 'users;use_login=1/games;game_keys=nba/leagues/teams');
  const user = merge(data.fantasy_content.users['0'].user);
  const games = each(user.games, 'game');
  const leagues = [];
  for (const g of games) {
    const gm = merge(g);
    for (const l of each(gm.leagues, 'league')) {
      const info = merge(l[0]);
      const teams = each(merge(l.slice(1)).teams, 'team').map(parseTeamInfo);
      leagues.push({ info, teams });
    }
  }
  if (!leagues.length) throw Object.assign(new Error('No Yahoo NBA league found for this account this season'), { status: 404 });
  const wanted = process.env.LEAGUE_ID;
  const league = leagues.find(l => String(l.info.league_id) === String(wanted)) || leagues[0];
  const mine = league.teams.find(t => t.mine);
  return {
    leagueKey: league.info.league_key,
    leagueId: league.info.league_id,
    leagueName: league.info.name,
    currentWeek: Number(league.info.current_week) || 1,
    startWeek: Number(league.info.start_week) || 1,
    draftStatus: league.info.draft_status,
    teamKey: mine?.key,
    teamName: mine?.name || 'My Team',
    raw: data,
  };
}

// Diagnostics for authorization problems: session facts + which calls Yahoo refuses.
// Returns statuses and Yahoo's error text only — never tokens.
export async function debugYahoo(req, res) {
  const raw = loadSession(req);
  const out = {
    session: raw ? {
      loginAt: raw.login_at ? new Date(raw.login_at).toISOString() : 'unknown (logged in before this build)',
      fromCurrentApp: raw.client === clientTag(),
      scope: raw.scope,
      hasAccountId: !!raw.guid, // needed for cross-device sync
    } : null,
    calls: {},
  };
  if (!currentSession(req)) return out;
  const league = process.env.LEAGUE_ID || '';
  const paths = [
    'game/nba',
    'users;use_login=1',
    'users;use_login=1/games',
    'users;use_login=1/games;game_keys=nba/leagues',
    'users;use_login=1/games;game_keys=nba/leagues/teams',
    ...(league ? [`league/nba.l.${league}`] : []),
  ];
  for (const p of paths) {
    try {
      const token = await accessToken(req, res);
      const r = await fetch(`${API}${p}?format=json`, { headers: { Authorization: `Bearer ${token}` } });
      const text = await r.text();
      let desc = '';
      try { desc = JSON.parse(text).error?.description || ''; } catch { desc = text.slice(0, 120); }
      out.calls[p] = { status: r.status, ...(r.ok ? {} : { error: desc }), www: r.headers.get('www-authenticate') || undefined };
    } catch (e) {
      out.calls[p] = { error: e.message };
    }
  }
  return out;
}

// Stable per-user id for server-side storage: your Yahoo account guid, captured
// at login. Sessions from before guid capture must log in again to sync
// (a per-device fallback would silently give each device its own copy).
export function userKey(req) {
  const s = currentSession(req);
  return s?.guid ? `y:${s.guid}` : null;
}
