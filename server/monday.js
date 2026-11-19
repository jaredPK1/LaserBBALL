// Monday special for the league channel (its own cron, so the daily recap
// stays fast): playoff odds, last week's awards, rivalry history for this
// week's matchups, the Trade Desk, and pick'em results; then a fresh pick'em.
import { yget, merge, each, myContext, ownerSession } from './yahoo.js';
import { etDate } from './nba.js';
import { addDays } from './nba.js';
import { yahooLine } from './gamenight.js';
import { powerWeek, parseScoreboard } from './league.js';
import { findTrades } from './manage.js';
import { withQuery, score } from './report.js';
import { recapKey, lastWeekResults } from './recap.js';
import { playoffOdds, PLAYOFF_SPOTS } from './odds.js';
import { loadSeasons, currentManagers, rivalry, rivalryLine } from './rivalry.js';
import { scorePickem, pickemBoard, postPickem } from './discord.js';
import { notify } from './notify.js';
import { storeConfigured, getJson, setJson } from './store.js';

const pct = p => `${Math.round(p * 100)}%`;
const arrow = (now, prev) => (prev == null ? '' : Math.round((now - prev) * 100) >= 3 ? ` ▲${Math.round((now - prev) * 100)}` : Math.round((prev - now) * 100) >= 3 ? ` ▼${Math.round((prev - now) * 100)}` : '');

// Points left on each team's bench during a week: nights from start to start+6
async function weekBench(week, start) {
  const end = addDays(start, 6);
  const docs = await Promise.all([week, week + 1].map(w => getJson(recapKey(w)).catch(() => null)));
  const tot = {};
  for (const d of docs) for (const day of d?.days || []) {
    if (!day.night || day.night < start || day.night > end) continue;
    for (const [k, v] of Object.entries(day.bench || {})) tot[k] = (tot[k] || 0) + v;
  }
  return tot;
}

// Best pickup last week: added players' totals for that week (skipped if Yahoo won't say)
async function waiverHawk(req, res, lk, week, start, label) {
  const tx = await yget(req, res, `league/${lk}/transactions;types=add,drop`);
  const end = addDays(start, 6);
  const adds = [];
  for (const t of each(merge(tx?.fantasy_content?.league?.slice?.(1) || []).transactions, 'transaction')) {
    const meta = merge(t[0] || t);
    const day = meta.timestamp ? new Date(Number(meta.timestamp) * 1000).toISOString().slice(0, 10) : null;
    if (!day || day < addDays(start, -1) || day > end) continue;
    for (const pl of each(merge(t.slice?.(1) || []).players, 'player')) {
      const info = merge(pl[0]);
      const raw = merge(pl.slice(1)).transaction_data;
      for (const td of (Array.isArray(raw) ? raw : [raw]).filter(Boolean)) if (td.type === 'add') adds.push({ key: info.player_key, name: info.name?.full, team: td.destination_team_key });
    }
  }
  if (!adds.length) return null;
  const data = await yget(req, res, `league/${lk}/players;player_keys=${adds.map(a => a.key).join(',')}/stats;type=week;week=${week}`);
  const stats = new Map(each(merge(data.fantasy_content.league).players, 'player').map(node => {
    const info = merge(node[0]);
    const st = merge(node.slice(1)).player_stats?.stats || [];
    return [info.player_key, yahooLine(Object.fromEntries(st.map(x => [String(x.stat.stat_id), x.stat.value])))];
  }));
  const best = adds.map(a => ({ ...a, l: stats.get(a.key) })).filter(a => a.l && a.l.pts > 0).sort((x, y) => score(y.l) - score(x.l))[0];
  return best ? `🦅 **Waiver Hawk:** ${label(best.team)} grabbed **${best.name}**: ${Math.round(best.l.pts)} pts, ${Math.round(best.l.reb)} reb, ${Math.round(best.l.tpm)} 3PM for the week.` : null;
}

// Win-win trades the math likes, across the league (one direction per deal)
export function tradeDesk(rosters, limit = 4) {
  const seen = new Set(), deals = [];
  for (const me of rosters) {
    for (const d of findTrades(me, rosters, { limit: 3, perPartner: 1 })) {
      if (!d.winWin) continue;
      const id = [me.key, d.partner.key].sort().join('|') + [...d.give, d.get].sort().join('|');
      if (seen.has(id)) continue;
      seen.add(id);
      deals.push({ from: me, ...d, total: d.myGain + d.theirGain });
    }
  }
  return deals.sort((a, b) => b.total - a.total).slice(0, limit);
}

export async function buildMonday(req, res) {
  const ctx = await myContext(req, res);
  const week = ctx.currentWeek, prevWeek = week - 1;
  const rec = await getJson(recapKey(week)).catch(() => null);
  const live = rec?.days?.at(-1)?.matchups?.map(m => ({ a: m.a, b: m.b, cats: m.cats.map(c => ({ aWin: c.p })) })) || null;
  const prevRec = prevWeek >= 1 ? await getJson(recapKey(prevWeek)).catch(() => null) : null;

  const [odds, results, power, mgrs, seasons, pairsNow] = await Promise.all([
    playoffOdds(req, res, { liveMatchups: live }),
    prevWeek >= 1 ? lastWeekResults(req, res, prevWeek).catch(() => null) : null,
    prevWeek >= 1 ? powerWeek(withQuery(req, { week: prevWeek }), res).catch(() => null) : null,
    currentManagers(req, res, ctx.leagueKey).catch(() => new Map()),
    loadSeasons().catch(() => []),
    live ? live.map(m => [m.a, m.b]) : yget(req, res, `league/${ctx.leagueKey}/scoreboard;week=${week}`).then(d => parseScoreboard(d).map(p => [p[0].key, p[1].key])),
  ]);
  const names = new Map(odds.teams.map(t => [t.key, { name: t.name, manager: t.manager }]));
  const label = k => names.get(k)?.name || k;
  const embeds = [];

  // Playoff odds
  embeds.push({
    title: `📊 Playoff odds · ${PLAYOFF_SPOTS} make it · ${odds.weeksLeft} week${odds.weeksLeft === 1 ? '' : 's'} left`,
    description: odds.teams.map((t, i) => `${i + 1}. **${t.name}** ${pct(t.playoffs)}${arrow(t.playoffs, t.prev)} · proj ${t.projWins.toFixed(0)} cat wins${i + 1 === PLAYOFF_SPOTS ? '\n── playoff line ──' : ''}`).join('\n')
      + '\n_Simulated 4,000 times from current rosters and the remaining schedule._',
  });

  // Awards
  const aw = [];
  const r = power?.rankings || [];
  if (r.length) {
    const mvp = [...r].sort((a, b) => b.allPlay.pct - a.allPlay.pct)[0];
    aw.push(`🏆 **Manager of the Week:** ${mvp.name} (${mvp.manager}). ${mvp.allPlay.w}-${mvp.allPlay.l} against the whole league.`);
    const unlucky = r.filter(t => t.result && t.result.w < t.result.l && t.allPlay.beats >= t.allPlay.of / 2).sort((a, b) => b.allPlay.pct - a.allPlay.pct)[0];
    if (unlucky) aw.push(`💔 **Unluckiest Loss:** ${unlucky.name}. Those numbers beat ${unlucky.allPlay.beats} of ${unlucky.allPlay.of} teams, and they still lost to ${unlucky.result.opp}.`);
    const lucky = r.filter(t => t.result && t.result.w > t.result.l && t.allPlay.beats < t.allPlay.of / 2).sort((a, b) => a.allPlay.pct - b.allPlay.pct)[0];
    if (lucky) aw.push(`🍀 **Lucky Duck:** ${lucky.name} won while beating only ${lucky.allPlay.beats} of ${lucky.allPlay.of} teams on paper.`);
  }
  if (prevRec?.start) {
    const bench = await weekBench(prevWeek, prevRec.start);
    const sleepy = Object.entries(bench).sort((a, b) => b[1] - a[1])[0];
    if (sleepy && sleepy[1] >= 20) aw.push(`😴 **Sleepwalker:** ${label(sleepy[0])} left ${sleepy[1]} points on the bench.`);
    const hawk = await waiverHawk(req, res, ctx.leagueKey, prevWeek, prevRec.start, label).catch(() => null);
    if (hawk) aw.push(hawk);
  }
  if (aw.length) embeds.push({ title: `🏅 Week ${prevWeek} awards`, description: aw.join('\n') });

  // Rivalry watch for this week's matchups
  if (seasons.length && mgrs.size) {
    const lines = pairsNow.map(([a, b]) => {
      const ma = mgrs.get(a), mb = mgrs.get(b);
      if (!ma || !mb) return null;
      return `**${label(a)} vs ${label(b)}.** ${rivalryLine(rivalry(seasons, ma.managerId, mb.managerId), ma.nickname || label(a), mb.nickname || label(b))}`;
    }).filter(Boolean);
    if (lines.length) embeds.push({ title: `⚔️ Rivalry watch · week ${week}`, description: lines.join('\n') });
  }

  // Trade Desk
  const deals = tradeDesk(odds.rosters);
  if (deals.length) {
    embeds.push({
      title: '💼 Trade Desk',
      description: `Deals the math says help **both** sides (category wins per week):\n${deals.map(d => `• **${d.from.name}** sends ${d.give.join(' + ')} to **${d.partner.name}** for ${d.get} (${d.from.name} +${d.myGain.toFixed(2)}, ${d.partner.name} +${d.theirGain.toFixed(2)})`).join('\n')}\n_Want ideas for your own team? Type /trades._`,
    });
  }

  // Pick'em: score last week, show the leaderboard
  if (results?.length) {
    const scored = await scorePickem(prevWeek, results).catch(() => null);
    const board = await pickemBoard().catch(() => []);
    if (scored?.players || board.length) {
      embeds.push({
        title: '🎯 Pick’em',
        description: [
          scored?.best ? `Week ${prevWeek}: **${scored.best.name}** went ${scored.best.correct}/${scored.best.total}.` : null,
          board.length ? `Season: ${board.slice(0, 5).map((b, i) => `${i + 1}. ${b.name} ${b.correct}/${b.total}`).join(' · ')}` : null,
        ].filter(Boolean).join('\n'),
      });
    }
  }

  return { embeds, pairsNow, names, week };
}

const RUN = 'snap:monday:last';

export async function mondayCron(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) throw Object.assign(new Error('Forbidden'), { status: 403 });
  if ((await getJson('cfg:recap').catch(() => null))?.on === false) return { skipped: 'off' };
  const last = await getJson(RUN).catch(() => null);
  if (!secret && last?.ranAt && Date.now() - Date.parse(last.ranAt) < 30 * 60_000) return { skipped: 'ran recently' };
  const owner = await ownerSession();
  if (!owner) return { skipped: 'no owner' };
  req._session = owner;
  try {
    const m = await buildMonday(req, res);
    const sent = await notify({ embeds: m.embeds, channel: 'league' });
    // Picks lock around the first tip-off Monday evening (6:30pm ET in winter)
    const pick = await postPickem(m.week, m.pairsNow, m.names, `${etDate()}T23:30:00Z`).catch(e => ({ posted: false, reason: e.message }));
    const doc = { ranAt: new Date().toISOString(), sent: sent.sent, reason: sent.reason, pickem: pick };
    if (storeConfigured()) await setJson(RUN, doc);
    return doc;
  } catch (e) {
    if (storeConfigured()) await setJson(RUN, { ranAt: new Date().toISOString(), error: e.message }).catch(() => {});
    throw e;
  }
}

export const mondayPreview = (req, res) => buildMonday(req, res).then(m => ({ embeds: m.embeds }));
