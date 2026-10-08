// Game Night: live matchup view combining Yahoo (official category totals, lineups)
// with the NBA live feed (per-player box scores, game clocks).
import { yget, merge, each, parsePlayer, parseTeamInfo, myContext } from './yahoo.js';
import { getScoreboard, getBoxscore, gamesBetween, etDate, addDays, nbaTeam, normName } from './nba.js';

export const CATS = [
  { id: '5', name: 'FG%', pct: ['fgm', 'fga'], vol: '9004003' },
  { id: '8', name: 'FT%', pct: ['ftm', 'fta'], vol: '9007006' },
  { id: '10', name: '3PTM', k: 'tpm' },
  { id: '12', name: 'PTS', k: 'pts' },
  { id: '15', name: 'REB', k: 'reb' },
  { id: '16', name: 'AST', k: 'ast' },
  { id: '17', name: 'STL', k: 'stl' },
  { id: '18', name: 'BLK', k: 'blk' },
  { id: '19', name: 'TO', k: 'to', low: true },
];

const INACTIVE_SLOTS = new Set(['BN', 'IL', 'IL+', 'IL+LT', 'NA']);
const OUT_STATUSES = new Set(['O', 'INJ', 'OUT', 'SUSP', 'NA']);

const splitPair = v => {
  const [a, b] = String(v || '').split('/').map(Number);
  return [Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : 0];
};

// Yahoo stats map → { pts, reb, ..., fgm, fga, ftm, fta }
export function yahooLine(stats) {
  const [fgm, fga] = splitPair(stats['9004003']);
  const [ftm, fta] = splitPair(stats['9007006']);
  const n = id => Number(stats[id]) || 0;
  return {
    fgm, fga, ftm, fta,
    fgPct: n('5'), ftPct: n('8'),
    tpm: n('10'), pts: n('12'), reb: n('15'), ast: n('16'), stl: n('17'), blk: n('18'), to: n('19'),
  };
}

function catValue(cat, line) {
  if (cat.pct) {
    const [m, a] = cat.pct;
    if (line[a] > 0) return line[m] / line[a];
    return cat.id === '5' ? line.fgPct || 0 : line.ftPct || 0;
  }
  return line[cat.k] || 0;
}

function sumLines(lines) {
  const out = { fgm: 0, fga: 0, ftm: 0, fta: 0, tpm: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, to: 0 };
  for (const l of lines) for (const k of Object.keys(out)) out[k] += Number(l[k]) || 0;
  return out;
}

function leader(cat, a, b) {
  const eps = cat.pct ? 0.0005 : 0.001;
  if (Math.abs(a - b) < eps) return 'tie';
  return (cat.low ? a < b : a > b) ? 'me' : 'opp';
}

// Gap as a share of the larger side — used to flag swing categories
function closeness(cat, a, b) {
  if (cat.pct) return Math.abs(a - b) <= 0.015;
  const big = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / big <= 0.08 || Math.abs(a - b) <= 2;
}

async function roster(req, res, teamKey, date) {
  const data = await yget(req, res, `team/${teamKey}/roster;date=${date}/players/stats;type=average_season`);
  const team = data.fantasy_content.team;
  const r = merge(team.slice(1)).roster;
  return each(r?.['0']?.players || r?.players, 'player').map(parsePlayer);
}

async function weekBounds(req, res, week) {
  try {
    const data = await yget(req, res, 'game/nba/game_weeks');
    const g = merge(data.fantasy_content.game);
    const w = each(g.game_weeks, 'game_week').find(x => Number(x.week) === Number(week));
    if (w) return { start: w.start, end: w.end };
  } catch { /* fall through to Mon–Sun */ }
  const today = etDate();
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 Sun
  const start = addDays(today, -((dow + 6) % 7));
  return { start, end: addDays(start, 6) };
}

export async function gameNight(req, res) {
  const ctx = await myContext(req, res);
  if (!ctx.teamKey) throw Object.assign(new Error('Could not find your team in this league'), { status: 404 });
  const today = etDate();
  const tomorrow = addDays(today, 1);
  const week = Number(req.query.week) || ctx.currentWeek;

  const [matchupData, bounds, scoreboard] = await Promise.all([
    yget(req, res, `team/${ctx.teamKey}/matchups;weeks=${week}`),
    weekBounds(req, res, week),
    getScoreboard().catch(e => ({ date: today, games: [], error: e.message })),
  ]);

  // Matchup teams
  const mteam = merge(matchupData.fantasy_content.team.slice(1));
  const matchup = each(mteam.matchups, 'matchup')[0] || {};
  const mteams = each(merge(matchup['0'] ? matchup['0'] : matchup).teams, 'team').map(parseTeamInfo);
  const me = mteams.find(t => t.key === ctx.teamKey) || mteams[0];
  const opp = mteams.find(t => t.key !== ctx.teamKey);

  const [myRoster, oppRoster, myTomorrow, weekGames] = await Promise.all([
    roster(req, res, ctx.teamKey, today),
    opp ? roster(req, res, opp.key, today) : [],
    roster(req, res, ctx.teamKey, tomorrow).catch(() => null),
    gamesBetween(today, bounds.end > tomorrow ? bounds.end : tomorrow).catch(() => []),
  ]);

  // Live box scores for games that have tipped
  const sbGames = scoreboard.date === today ? scoreboard.games : [];
  const started = sbGames.filter(g => g.status >= 2);
  const boxes = await Promise.all(started.map(g => getBoxscore(g.gameId).catch(() => [])));
  const liveIndex = new Map();
  for (const p of boxes.flat()) {
    liveIndex.set(`${normName(p.name)}|${p.team}`, p);
    if (!liveIndex.has(normName(p.name))) liveIndex.set(normName(p.name), p);
  }
  const gameByTeam = new Map();
  for (const g of sbGames) { gameByTeam.set(g.home, g); gameByTeam.set(g.away, g); }
  // Schedule fallback if the live scoreboard hasn't rolled to today yet
  for (const g of weekGames.filter(x => x.date === today)) {
    if (!gameByTeam.has(g.home)) {
      const stub = { gameId: g.gameId, status: 1, statusText: '', utc: g.utc, home: g.home, away: g.away };
      gameByTeam.set(g.home, stub); gameByTeam.set(g.away, stub);
    }
  }

  const decorate = p => {
    const t = nbaTeam(p.team);
    const game = gameByTeam.get(t) || null;
    const live = game && game.status >= 2 ? (liveIndex.get(`${normName(p.name)}|${t}`) || liveIndex.get(normName(p.name)) || null) : null;
    const active = !INACTIVE_SLOTS.has(p.slot);
    return {
      key: p.key, name: p.name, team: t, pos: p.displayPos, slot: p.slot, status: p.status, injury: p.injury,
      active,
      counting: active && !!game,
      avg: yahooLine(p.stats),
      game: game && {
        gameId: game.gameId, status: game.status, statusText: game.statusText, clock: game.clock, period: game.period,
        utc: game.utc, opp: game.home === t ? game.away : game.home, home: game.home === t,
        score: game.status >= 2 ? `${game.awayScore}-${game.homeScore}` : null,
        matchup: `${game.away} @ ${game.home}`,
      },
      live,
    };
  };
  const mine = myRoster.map(decorate);
  const theirs = oppRoster.map(decorate);

  const tonight = side => sumLines(side.filter(p => p.counting && p.live).map(p => p.live));
  const myTonight = tonight(mine);
  const oppTonight = tonight(theirs);

  // Rest-of-week projection: today's not-yet-started games for active players,
  // then future days assuming healthy non-IL players fill the 10 active slots.
  const sched = new Map();
  for (const g of weekGames) {
    for (const t of [g.home, g.away]) {
      if (!sched.has(t)) sched.set(t, new Set());
      sched.get(t).add(g.date);
    }
  }
  const project = side => {
    const lines = [];
    for (const p of side) {
      if (p.counting && p.game?.status === 1 && !OUT_STATUSES.has(p.status)) lines.push(p.avg);
    }
    for (let d = addDays(today, 1); d <= bounds.end; d = addDays(d, 1)) {
      const avail = side
        .filter(p => !['IL', 'IL+', 'IL+LT', 'NA'].includes(p.slot) && !OUT_STATUSES.has(p.status) && sched.get(p.team)?.has(d))
        .sort((a, b) => b.avg.pts - a.avg.pts)
        .slice(0, 10);
      lines.push(...avail.map(p => p.avg));
    }
    return sumLines(lines);
  };
  const myRest = project(mine);
  const oppRest = project(theirs);

  const myWeek = yahooLine(me?.stats || {});
  const oppWeek = yahooLine(opp?.stats || {});
  const add = (a, b) => Object.fromEntries(Object.keys(b).map(k => [k, (a[k] || 0) + b[k]]));
  const myProj = add(myWeek, myRest);
  const oppProj = add(oppWeek, oppRest);

  const categories = CATS.map(cat => {
    const m = catValue(cat, myWeek), o = catValue(cat, oppWeek);
    const pm = catValue(cat, myProj), po = catValue(cat, oppProj);
    return {
      id: cat.id, name: cat.name, low: !!cat.low, pct: !!cat.pct,
      me: m, opp: o, leader: leader(cat, m, o), close: closeness(cat, m, o),
      tonightMe: catValue(cat, myTonight), tonightOpp: catValue(cat, oppTonight),
      projMe: pm, projOpp: po, projLeader: leader(cat, pm, po), projClose: closeness(cat, pm, po),
    };
  });
  const score = { me: 0, opp: 0, tie: 0 };
  const projScore = { me: 0, opp: 0, tie: 0 };
  categories.forEach(c => { score[c.leader]++; projScore[c.projLeader]++; });

  // Lineup alerts. This league's lineups lock "Daily - Tomorrow", so today's
  // lineup is frozen — the actionable alerts are for tomorrow.
  const alerts = [];
  for (const p of mine) {
    if (p.game && !p.active && !['IL', 'IL+', 'IL+LT'].includes(p.slot) && !OUT_STATUSES.has(p.status)) {
      alerts.push({ level: 'warn', when: 'today', text: `${p.name} plays today but is on your bench (stats won't count).` });
    }
    if (p.counting && OUT_STATUSES.has(p.status)) {
      alerts.push({ level: 'warn', when: 'today', text: `${p.name} is in your lineup but listed ${p.status}.` });
    }
  }
  if (myTomorrow) {
    const playsTomorrow = new Set();
    for (const g of weekGames.filter(x => x.date === tomorrow)) { playsTomorrow.add(g.home); playsTomorrow.add(g.away); }
    const tm = myTomorrow.map(p => ({ ...p, team: nbaTeam(p.team) }));
    const idleStarters = tm.filter(p => !INACTIVE_SLOTS.has(p.slot) && (!playsTomorrow.has(p.team) || OUT_STATUSES.has(p.status)));
    const benchPlayers = tm.filter(p => p.slot === 'BN' && playsTomorrow.has(p.team) && !OUT_STATUSES.has(p.status));
    if (benchPlayers.length && idleStarters.length) {
      alerts.push({
        level: 'action', when: 'tomorrow',
        text: `Set tomorrow's lineup: ${benchPlayers.map(p => p.name).join(', ')} play${benchPlayers.length === 1 ? 's' : ''} tomorrow from your bench while ${idleStarters.map(p => `${p.name}${OUT_STATUSES.has(p.status) ? ` (${p.status})` : ' (no game)'}`).join(', ')} ${idleStarters.length === 1 ? 'is' : 'are'} in an active slot.`,
      });
    }
  }

  const liveCount = sbGames.filter(g => g.status === 2).length;
  return {
    asOf: new Date().toISOString(),
    date: today,
    week, weekStart: bounds.start, weekEnd: bounds.end,
    league: ctx.leagueName,
    me: { name: me?.name || ctx.teamName, key: ctx.teamKey },
    opp: opp ? { name: opp.name, key: opp.key } : null,
    score, projScore, categories,
    games: sbGames,
    liveCount,
    allFinal: sbGames.length > 0 && sbGames.every(g => g.status === 3),
    players: { me: mine, opp: theirs },
    alerts,
    feedError: scoreboard.error || null,
  };
}
