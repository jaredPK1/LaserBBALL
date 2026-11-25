// The Morning Whistle: a league-wide recap posted to the league's Discord
// channel. Neutral by design (every team gets the same treatment, nothing
// from your private analysis), and a little cheeky. Each morning: every
// matchup's score and odds, categories that changed hands overnight, stars of
// the night, a stat corner, and the standings race. Mondays add last week's
// results and power-ranking movers.
import { yget, merge, each, ownerSession, myContext, isAuthed } from './yahoo.js';
import { etDate, addDays } from './nba.js';
import { CATS } from './gamenight.js';
import { leagueWeek, powerWeek, parseScoreboard } from './league.js';
import { withQuery, leader, nightLines, fmtLine, score, weekWinProb, changes } from './report.js';
import { notify } from './notify.js';
import { espnRates } from './weekly.js';
import { leagueRosters, seasonStrength } from './manage.js';
import { storeConfigured, getJson, setJson } from './store.js';

const PLAYOFF_SPOTS = 6;
const pct = p => `${Math.round(p * 100)}%`;
const DAY = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
const catOf = name => CATS.find(c => c.name === name) || {};

// Same pick for the same day and slot, different across days
function pick(list, seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return list[Math.abs(h) % list.length];
}
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

const LINES = {
  intro: [
    'Coffee’s on. Here’s what your fantasy teams did while you were asleep.',
    'Another night, another round of people refreshing box scores at midnight. Here’s the damage.',
    'The numbers are in, and some of you should be worried.',
    'Good morning, managers. Some of you won last night. Some of you started an injured guy.',
    'Rise and grind. The categories don’t care about your feelings.',
  ],
  swing: [
    '**{team}** went from {from} to {to} overnight. That’s a plot twist.',
    'Biggest swing of the night: **{team}**, {from} → {to}. Somebody check on {other}.',
    '**{team}** found another gear: {from} to win yesterday, {to} now.',
  ],
  close: [
    'Closest race on the board: **{a}** vs **{b}**, basically a coin flip.',
    '**{a}** vs **{b}** is going down to the wire. Nobody blink.',
  ],
  star: [
    '{line} for {team}. Absolute cinema.',
    '{line}. {team} would like to thank the academy.',
    '{line}. {team} is printing category wins.',
  ],
  bench: [
    '{pts} points scored on benches league-wide. Biggest offender: **{name}** ({p} pts) riding the pine for {team}.',
    'The bench mob put up {pts} points that counted for exactly nothing. Shoutout to **{name}** ({p} pts, {team}).',
  ],
  turnover: ['Butterfingers award: **{name}** with {n} turnovers for {team}.', '**{name}** gave it away {n} times ({team}). Generous.'],
  sniper: ['Sharpshooter: **{name}** went {m}/{a} from the field for {team}.', '**{name}** couldn’t miss: {m}/{a} FG ({team}).'],
  splash: ['Splash of the night: **{name}** drained {n} threes for {team}.', '**{name}** let it fly: {n} threes ({team}).'],
};

const label = t => `${t.name}${t.manager ? ` (${t.manager})` : ''}`;

// Category score right now from team A's side: wins-losses-ties
function catScore(cats) {
  let a = 0, b = 0, t = 0;
  for (const c of cats) {
    const l = leader(catOf(c.name), c.aNow, c.bNow);
    if (l === 'me') a++; else if (l === 'opp') b++; else t++;
  }
  return { a, b, t };
}

export const recapKey = week => `snap:recap:${week}`;

export async function buildRecap(req, res) {
  const today = etDate();
  const yesterday = addDays(today, -1);
  const lw = await leagueWeek(withQuery(req, {}), res);
  const teams = new Map(lw.matchups.flatMap(m => m.teams.map(t => [t.key, t])));
  const keys = [...teams.keys()];
  const monday = today === lw.start;

  const [nights, lastWeek, power] = await Promise.all([
    Promise.all(keys.map(k => nightLines(req, res, k, yesterday).then(l => [k, l]).catch(() => [k, []]))).then(e => new Map(e)),
    monday && lw.week > 1 ? lastWeekResults(req, res, lw.week - 1).catch(() => null) : null,
    monday ? powerWeek(withQuery(req, {}), res).catch(() => null) : null,
  ]);

  // Today's state per matchup, and yesterday's for the diff
  const now = lw.matchups.map(m => ({
    a: m.teams[0].key, b: m.teams[1].key,
    winA: weekWinProb(m.cats.map(c => ({ winProb: c.aWin }))),
    cats: m.cats.map(c => ({ name: c.name, mine: c.aNow, opp: c.bNow, p: c.aWin })),
  }));
  const hist = storeConfigured() ? (await getJson(recapKey(lw.week)).catch(() => null))?.days || [] : [];
  const prevDay = hist.filter(d => d.date !== today).at(-1);
  // Points scored on each team's bench last night (for the weekly Sleepwalker award)
  const benchBy = Object.fromEntries(keys.map(k => [k, Math.round((nights.get(k) || []).filter(p => p.slot === 'BN').reduce((a, p) => a + p.l.pts, 0))]));
  const teamInfo = Object.fromEntries(keys.map(k => [k, { name: teams.get(k).name, manager: teams.get(k).manager }]));
  if (storeConfigured()) await setJson('snap:recap:latest', { week: lw.week, date: today });
  if (storeConfigured()) await setJson(recapKey(lw.week), { week: lw.week, start: lw.start, teams: teamInfo, days: [...hist.filter(d => d.date !== today), { date: today, night: yesterday, matchups: now, bench: benchBy }] });
  const prevOf = m => prevDay?.matchups.find(p => p.a === m.a && p.b === m.b) || null;

  // Everyone's starters who played last night
  const lines = keys.flatMap(k => (nights.get(k) || []).map(p => ({ ...p, team: label(teams.get(k)), teamKey: k })));
  const starters = lines.filter(p => !['BN', 'IL', 'IL+', 'IL+LT', 'NA'].includes(p.slot));
  const bench = lines.filter(p => p.slot === 'BN');
  const seed = s => `${today}:${s}`;

  // Headline: biggest odds swing, else the closest race
  const swings = now.map(m => {
    const p = prevOf(m);
    if (!p) return null;
    const d = m.winA - p.winA;
    const [up, down] = d >= 0 ? [m.a, m.b] : [m.b, m.a];
    return { d: Math.abs(d), team: teams.get(up).name, other: teams.get(down).manager || teams.get(down).name, from: pct(d >= 0 ? p.winA : 1 - p.winA), to: pct(d >= 0 ? m.winA : 1 - m.winA) };
  }).filter(Boolean).sort((x, y) => y.d - x.d);
  const closest = [...now].sort((x, y) => Math.abs(x.winA - 0.5) - Math.abs(y.winA - 0.5))[0];
  const headline = swings[0]?.d >= 0.15
    ? fill(pick(LINES.swing, seed('swing')), swings[0])
    : closest ? fill(pick(LINES.close, seed('close')), { a: teams.get(closest.a).name, b: teams.get(closest.b).name }) : '';

  const embeds = [{
    title: `🏀 The Morning Whistle · ${DAY(today)}`,
    description: [pick(LINES.intro, seed('intro')), headline].filter(Boolean).join('\n\n'),
  }];

  if (lastWeek?.length) {
    embeds.push({
      title: `🏁 Week ${lw.week - 1} final`,
      description: lastWeek.map(r => `**${r.winner}** ${r.w}-${r.l}${r.t ? `-${r.t}` : ''} over ${r.loser}`).join('\n'),
    });
  }

  embeds.push({
    title: `Week ${lw.week} matchups`,
    fields: lw.matchups.map((m, i) => {
      const [A, B] = m.teams;
      const sc = catScore(m.cats);
      const n = now[i];
      const p = prevOf(n);
      const { flips } = changes(p ? { cats: p.cats } : null, { cats: n.cats });
      const best = key => (nights.get(key) || []).filter(x => !['BN', 'IL', 'IL+'].includes(x.slot)).sort((x, y) => score(y.l) - score(x.l))[0];
      const bA = best(A.key), bB = best(B.key);
      const move = p ? n.winA - p.winA : 0;
      const valueLines = [
        `Odds to win the week: ${A.name} **${pct(n.winA)}** · ${B.name} **${pct(1 - n.winA)}**${Math.abs(move) >= 0.05 ? ` (${move > 0 ? A.name : B.name} ▲${Math.round(Math.abs(move) * 100)})` : ''}`,
        flips.length ? `Changed hands: ${flips.map(f => `${f.name} → ${f.to === 'me' ? A.name : f.to === 'opp' ? B.name : 'tied'}`).join(', ')}` : null,
        bA || bB ? `Last night: ${[bA && `${A.manager || A.name}: ${fmtLine(bA)}`, bB && `${B.manager || B.name}: ${fmtLine(bB)}`].filter(Boolean).join(' · ')}` : null,
      ].filter(Boolean);
      return { name: `${label(A)} ${sc.a}-${sc.b}${sc.t ? `-${sc.t}` : ''} ${label(B)}`, value: valueLines.join('\n').slice(0, 1024) };
    }),
  });

  const stars = [...starters].sort((x, y) => score(y.l) - score(x.l)).slice(0, 3);
  if (stars.length) {
    embeds.push({
      title: '⭐ Stars of the night',
      description: stars.map((s, i) => `${['🥇', '🥈', '🥉'][i]} ${fill(pick(LINES.star, seed(`star${i}`)), { line: fmtLine(s), team: s.team })}`).join('\n'),
    });
  }

  const corner = [];
  const sniper = starters.filter(p => p.l.fga >= 10).sort((x, y) => y.l.fgm / y.l.fga - x.l.fgm / x.l.fga)[0];
  if (sniper) corner.push(fill(pick(LINES.sniper, seed('sniper')), { name: sniper.name, m: Math.round(sniper.l.fgm), a: Math.round(sniper.l.fga), team: sniper.team }));
  const splash = [...starters].sort((x, y) => y.l.tpm - x.l.tpm)[0];
  if (splash?.l.tpm >= 4) corner.push(fill(pick(LINES.splash, seed('splash')), { name: splash.name, n: Math.round(splash.l.tpm), team: splash.team }));
  const butter = [...starters].sort((x, y) => y.l.to - x.l.to)[0];
  if (butter?.l.to >= 5) corner.push(fill(pick(LINES.turnover, seed('to')), { name: butter.name, n: Math.round(butter.l.to), team: butter.team }));
  const benchPts = Math.round(bench.reduce((a, p) => a + p.l.pts, 0));
  const benchTop = [...bench].sort((x, y) => y.l.pts - x.l.pts)[0];
  if (benchTop?.l.pts >= 10) corner.push(fill(pick(LINES.bench, seed('bench')), { pts: benchPts, name: benchTop.name, p: Math.round(benchTop.l.pts), team: benchTop.team }));
  const teamThrees = keys.map(k => ({ k, n: starters.filter(p => p.teamKey === k).reduce((a, p) => a + p.l.tpm, 0) })).sort((x, y) => y.n - x.n)[0];
  if (teamThrees?.n >= 10) corner.push(`Team three-point barrage: **${teams.get(teamThrees.k).name}** hit ${Math.round(teamThrees.n)} as a team.`);
  if (corner.length) embeds.push({ title: '📊 Stat corner', description: corner.join('\n') });

  const trades = await tradeGrades(req, res).catch(() => null);
  if (trades) embeds.push(trades.embed);

  // Standings race: projected after this week, with the playoff line
  const race = lw.standings.map(t => {
    const move = t.rank && t.projRank ? t.rank - t.projRank : 0;
    return `${t.projRank}. ${t.name} ${t.projW.toFixed(1)}-${t.projL.toFixed(1)}${move > 0 ? ` ▲${move}` : move < 0 ? ` ▼${-move}` : ''}${t.projRank === PLAYOFF_SPOTS ? '\n── playoff line ──' : ''}`;
  });
  embeds.push({ title: '📈 Projected standings after this week', description: race.join('\n') });

  if (power?.rankings?.length) {
    const r = power.rankings;
    const moved = r.filter(t => t.prevRank != null).map(t => ({ ...t, d: t.prevRank - t.rank })).sort((x, y) => y.d - x.d);
    const lines2 = [`👑 #1: **${r[0].name}** (${r[0].manager})`];
    if (moved[0]?.d > 0) lines2.push(`🚀 Riser: **${moved[0].name}** up ${moved[0].d}`);
    if (moved.at(-1)?.d < 0) lines2.push(`📉 Faller: **${moved.at(-1).name}** down ${-moved.at(-1).d}`);
    lines2.push(`🔦 Last place: **${r.at(-1).name}**. It can only go up from here.`);
    embeds.push({ title: '🏆 Power rankings', description: lines2.join('\n') });
  }

  return { embeds: embeds.slice(0, 10), tradeIds: trades?.ids || [] };
}

// Final category results for each of last week's matchups
// ── Trade grades ────────────────────────────────────────────────────────────
// Recent completed trades, graded by the season model: each side's average
// category wins per week against the league, before vs after the deal
const GRADED = 'snap:tradesGraded';
export const letter = d => (d >= 0.15 ? 'A' : d >= 0.07 ? 'B' : d >= -0.03 ? 'C' : d >= -0.1 ? 'D' : 'F');

export function parseTrades(data, since) {
  const out = [];
  for (const t of each(merge(data?.fantasy_content?.league?.slice?.(1) || []).transactions, 'transaction')) {
    const meta = merge(t[0] || t);
    if (meta.type !== 'trade' || (meta.status && meta.status !== 'successful')) continue;
    const ts = Number(meta.timestamp) * 1000;
    if (!ts || ts < since) continue;
    const moves = [];
    for (const pl of each(merge(t.slice?.(1) || []).players, 'player')) {
      const info = merge(pl[0]);
      const raw = merge(pl.slice(1)).transaction_data;
      for (const td of (Array.isArray(raw) ? raw : [raw]).filter(Boolean)) {
        if (td.source_team_key && td.destination_team_key) moves.push({ key: info.player_key, name: info.name?.full, from: td.source_team_key, to: td.destination_team_key });
      }
    }
    if (moves.length) out.push({ id: meta.transaction_key || `${ts}`, ts, moves });
  }
  return out;
}

// rosters: [{ key, name, manager, players: [{ key, ... }] }] as they are now (after the trade)
export function gradeTrade(trade, rosters) {
  const sides = [...new Set(trade.moves.flatMap(m => [m.from, m.to]))];
  if (sides.length !== 2) return null;
  const byKey = new Map(rosters.map(t => [t.key, t]));
  if (!sides.every(k => byKey.has(k))) return null;
  const playerOf = new Map(rosters.flatMap(t => t.players.map(p => [p.key, p])));
  const before = new Map(sides.map(k => {
    const received = new Set(trade.moves.filter(m => m.to === k).map(m => m.key));
    const given = trade.moves.filter(m => m.from === k).map(m => playerOf.get(m.key)).filter(Boolean);
    return [k, [...byKey.get(k).players.filter(p => !received.has(p.key)), ...given]];
  }));
  const rest = rosters.filter(t => !sides.includes(t.key)).map(t => t.players);
  const [a, b] = sides;
  const strength = (k, mine, theirs) => seasonStrength(mine, [theirs, ...rest]).expected;
  return sides.map(k => {
    const o = k === a ? b : a;
    const delta = strength(k, byKey.get(k).players, byKey.get(o).players) - strength(k, before.get(k), before.get(o));
    return { key: k, name: byKey.get(k).name, gets: trade.moves.filter(m => m.to === k).map(m => m.name), delta, grade: letter(delta) };
  }).sort((x, y) => y.delta - x.delta); // the side that did better first
}

async function tradeGrades(req, res) {
  if (!storeConfigured()) return null;
  const ctx = await myContext(req, res);
  const data = await yget(req, res, `league/${ctx.leagueKey}/transactions;types=trade`).catch(() => null);
  const done = new Set((await getJson(GRADED).catch(() => null))?.ids || []);
  const fresh = parseTrades(data, Date.now() - 7 * 864e5).filter(t => !done.has(t.id));
  if (!fresh.length) return null;
  const rosters = await leagueRosters(req, res, ctx, await espnRates());
  const lines = [];
  for (const t of fresh) {
    const g = gradeTrade(t, rosters);
    if (!g) continue;
    const [x, y] = g;
    const winner = Math.abs(x.delta - y.delta) < 0.04 ? 'Fair deal by the numbers.' : `The model likes **${(x.delta > y.delta ? x : y).name}**’s side.`;
    lines.push(`**${x.name}** gets ${x.gets.join(' + ')} · **${y.name}** gets ${y.gets.join(' + ')}\n${x.name} **${x.grade}** (${x.delta >= 0 ? '+' : ''}${x.delta.toFixed(2)} cats/week) · ${y.name} **${y.grade}** (${y.delta >= 0 ? '+' : ''}${y.delta.toFixed(2)}). ${winner}`);
  }
  return lines.length ? { embed: { title: '💱 Trade grades', description: lines.join('\n\n') + '\n_Season model: average category wins per week against the league, before vs after._' }, ids: fresh.map(t => t.id) } : null;
}

export async function markTradesGraded(ids) {
  if (!ids?.length || !storeConfigured()) return;
  const cur = (await getJson(GRADED).catch(() => null))?.ids || [];
  await setJson(GRADED, { ids: [...new Set([...cur, ...ids])].slice(-200) });
}

export async function lastWeekResults(req, res, week) {
  const ctx = await myContext(req, res);
  const data = await yget(req, res, `league/${ctx.leagueKey}/scoreboard;week=${week}`);
  return parseScoreboard(data, true).map(pair => {
    const [A, B] = pair;
    let a = 0, b = 0, t = 0;
    for (const c of CATS) {
      const w = pair.winners[c.id];
      if (w === 'tie') t++; else if (w === A.key) a++; else if (w === B.key) b++;
    }
    const [win, lose, w, l] = a >= b ? [A, B, a, b] : [B, A, b, a];
    return { winner: label(win), loser: label(lose), winnerKey: a === b ? null : win.key, loserKey: a === b ? null : lose.key, w, l, t };
  });
}

// ── Config, preview, cron ───────────────────────────────────────────────────
const CFG = 'cfg:recap';
const RUN = 'snap:recap:last';

export async function recapConfig(req) {
  if (!isAuthed(req)) throw Object.assign(new Error('Not connected to Yahoo'), { status: 401 });
  if (req.method === 'POST') await setJson(CFG, { on: !!req.body?.on, updatedAt: new Date().toISOString() });
  const [cfg, last] = await Promise.all([getJson(CFG).catch(() => null), getJson(RUN).catch(() => null)]);
  return { on: cfg?.on !== false, lastRun: last };
}

export const recapPreview = (req, res) => buildRecap(req, res).then(r => ({ embeds: r.embeds }));

export async function recapSendNow(req, res) {
  const r = await buildRecap(req, res);
  const sent = await notify({ embeds: r.embeds, channel: 'league' });
  if (sent.sent) await markTradesGraded(r.tradeIds);
  await setJson(RUN, { ranAt: new Date().toISOString(), manual: true, sent: sent.sent, reason: sent.reason }).catch(() => {});
  return sent;
}

export async function recapCron(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) throw Object.assign(new Error('Forbidden'), { status: 403 });
  const cfg = await getJson(CFG).catch(() => null);
  if (cfg?.on === false) return { skipped: 'off' };
  const last = await getJson(RUN).catch(() => null);
  if (!secret && last?.ranAt && Date.now() - Date.parse(last.ranAt) < 30 * 60_000) return { skipped: 'ran recently' };
  const owner = await ownerSession();
  if (!owner) return { skipped: 'no owner' };
  req._session = owner;
  try {
    const r = await buildRecap(req, res);
    const sent = await notify({ embeds: r.embeds, channel: 'league' });
    if (sent.sent) await markTradesGraded(r.tradeIds);
    const doc = { ranAt: new Date().toISOString(), sent: sent.sent, reason: sent.reason };
    await setJson(RUN, doc);
    return doc;
  } catch (e) {
    await setJson(RUN, { ranAt: new Date().toISOString(), error: e.message }).catch(() => {});
    throw e;
  }
}

