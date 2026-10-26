import axios from 'axios';

// Same-origin API; Yahoo tokens live in an httpOnly session cookie on the server.
const BASE = '/api';

let authed = null;

export const checkAuth = async () => {
  try {
    const { data } = await axios.get(`${BASE}/auth/status`);
    authed = !!data.authed;
  } catch {
    authed = false;
  }
  return authed;
};

export const isAuthenticated = () => !!authed;

// Return to the page login started from (e.g. the draft board), not the dashboard
// switchAccount asks Yahoo to show its sign-in screen instead of reusing the
// account the browser is already signed into
export const startAuth = (opts) => {
  const sw = opts?.switchAccount ? '&switch=1' : '';
  window.location.href = `${BASE}/auth?next=${encodeURIComponent(window.location.pathname)}${sw}`;
};

export const getYahooCheck = () => axios.get(`${BASE}/debug/yahoo`);
export const getHealth = () => axios.get(`${BASE}/health`);

export const clearTokens = async () => {
  await axios.post(`${BASE}/auth/logout`).catch(() => {});
  authed = false;
};

// One token refresh per page load, before the parallel calls that follow
let warm = null;
const warmUp = () => (warm ||= axios.post(`${BASE}/auth/warm`).catch(() => {}));

const apiCall = async (fn) => {
  await warmUp();
  try {
    return await fn();
  } catch (err) {
    if (err.response?.status === 401) {
      authed = false;
      window.location.assign('/connect');
    }
    throw err;
  }
};

const authHeaders = () => ({});

// ── Leagues cache ───────────────────────────────────────────────────────────
let leaguesCache = null;
let leaguesCacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export const getLeagues = async () => {
  if (leaguesCache && Date.now() - leaguesCacheTime < CACHE_TTL) {
    return leaguesCache;
  }
  const res = await apiCall(() => axios.get(`${BASE}/leagues`, { headers: authHeaders() }));
  leaguesCache = res;
  leaguesCacheTime = Date.now();
  return res;
};

// ── Fantasy API calls ───────────────────────────────────────────────────────

export const getRoster = (leagueId, teamKey) =>
  apiCall(() => axios.get(`${BASE}/roster/${leagueId}/${encodeURIComponent(teamKey)}`, { headers: authHeaders() }));

export const getMatchup = (leagueId, teamKey, week) =>
  apiCall(() => axios.get(`${BASE}/matchup/${leagueId}/${encodeURIComponent(teamKey)}${week ? `?week=${week}` : ''}`, { headers: authHeaders() }));

export const getWaivers = (leagueId) =>
  apiCall(() => axios.get(`${BASE}/waivers/${leagueId}`, { headers: authHeaders() }));

export const getStandings = (leagueId) =>
  apiCall(() => axios.get(`${BASE}/standings/${leagueId}`, { headers: authHeaders() }));

export const getLeagueSettings = (leagueId) =>
  apiCall(() => axios.get(`${BASE}/league/${leagueId}`, { headers: authHeaders() }));

export const getPlayerStats = (playerKeys) =>
  apiCall(() => axios.get(`${BASE}/players?keys=${playerKeys.join(',')}`, { headers: authHeaders() }));

export const getGamePlan = (leagueId, teamKey, week) =>
  apiCall(() => axios.get(`${BASE}/gameplan/${leagueId}/${encodeURIComponent(teamKey)}${week ? `?week=${week}` : ''}`, { headers: authHeaders() }));

export const getScheduleRemaining = () =>
  apiCall(() => axios.get(`${BASE}/schedule/remaining`));

export const getScheduleWeekly = () =>
  apiCall(() => axios.get(`${BASE}/schedule/weekly`));

export const getTodayGames = () =>
  apiCall(() => axios.get(`${BASE}/schedule/today`));

export const getWeekDays = () =>
  apiCall(() => axios.get(`${BASE}/schedule/week-days`));

export const getGameNight = (week) =>
  apiCall(() => axios.get(`${BASE}/gamenight${week ? `?week=${week}` : ''}`));

export const getDraftPool = (season) =>
  apiCall(() => axios.get(`${BASE}/draft/pool${season ? `?season=${season}` : ''}`, { timeout: 60000 }));

export const getWeek = (week) =>
  apiCall(() => axios.get(`${BASE}/week${week ? `?week=${week}` : ''}`, { timeout: 60000 }));

export const getStreamers = (week) =>
  apiCall(() => axios.get(`${BASE}/week/streamers${week ? `?week=${week}` : ''}`, { timeout: 60000 }));

export const getReview = (week) =>
  apiCall(() => axios.get(`${BASE}/week/review${week ? `?week=${week}` : ''}`, { timeout: 60000 }));

export const getAlerts = () =>
  apiCall(() => axios.get(`${BASE}/alerts`, { timeout: 60000 }));

export const getPlayoffs = () =>
  apiCall(() => axios.get(`${BASE}/playoffs`, { timeout: 60000 }));

export const getTrade = (params = {}) =>
  apiCall(() => axios.get(`${BASE}/trade`, { params, timeout: 60000 }));

export const getHistorySeasons = () =>
  apiCall(() => axios.get(`${BASE}/history/seasons`));

export const getHistorySeason = (leagueKey, fresh = false) =>
  apiCall(() => axios.get(`${BASE}/history/season/${encodeURIComponent(leagueKey)}${fresh ? '?fresh=1' : ''}`, { timeout: 90000 }));

export const getEspnPool = () =>
  axios.get(`${BASE}/draft/espn`, { timeout: 60000 });

export const getLeagueWeek = () =>
  apiCall(() => axios.get(`${BASE}/race/week`, { timeout: 60000 }));

export const getTradeIdeas = () =>
  apiCall(() => axios.get(`${BASE}/trade/ideas`, { timeout: 90000 }));

export const getPower = (week) =>
  apiCall(() => axios.get(`${BASE}/race/power${week ? `?week=${week}` : ''}`, { timeout: 60000 }));
