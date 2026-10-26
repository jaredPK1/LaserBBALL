// League this week: every matchup projected by category, the standings now
// and after this week, and which free agents matter to which teams. In
// category H2H your own moves only change your own matchup; they ripple into
// the race through what you take off the wire (a rival can't add them) and
// through who you should be rooting for in the other games.
import { yget, merge, each, parseTeamInfo, myContext } from './yahoo.js';
import { gamesBetween, etDate, addDays, nbaTeam } from './nba.js';
import { CATS, yahooLine, catValue, weekBounds } from './gamenight.js';
import { catResult } from './review.js';
import { storeConfigured, getJson, setJson } from './store.js';
import { parseTeam } from './history.js';
import {
  IL_SLOTS, OUT, espnRates, rosOf, ratesFor, availability, freeAgents, teamGames,
  projectRemaining, categoryOdds, expectedWins, realWeight, datesBetween,
} from './weekly.js';
import { leagueRosters, seasonStrength } from './manage.js';

const NCATS = 9;
const RIVAL_GAP = 9; // within one week's worth of category wins

// Projected wins this week for both sides of every matchup
export function projectMatchups(pairs, rosters, gamesByTeam, dates) {
  return pairs.map(([a, b]) => {
    const pa = projectRemaining(rosters.get(a.key) || [], gamesByTeam, dates);
    const pb = projectRemaining(rosters.get(b.key) || [], gamesByTeam, dates);
    const odds = categoryOdds({ me: yahooLine(a.stats || {}), opp: yahooLine(b.stats || {}) }, pa, pb);
    const ea = expectedWins(odds);
    return { a: a.key, b: b.key, odds, expected: { [a.key]: ea, [b.key]: NCATS - ea } };
  });
}

// Standings after this week, using expected category wins
export function projectStandings(standings, expected) {
  const rows = standings.map(t => {
    const e = expected[t.key] ?? 0;
    return { ...t, weekExpected: e, projW: t.wins + e, projL: t.losses + (NCATS - e) };
  });
  const pct = r => (r.projW + 0.5 * r.ties) / Math.max(1, r.projW + r.projL + r.ties);
  [...rows].sort((x, y) => pct(y) - pct(x)).forEach((r, i) => { r.projRank = i + 1; });
  return rows.sort((x, y) => x.projRank - y.projRank);
}

// Who to root for in each game you're not in: against whichever side is
// closest to you in the projected standings, if they're within reach
export function rootingInterest(matchups, standings, myKey) {
  const me = standings.find(t => t.key === myKey);
  if (!me) return {};
  const out = {};
  for (const m of matchups) {
    if (m.a === myKey || m.b === myKey) continue;
    const gap = k => Math.abs((standings.find(t => t.key === k)?.projW ?? 0) - me.projW);
    const rival = gap(m.a) <= gap(m.b) ? m.a : m.b;
    if (gap(rival) <= RIVAL_GAP) out[`${m.a}|${m.b}`] = { against: rival, rootFor: rival === m.a ? m.b : m.a, gap: gap(rival) };
  }
  return out;
}

// How much each free agent adds to every team's matchup this week, playing
// from `from` and replacing that team's lowest-value healthy player
export function freeAgentRipple(fas, matchups, rosters, gamesByTeam, dates, from) {
  const before = addDays(from, -1);
  const opponent = new Map(matchups.flatMap(m => [[m.a, m.b], [m.b, m.a]]));
  const cur = new Map(matchups.flatMap(m => [[m.a, m.curA], [m.b, m.curB]]));
  const oppProj = new Map([...opponent.keys()].map(k => [k, projectRemaining(rosters.get(opponent.get(k)) || [], gamesByTeam, dates)]));
  const evalTeam = (k, list) => expectedWins(categoryOdds({ me: cur.get(k), opp: cur.get(opponent.get(k)) }, projectRemaining(list, gamesByTeam, dates), oppProj.get(k)));
  const base = new Map([...opponent.keys()].map(k => [k, evalTeam(k, rosters.get(k) || [])]));
  const dropOf = new Map([...opponent.keys()].map(k => {
    const healthy = (rosters.get(k) || []).filter(p => !IL_SLOTS.has(p.slot) && !OUT.has(p.status));
    return [k, healthy.sort((x, y) => (x.rosValue ?? -9) - (y.rosValue ?? -9))[0] || null];
  }));
  return fas.map(fa => ({
    fa,
    gains: Object.fromEntries([...opponent.keys()].map(k => {
      const drop = dropOf.get(k);
      const list = [...(rosters.get(k) || []).map(p => (drop && p.id === drop.id ? { ...p, until: before } : p)), { ...fa, from }];
      return [k, evalTeam(k, list) - base.get(k)];
    })),
  }));
}

function parseScoreboard(data, withWinners = false) {
  const sb = merge(merge(data.fantasy_content.league).scoreboard);
  return each(sb['0']?.matchups || sb.matchups, 'matchup').map(m => {
    const nodes = each(merge(m['0'] || m).teams, 'team');
    const pair = nodes.map(n => ({ ...parseTeamInfo(n), manager: merge(n[0])?.managers?.[0]?.manager?.nickname || null }));
    if (!withWinners) return pair;
    const winners = {};
    for (const sw of m.stat_winners || []) {
      const w = sw.stat_winner;
      if (w) winners[w.stat_id] = Number(w.is_tied) ? 'tie' : w.winner_team_key;
    }
    return Object.assign(pair, { winners });
  }).filter(p => p.length === 2);
}

export async function leagueWeek(req, res) {
  const ctx = await myContext(req, res);
  if (!ctx.teamKey) throw Object.assign(new Error('Could not find your team in this league'), { status: 404 });
  const week = Number(req.query.week) || ctx.currentWeek;
  const today = etDate();
  const espn = await espnRates();
  const [sbData, stData, bounds, teams, faList] = await Promise.all([
    yget(req, res, `league/${ctx.leagueKey}/scoreboard;week=${week}`),
    yget(req, res, `league/${ctx.leagueKey}/standings`),
    weekBounds(req, res, week),
    leagueRosters(req, res, ctx, espn),
    freeAgents(req, res, ctx.leagueKey).catch(() => []),
  ]);
  const etHour = Number(new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }));
  const startDay = today < bounds.start ? bounds.start : etHour >= 19 ? addDays(today, 1) : today;
  const dates = startDay <= bounds.end ? datesBetween(startDay, bounds.end) : [];
  const gamesByTeam = teamGames(dates.length ? await gamesBetween(startDay, bounds.end) : []);

  const rosters = new Map(teams.map(t => [t.key, t.players.map(p => ({ ...p, id: p.key }))]));
  const pairs = parseScoreboard(sbData);
  const projected = projectMatchups(pairs, rosters, gamesByTeam, dates);
  projected.forEach((m, i) => { m.curA = yahooLine(pairs[i][0].stats || {}); m.curB = yahooLine(pairs[i][1].stats || {}); });
  const expected = Object.assign({}, ...projected.map(m => m.expected));

  const stTeams = each(merge(merge(stData.fantasy_content.league).standings).teams, 'team').map(parseTeam);
  const info = new Map(teams.map(t => [t.key, t]));
  const standings = projectStandings(stTeams.map(t => ({
    key: t.teamKey, name: t.name, manager: info.get(t.teamKey)?.manager || t.nickname,
    mine: t.teamKey === ctx.teamKey, rank: t.rank, wins: t.wins, losses: t.losses, ties: t.ties,
  })), expected);
  const rooting = rootingInterest(projected, standings, ctx.teamKey);

  // Free agents worth a look this week, then what each is worth to every team
  const tomorrow = addDays(today, 1);
  const addFrom = startDay > tomorrow ? startDay : tomorrow;
  const w = realWeight(ctx.currentWeek);
  const fas = faList.filter(p => !OUT.has(p.status)).map(p => {
    const r = ratesFor(p, espn, w);
    return { id: p.key, name: p.name, team: nbaTeam(p.team), pos: p.displayPos, status: p.status, rates: r.rates, src: r.src, avail: availability(p), ...rosOf(p.name, espn) };
  }).filter(p => p.src !== 'none' && p.rosValue != null)
    .sort((a, b) => b.rosValue - a.rosValue).slice(0, 10);
  const ripple = dates.length && addFrom <= bounds.end ? freeAgentRipple(fas, projected, rosters, gamesByTeam, dates, addFrom) : [];
  const me = standings.find(t => t.mine);
  const rivalKeys = new Set(standings.filter(t => !t.mine && me && Math.abs(t.projW - me.projW) <= RIVAL_GAP).map(t => t.key));
  const label = k => ({ key: k, name: info.get(k)?.name, manager: info.get(k)?.manager });

  return {
    week, start: bounds.start, end: bounds.end, projectingFrom: startDay,
    matchups: projected.map((m, i) => ({
      teams: pairs[i].map(t => ({ ...label(t.key), mine: t.key === ctx.teamKey, expected: m.expected[t.key], gamesLeft: Math.round([...projectRemaining(rosters.get(t.key) || [], gamesByTeam, dates).gamesUsed.values()].reduce((a, g) => a + g, 0)) })),
      mine: m.a === ctx.teamKey || m.b === ctx.teamKey,
      cats: m.odds.map(c => ({ name: c.name, pct: c.pct, aNow: c.mineNow, bNow: c.oppNow, aEnd: c.mineEnd, bEnd: c.oppEnd, aWin: c.winProb })),
      rooting: rooting[`${m.a}|${m.b}`] ? { against: label(rooting[`${m.a}|${m.b}`].against), rootFor: label(rooting[`${m.a}|${m.b}`].rootFor) } : null,
    })),
    standings,
    freeAgents: ripple.map(({ fa, gains }) => {
      const others = Object.entries(gains).filter(([k]) => k !== ctx.teamKey).map(([k, g]) => ({ ...label(k), gain: g, rival: rivalKeys.has(k) })).sort((a, b) => b.gain - a.gain);
      return {
        name: fa.name, team: fa.team, pos: fa.pos, status: fa.status, rosRank: fa.rosRank,
        mine: gains[ctx.teamKey] ?? 0,
        others: others.slice(0, 3),
        // Denial: the most a team near you in the standings would gain
        denial: Math.max(0, ...others.filter(o => o.rival).map(o => o.gain)),
      };
    }).sort((a, b) => (b.mine + 0.5 * b.denial) - (a.mine + 0.5 * a.denial)),
    addsStartPlaying: addFrom,
  };
}

// ── Power rankings ──────────────────────────────────────────────────────────
// Three views of each team, blended: what they did last week against the
// whole league (all-play, which takes the schedule luck out), their record so
// far, and how strong their current roster projects for an average week.
const W_ROSTER = 0.4, W_ALLPLAY = 0.35, W_RECORD = 0.25;

// Head-to-head categories of one stat line against another
function versus(a, b) {
  let w = 0, l = 0, t = 0;
  for (const cat of CATS) {
    const r = catResult(cat, catValue(cat, a), catValue(cat, b));
    if (r === 'W') w++; else if (r === 'L') l++; else t++;
  }
  return { w, l, t };
}

// teams: [{ key, name, line (last week), result: {w,l,t,opp}, strength: {expected, cats}, record: {wins,losses,ties}, out: [names], moves }]
export function powerRankings(teams, prev = {}) {
  const rankIn = (key, score) => [...teams].sort((x, y) => score(y) - score(x)).findIndex(t => t.key === key) + 1;
  const rows = teams.map(t => {
    let w = 0, l = 0, tie = 0, beats = 0;
    for (const u of teams) {
      if (u.key === t.key) continue;
      const v = versus(t.line, u.line);
      w += v.w; l += v.l; tie += v.t;
      if (v.w > v.l) beats++;
    }
    const games = t.record.wins + t.record.losses + t.record.ties;
    return {
      ...t,
      allPlay: { w, l, t: tie, pct: (w + 0.5 * tie) / Math.max(1, w + l + tie), beats, of: teams.length - 1 },
      recordPct: games ? (t.record.wins + 0.5 * t.record.ties) / games : 0.5,
    };
  });
  for (const r of rows) r.score = W_ROSTER * (r.strength.expected / NCATS) + W_ALLPLAY * r.allPlay.pct + W_RECORD * r.recordPct;
  rows.sort((a, b) => b.score - a.score);

  // Category ranks last week, for "best at / worst at"
  const catRank = Object.fromEntries(CATS.map(cat => {
    const sorted = [...rows].sort((a, b) => (cat.low ? 1 : -1) * (catValue(cat, a.line) - catValue(cat, b.line)));
    return [cat.name, new Map(sorted.map((r, i) => [r.key, i + 1]))];
  }));
  const n = rows.length;
  return rows.map((r, i) => {
    const rank = i + 1;
    const best = CATS.filter(c => catRank[c.name].get(r.key) <= 2).map(c => c.name);
    const worst = CATS.filter(c => catRank[c.name].get(r.key) >= n - 1).map(c => c.name);
    const rosterRank = rankIn(r.key, t => t.strength.expected);
    const apRank = rankIn(r.key, t => rows.find(x => x.key === t.key).allPlay.pct);
    const notes = [];
    if (r.result) {
      const verb = r.result.w > r.result.l ? 'Beat' : r.result.w < r.result.l ? 'Lost to' : 'Tied';
      notes.push(`${verb} ${r.result.opp} ${r.result.w}-${r.result.l}${r.result.t ? `-${r.result.t}` : ''}.`);
      const won = r.result.w > r.result.l, apWinning = r.allPlay.beats > r.allPlay.of / 2;
      if (won && !apWinning) notes.push(`Lucky draw: those numbers beat only ${r.allPlay.beats} of ${r.allPlay.of} teams.`);
      if (!won && r.result.w !== r.result.l && apWinning) notes.push(`Unlucky: those numbers beat ${r.allPlay.beats} of ${r.allPlay.of} teams.`);
    }
    notes.push(`All-play ${r.allPlay.w}-${r.allPlay.l}${r.allPlay.t ? `-${r.allPlay.t}` : ''} (#${apRank} of ${n} last week); roster projects #${rosterRank} for an average week.`);
    if (apRank - rosterRank >= 3) notes.push('Roster is better than last week showed: expect them to climb.');
    if (rosterRank - apRank >= 3) notes.push('Played above their roster last week: likely to cool off.');
    if (r.out?.length) notes.push(`Out: ${r.out.join(', ')}.`);
    return {
      rank, prevRank: prev[r.key] ?? null,
      key: r.key, name: r.name, manager: r.manager, mine: !!r.mine,
      score: r.score, result: r.result, allPlay: r.allPlay, record: r.record,
      rosterExpected: r.strength.expected, rosterRank, allPlayRank: apRank,
      best, worst, moves: r.moves ?? null, notes,
    };
  });
}

export async function powerWeek(req, res) {
  const ctx = await myContext(req, res);
  if (!ctx.teamKey) throw Object.assign(new Error('Could not find your team in this league'), { status: 404 });
  const week = Number(req.query.week) || ctx.currentWeek - 1;
  if (week < 1) return { week: 0, none: true };
  const espn = await espnRates();
  const [sbData, stData, teams] = await Promise.all([
    yget(req, res, `league/${ctx.leagueKey}/scoreboard;week=${week}`),
    yget(req, res, `league/${ctx.leagueKey}/standings`),
    leagueRosters(req, res, ctx, espn),
  ]);
  const pairs = parseScoreboard(sbData, true);
  const stTeams = new Map(each(merge(merge(stData.fantasy_content.league).standings).teams, 'team').map(parseTeam).map(t => [t.teamKey, t]));
  const lines = new Map(), results = new Map();
  for (const pair of pairs) {
    for (const [me, opp] of [[pair[0], pair[1]], [pair[1], pair[0]]]) {
      const line = yahooLine(me.stats || {});
      lines.set(me.key, line);
      let w = 0, l = 0, t = 0;
      for (const cat of CATS) {
        const yw = pair.winners[cat.id];
        const r = yw ? (yw === 'tie' ? 'T' : yw === me.key ? 'W' : 'L') : catResult(cat, catValue(cat, line), catValue(cat, yahooLine(opp.stats || {})));
        if (r === 'W') w++; else if (r === 'L') l++; else t++;
      }
      results.set(me.key, { w, l, t, opp: opp.name });
    }
  }
  const prevSnap = storeConfigured() ? await getJson(`snap:power:${week - 1}`).catch(() => null) : null;
  const prev = prevSnap ? Object.fromEntries(prevSnap.ranks.map(r => [r.key, r.rank])) : {};
  const ranked = powerRankings(teams.filter(t => lines.has(t.key)).map(t => {
    const st = stTeams.get(t.key) || {};
    const top = [...t.players].sort((a, b) => (a.rosRank ?? 999) - (b.rosRank ?? 999)).slice(0, 8);
    return {
      key: t.key, name: t.name, manager: t.manager, mine: t.mine,
      line: lines.get(t.key), result: results.get(t.key),
      strength: seasonStrength(t.players, teams.filter(o => o.key !== t.key).map(o => o.players)),
      record: { wins: st.wins || 0, losses: st.losses || 0, ties: st.ties || 0 },
      out: top.filter(p => OUT.has(p.status)).map(p => p.name),
      moves: st.moves,
    };
  }), prev);
  if (storeConfigured()) await setJson(`snap:power:${week}`, { week, savedAt: new Date().toISOString(), ranks: ranked.map(r => ({ key: r.key, rank: r.rank })) }).catch(() => {});
  return { week, weights: { roster: W_ROSTER, allPlay: W_ALLPLAY, record: W_RECORD }, rankings: ranked };
}
