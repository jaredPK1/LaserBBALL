// Morning report, posted to Discord once a day: where the matchup stands,
// win probability through the week (chart), last night's recap (your lines,
// categories that changed hands, odds that moved), tomorrow's lineup moves,
// and what to watch. Each morning's state is kept so the next one can diff.
import { yget, merge, each, parsePlayer, ownerSession, myContext } from './yahoo.js';
import { etDate, addDays } from './nba.js';
import { yahooLine, CATS, weekBounds } from './gamenight.js';
import { weekProjection, addsUsed, OUT } from './weekly.js';
import { weekReview } from './review.js';
import { lineupRun, lineupMode, lastRun, saveRun } from './lineup.js';
import { notify, appUrl } from './notify.js';
import { storeConfigured, getJson, setJson } from './store.js';

const NCATS = CATS.length;
// Express's req.query is read-only; reuse page handlers with our own query
export const withQuery = (req, query) => Object.defineProperty(req, 'query', { value: query, writable: true, configurable: true });

// Chance of winning more categories than you lose (≥5 of 9), from each
// category's win chance; ties count as not won
export function weekWinProb(cats) {
  let dist = [1];
  for (const c of cats) {
    const next = new Array(dist.length + 1).fill(0);
    dist.forEach((p, k) => { next[k] += p * (1 - c.winProb); next[k + 1] += p * c.winProb; });
    dist = next;
  }
  return dist.slice(Math.floor(NCATS / 2) + 1).reduce((a, b) => a + b, 0);
}

export const leader = (cat, mine, opp) => {
  if (mine == null || opp == null || Math.abs(mine - opp) < (cat.pct ? 0.0005 : 0.001)) return 'tie';
  return (cat.low ? mine < opp : mine > opp) ? 'me' : 'opp';
};

// Categories whose current leader changed since the last snapshot, and win
// chances that moved a lot
export function changes(prev, now) {
  if (!prev) return { flips: [], moves: [] };
  const before = new Map(prev.cats.map(c => [c.name, c]));
  const flips = [], moves = [];
  for (const c of now.cats) {
    const b = before.get(c.name);
    if (!b) continue;
    const cat = CATS.find(x => x.name === c.name) || {};
    const l0 = leader(cat, b.mine, b.opp), l1 = leader(cat, c.mine, c.opp);
    if (l0 !== l1) flips.push({ name: c.name, from: l0, to: l1 });
    if (Math.abs(c.p - b.p) >= 0.15) moves.push({ name: c.name, from: b.p, to: c.p });
  }
  return { flips, moves };
}

// Last night's box lines for a team's players, starters only (bench stats don't count)
export async function nightLines(req, res, teamKey, date) {
  const data = await yget(req, res, `team/${teamKey}/roster;date=${date}/players/stats;type=date;date=${date}`);
  const r = merge(data.fantasy_content.team.slice(1)).roster;
  return each(r?.['0']?.players || r?.players, 'player').map(parsePlayer).map(p => {
    const l = yahooLine(p.stats || {});
    return { name: p.name, slot: p.slot, played: (l.fga || 0) + (l.fta || 0) + (l.pts || 0) + (l.reb || 0) + (l.ast || 0) > 0, l };
  }).filter(p => p.played);
}
export const fmtLine = ({ name, l }) => `**${name}** ${Math.round(l.pts)} pts${l.tpm ? `, ${Math.round(l.tpm)} 3PM` : ''}${l.stl ? `, ${Math.round(l.stl)} STL` : ''}${l.blk ? `, ${Math.round(l.blk)} BLK` : ''}, ${Math.round(l.fgm)}/${Math.round(l.fga)} FG${l.to >= 4 ? `, ${Math.round(l.to)} TO` : ''}`;
export const score = l => l.pts + 1.5 * l.tpm + 3 * l.stl + 3 * l.blk - l.to;
const pct = p => `${Math.round(p * 100)}%`;
const DAY = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

// Win-probability chart as an image Discord can show (QuickChart renders Chart.js configs)
export function chartUrl(series, start) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const byDate = new Map(series.map(s => [s.date, s]));
  const cfg = {
    type: 'line',
    data: {
      labels: days.map(DAY),
      datasets: [
        { label: 'Win %', data: days.map(d => (byDate.has(d) ? Math.round(byDate.get(d).winWeek * 100) : null)), borderColor: '#2563eb', backgroundColor: '#2563eb', borderWidth: 2, pointRadius: 4, fill: false, spanGaps: true },
        { label: '50%', data: days.map(() => 50), borderColor: '#9ca3af', borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: false },
      ],
    },
    options: {
      legend: { display: false },
      title: { display: true, text: 'Chance to win the week, each morning' },
      scales: { yAxes: [{ ticks: { min: 0, max: 100, stepSize: 25, callback: '__PCT__' }, gridLines: { color: '#eef0f3' } }], xAxes: [{ gridLines: { display: false } }] },
    },
  };
  const json = JSON.stringify(cfg).replace('"__PCT__"', '(v) => v + "%"');
  return `https://quickchart.io/chart?w=600&h=280&bkg=white&c=${encodeURIComponent(json)}`;
}

const seriesKey = week => `snap:daily:${week}`;
export const weekSeries = async week => (storeConfigured() ? (await getJson(seriesKey(week)).catch(() => null))?.days || [] : []);

export async function buildReport(req, res, lineup) {
  const today = etDate();
  const proj = await weekProjection(withQuery(req, {}), res);
  const now = {
    date: today,
    expected: proj.expectedWins,
    winWeek: weekWinProb(proj.categories),
    cats: proj.categories.map(c => ({ name: c.name, mine: c.mineNow, opp: c.oppNow, p: c.winProb })),
  };
  const series = (await weekSeries(proj.week)).filter(s => s.date !== today);
  const prev = series.at(-1) || null;
  if (storeConfigured()) await setJson(seriesKey(proj.week), { week: proj.week, start: proj.start, days: [...series, now] });
  const { flips, moves } = changes(prev, now);

  const yesterday = addDays(today, -1);
  const opp = proj.opp;
  const [mine, theirs, adds, lastWeek] = await Promise.all([
    yesterday >= proj.start && proj.me?.key ? nightLines(req, res, proj.me.key, yesterday).catch(() => null) : null,
    yesterday >= proj.start && opp?.key ? nightLines(req, res, opp.key, yesterday).catch(() => null) : null,
    proj.me?.key ? addsUsed(req, res, proj.me.key) : null,
    today === proj.start && proj.week > 1 ? weekReview(withQuery(req, { week: proj.week - 1 }), res).catch(() => null) : null,
  ]);

  const swing = proj.categories.filter(c => c.winProb > 0.35 && c.winProb < 0.65).map(c => `${c.name} ${pct(c.winProb)}`);
  const gl = list => Math.round(list.reduce((a, p) => a + (p.gamesCounted || 0), 0));
  const hurt = (lineup?.lineup || []).filter(p => p.status && (OUT.has(p.status) || ['Q', 'GTD', 'DTD'].includes(p.status)));
  const url = `${appUrl(req)}/week`;
  const embeds = [];

  const standing = proj.categories.map(c => {
    const l = leader(CATS.find(x => x.name === c.name) || {}, c.mineNow, c.oppNow);
    return `${l === 'me' ? '🟢' : l === 'opp' ? '🔴' : '⚪'} ${c.name} ${pct(c.winProb)}`;
  }).join(' · ');
  embeds.push({
    title: `Week ${proj.week} vs ${opp?.manager || opp?.name || 'opponent'}: ${pct(now.winWeek)} to win`,
    url,
    description: [
      `Projected **${now.expected.toFixed(1)} of 9** categories${prev ? ` (${now.expected - prev.expected >= 0 ? '+' : ''}${(now.expected - prev.expected).toFixed(1)} since yesterday)` : ''}. Every category counts in the standings.`,
      standing,
      '🟢 leading now · 🔴 trailing now · % = chance to win it by Sunday',
    ].join('\n'),
    image: { url: chartUrl([...series, now], proj.start) },
  });

  const recap = [];
  if (lastWeek?.record) recap.push(`**Last week final:** ${lastWeek.record.w}-${lastWeek.record.l}${lastWeek.record.t ? `-${lastWeek.record.t}` : ''} vs ${lastWeek.opp?.name || 'opponent'}.`);
  if (flips.length) recap.push(`**Changed hands:** ${flips.map(f => `${f.name} → ${f.to === 'me' ? 'you' : f.to === 'opp' ? 'them' : 'tied'}`).join(', ')}`);
  if (moves.length) recap.push(`**Odds moved:** ${moves.map(m => `${m.name} ${pct(m.from)} → ${pct(m.to)}`).join(', ')}`);
  if (mine) {
    const counted = mine.filter(p => p.slot !== 'BN' && p.slot !== 'IL' && p.slot !== 'IL+');
    const wasted = mine.filter(p => p.slot === 'BN');
    recap.push(counted.length ? `**Your night:**\n${counted.sort((a, b) => score(b.l) - score(a.l)).map(fmtLine).join('\n')}` : '**Your night:** no starters played.');
    if (wasted.length) recap.push(`⚠️ **Played on your bench (didn’t count):** ${wasted.map(p => p.name).join(', ')}`);
  }
  if (theirs?.length) {
    const top = theirs.filter(p => p.slot !== 'BN').sort((a, b) => score(b.l) - score(a.l)).slice(0, 2);
    if (top.length) recap.push(`**Their best:** ${top.map(fmtLine).join(' · ')}`);
  }
  if (recap.length) embeds.push({ title: `Last night (${DAY(yesterday)})`, description: recap.join('\n') });

  const lu = lineup?.steps?.length
    ? `${lineup.applied ? '✅ Set in Yahoo:' : 'Make these in Yahoo before midnight:'}\n${lineup.steps.map(s => `• ${s}`).join('\n')}`
    : lineup ? 'Already right. Nothing to change.' : null;
  if (lu) embeds.push({ title: `Tomorrow’s lineup (${DAY(addDays(today, 1))})`, description: lu });

  const watch = [];
  if (swing.length) watch.push(`**Swing categories:** ${swing.join(', ')}. Adds and starts should target these.`);
  watch.push(`**Games left:** you ${gl(proj.players.me)}, them ${gl(proj.players.opp)}.`);
  if (adds != null) watch.push(`**Adds:** ${adds} of 4 used this week.`);
  if (hurt.length) watch.push(`**Injuries:** ${hurt.map(p => `${p.name} (${p.status})`).join(', ')}`);
  embeds.push({ title: 'Watch', description: watch.join('\n') });

  return { embeds, now, flips, moves };
}

// Vercel Cron, once a morning. Uses the stored owner login (no browser).
// Protected by CRON_SECRET when set; otherwise at most one run per 30 min.
export async function dailyCron(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) throw Object.assign(new Error('Forbidden'), { status: 403 });
  const mode = await lineupMode();
  if (mode === 'off') return { skipped: 'off' };
  const last = await lastRun();
  if (!secret && last?.ranAt && Date.now() - Date.parse(last.ranAt) < 30 * 60_000) return { skipped: 'ran recently' };
  const owner = await ownerSession();
  if (!owner) { await saveRun({ mode, error: 'No saved Yahoo login yet: open the app once to connect.' }); return { skipped: 'no owner' }; }
  req._session = owner;
  try {
    const lineup = await lineupRun(req, res, mode).catch(e => ({ error: e.message }));
    const report = await buildReport(req, res, lineup.error ? null : lineup);
    if (lineup.error) report.embeds.push({ title: 'Lineup check failed', description: lineup.error });
    const sent = await notify({ embeds: report.embeds }).catch(e => ({ sent: false, reason: e.message }));
    const doc = { date: lineup.date, mode, steps: lineup.steps || [], applied: !!lineup.applied, reason: lineup.reason, notified: sent.sent, notifyError: sent.sent ? undefined : sent.reason, winWeek: report.now.winWeek };
    await saveRun(doc);
    return doc;
  } catch (e) {
    await saveRun({ mode, error: e.message });
    throw e;
  }
}

// For the app's chart
export async function weekSeriesRoute(req, res) {
  const ctx = await myContext(req, res);
  const week = Number(req.query.week) || ctx.currentWeek;
  const { start, end } = await weekBounds(req, res, week);
  return { week, start, end, days: await weekSeries(week) };
}
