// NBA schedule + live game data from ESPN's public API.
// (cdn.nba.com blocks cloud hosts like Vercel with 403 Access Denied.)
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (HoopIntel)', Accept: 'application/json' };

// Yahoo / ESPN team abbreviations → NBA tricodes
export const YAHOO_TO_NBA = {
  GS: 'GSW', NO: 'NOP', NY: 'NYK', PHO: 'PHX', SA: 'SAS', UTAH: 'UTA',
  WSH: 'WAS', BRK: 'BKN', CHO: 'CHA', NOR: 'NOP',
};
export const nbaTeam = abbr => YAHOO_TO_NBA[(abbr || '').toUpperCase()] || (abbr || '').toUpperCase();

const ESPN_TEAMS = ['ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GS', 'HOU', 'IND', 'LAC', 'LAL', 'MEM',
  'MIA', 'MIL', 'MIN', 'NO', 'NY', 'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SA', 'TOR', 'UTAH', 'WSH'];

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

async function getJson(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw Object.assign(new Error(`ESPN ${r.status}: ${url}`), { status: 502 });
  return r.json();
}

// YYYY-MM-DD in US Eastern (the NBA's "game day")
export function etDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}
export function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function sides(comp) {
  const cs = comp?.competitors || [];
  const home = cs.find(c => c.homeAway === 'home') || cs[0];
  const away = cs.find(c => c.homeAway === 'away') || cs[1];
  return { home, away };
}

// Full regular season, built from each team's schedule (deduped by event id)
export function getSchedule() {
  return cached('schedule', 6 * 3600_000, async () => {
    const byId = new Map();
    const results = await Promise.allSettled(
      ESPN_TEAMS.map(t => getJson(`${BASE}/teams/${t.toLowerCase()}/schedule?seasontype=2`)),
    );
    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed === results.length) throw results[0].reason;
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const ev of r.value.events || []) {
        if (byId.has(ev.id) || !ev.date) continue;
        const { home, away } = sides(ev.competitions?.[0]);
        if (!home?.team || !away?.team) continue;
        byId.set(ev.id, {
          gameId: ev.id,
          date: etDate(new Date(ev.date)),
          utc: ev.date,
          home: nbaTeam(home.team.abbreviation),
          away: nbaTeam(away.team.abbreviation),
        });
      }
    }
    return [...byId.values()].sort((a, b) => a.utc.localeCompare(b.utc));
  });
}

export async function gamesBetween(start, end) {
  const games = await getSchedule();
  return games.filter(g => g.date >= start && g.date <= end);
}

// { TEAM: [{date, opp, home}] }
export function byTeam(games) {
  const out = {};
  for (const g of games) {
    (out[g.home] ||= []).push({ date: g.date, opp: g.away, home: true, utc: g.utc });
    (out[g.away] ||= []).push({ date: g.date, opp: g.home, home: false, utc: g.utc });
  }
  return out;
}

const STATE = { pre: 1, in: 2, post: 3 };

export function getScoreboard(date = etDate()) {
  return cached(`scoreboard:${date}`, 15_000, async () => {
    const data = await getJson(`${BASE}/scoreboard?dates=${date.replaceAll('-', '')}`);
    return {
      date,
      games: (data.events || []).filter(ev => ev.season?.type !== 1).map(ev => {
        const comp = ev.competitions?.[0] || {};
        const st = comp.status || ev.status || {};
        const { home, away } = sides(comp);
        return {
          gameId: ev.id,
          status: STATE[st.type?.state] || 1,
          statusText: st.type?.state === 'pre' ? '' : (st.type?.shortDetail || ''),
          period: st.period,
          clock: st.displayClock,
          utc: ev.date,
          home: nbaTeam(home?.team?.abbreviation),
          away: nbaTeam(away?.team?.abbreviation),
          homeScore: Number(home?.score) || 0,
          awayScore: Number(away?.score) || 0,
        };
      }),
    };
  });
}

const pair = s => String(s || '0-0').split('-').map(n => Number(n) || 0);

export function getBoxscore(gameId) {
  return cached(`box:${gameId}`, 15_000, async () => {
    const data = await getJson(`${BASE}/summary?event=${encodeURIComponent(gameId)}`);
    const players = [];
    for (const teamBlock of data.boxscore?.players || []) {
      const team = nbaTeam(teamBlock.team?.abbreviation);
      for (const group of teamBlock.statistics || []) {
        const idx = Object.fromEntries((group.keys || []).map((k, i) => [k, i]));
        for (const a of group.athletes || []) {
          const s = a.stats || [];
          if (!s.length) continue; // DNP
          const val = k => s[idx[k]];
          const [fgm, fga] = pair(val('fieldGoalsMade-fieldGoalsAttempted'));
          const [tpm] = pair(val('threePointFieldGoalsMade-threePointFieldGoalsAttempted'));
          const [ftm, fta] = pair(val('freeThrowsMade-freeThrowsAttempted'));
          const n = k => Number(val(k)) || 0;
          players.push({
            name: a.athlete?.displayName || '',
            team,
            onCourt: false, // ESPN's summary doesn't reliably say who's on the floor
            starter: !!a.starter,
            min: String(val('minutes') ?? '0'),
            pts: n('points'), reb: n('rebounds'), ast: n('assists'), stl: n('steals'), blk: n('blocks'),
            tpm, fgm, fga, ftm, fta, to: n('turnovers'), pf: n('fouls'),
          });
        }
      }
    }
    return players;
  });
}

export function normName(name) {
  return (name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’-]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
