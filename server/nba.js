// NBA schedule + live game data from the public cdn.nba.com JSON feeds.
const SCHEDULE_URL = 'https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json';
const SCOREBOARD_URL = 'https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json';
const BOXSCORE_URL = id => `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${id}.json`;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (HoopIntel)',
  Referer: 'https://www.nba.com/',
  Origin: 'https://www.nba.com',
  Accept: 'application/json',
};

// Yahoo team abbreviations → NBA tricodes
export const YAHOO_TO_NBA = {
  GS: 'GSW', NO: 'NOP', NY: 'NYK', PHO: 'PHX', SA: 'SAS', UTAH: 'UTA',
  WSH: 'WAS', BRK: 'BKN', CHO: 'CHA', NOR: 'NOP',
};
export const nbaTeam = abbr => YAHOO_TO_NBA[(abbr || '').toUpperCase()] || (abbr || '').toUpperCase();

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
  if (!r.ok) throw Object.assign(new Error(`NBA feed ${r.status}: ${url}`), { status: 502 });
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

// All regular-season (002) and NBA Cup knockout (006) games
export function getSchedule() {
  return cached('schedule', 6 * 3600_000, async () => {
    const data = await getJson(SCHEDULE_URL);
    const games = [];
    for (const day of data.leagueSchedule?.gameDates || []) {
      for (const g of day.games || []) {
        if (!/^00[26]/.test(g.gameId)) continue;
        games.push({
          gameId: g.gameId,
          date: (g.gameDateEst || '').slice(0, 10),
          utc: g.gameDateTimeUTC,
          home: g.homeTeam?.teamTricode,
          away: g.awayTeam?.teamTricode,
        });
      }
    }
    return games;
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

export function getScoreboard() {
  return cached('scoreboard', 15_000, async () => {
    const data = await getJson(SCOREBOARD_URL);
    const sb = data.scoreboard || {};
    return {
      date: sb.gameDate,
      games: (sb.games || []).map(g => ({
        gameId: g.gameId,
        status: g.gameStatus, // 1 scheduled, 2 live, 3 final
        statusText: (g.gameStatusText || '').trim(),
        period: g.period,
        clock: parseClock(g.gameClock),
        utc: g.gameTimeUTC,
        home: g.homeTeam?.teamTricode,
        away: g.awayTeam?.teamTricode,
        homeScore: g.homeTeam?.score,
        awayScore: g.awayTeam?.score,
      })),
    };
  });
}

function parseClock(iso) {
  const m = /PT(\d+)M([\d.]+)S/.exec(iso || '');
  return m ? `${Number(m[1])}:${String(Math.floor(Number(m[2]))).padStart(2, '0')}` : '';
}

export function getBoxscore(gameId) {
  return cached(`box:${gameId}`, 15_000, async () => {
    const data = await getJson(BOXSCORE_URL(gameId));
    const g = data.game || {};
    const players = [];
    for (const side of ['homeTeam', 'awayTeam']) {
      const t = g[side] || {};
      for (const p of t.players || []) {
        const s = p.statistics || {};
        players.push({
          name: p.name || `${p.firstName} ${p.familyName}`,
          team: t.teamTricode,
          onCourt: p.oncourt === '1',
          played: p.played === '1',
          starter: p.starter === '1',
          min: parseClock(s.minutes).split(':')[0] || '0',
          pts: s.points || 0,
          reb: s.reboundsTotal || 0,
          ast: s.assists || 0,
          stl: s.steals || 0,
          blk: s.blocks || 0,
          tpm: s.threePointersMade || 0,
          fgm: s.fieldGoalsMade || 0,
          fga: s.fieldGoalsAttempted || 0,
          ftm: s.freeThrowsMade || 0,
          fta: s.freeThrowsAttempted || 0,
          to: s.turnovers || 0,
          pf: s.foulsPersonal || 0,
        });
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
