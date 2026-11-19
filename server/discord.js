// Discord bot: slash commands (/odds, /matchup, /iam, /rivalry, /compare,
// /trades, /pickem, /setup) and the weekly pick'em with buttons. Discord
// calls /api/discord/interactions; every request is signature-checked.
// Yahoo data is read with the owner's login on a private copy of the request.
import crypto from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { yget, merge, each, parsePlayer, parseTeamInfo, myContext, ownerSession, isAuthed } from './yahoo.js';
import { nbaTeam } from './nba.js';
import { espnRates, ratesFor, rosOf, realWeight, nick } from './weekly.js';
import { leagueRosters, findTrades } from './manage.js';
import { cachedOdds, PLAYOFF_SPOTS } from './odds.js';
import { loadSeasons, currentManagers, rivalry, rivalryLine, seasonLabel } from './rivalry.js';
import { storeConfigured, getJson, setJson } from './store.js';

const API = 'https://discord.com/api/v10';
const EPHEMERAL = 64;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const pct = p => `${Math.round(p * 100)}%`;
const noCookies = { getHeader: () => undefined, setHeader: () => {} };

export const botConfigured = () => !!(process.env.DISCORD_APP_ID && process.env.DISCORD_PUBLIC_KEY && process.env.DISCORD_BOT_TOKEN);

// Ed25519 check of Discord's signature over timestamp + raw body
export function verifySignature(publicKeyHex, signatureHex, timestamp, rawBody) {
  try {
    const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.concat([Buffer.from(timestamp || ''), rawBody || Buffer.alloc(0)]), key, Buffer.from(signatureHex || '', 'hex'));
  } catch { return false; }
}

async function bot(path, init = {}) {
  const r = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json', ...init.headers } });
  const text = await r.text();
  if (!r.ok) throw bad(`Discord ${r.status}: ${text.slice(0, 200)}`, 502);
  return text ? JSON.parse(text) : null;
}

async function ownerReq(req) {
  const owner = await ownerSession();
  if (!owner) throw bad('The app owner needs to open the app once first.', 503);
  const r = Object.create(req);
  r._session = owner;
  return r;
}

async function leagueTeams(r) {
  const ctx = await myContext(r, noCookies);
  const data = await yget(r, noCookies, `league/${ctx.leagueKey}/teams`);
  return { ctx, teams: each(merge(data.fantasy_content.league.slice(1)).teams, 'team').map(node => ({ ...parseTeamInfo(node), manager: nick(node) })) };
}

const userOf = i => i.member?.user || i.user || {};
const nameOf = i => i.member?.nick || userOf(i).global_name || userOf(i).username || 'someone';
const opt = (i, name) => i.data?.options?.find(o => o.name === name)?.value;
const reply = (data, ephemeral = false) => ({ type: 4, data: { ...data, ...(ephemeral ? { flags: EPHEMERAL } : {}), allowed_mentions: { parse: [] } } });
const linked = async i => (await getJson(`discord:link:${userOf(i).id}`).catch(() => null))?.teamKey || null;

// ── Commands ────────────────────────────────────────────────────────────────
export function commandDefs(teams) {
  const teamOpt = (required, description = 'Team') => ({ type: 3, name: 'team', description, required, choices: teams.slice(0, 25).map(t => ({ name: `${t.name}${t.manager ? ` (${t.manager})` : ''}`.slice(0, 100), value: t.key })) });
  return [
    { name: 'odds', description: 'Playoff odds for every team' },
    { name: 'matchup', description: 'Where a matchup stands right now', options: [teamOpt(false, 'Team (default: yours)')] },
    { name: 'iam', description: 'Link yourself to your team (for /matchup, /trades, /rivalry)', options: [teamOpt(true, 'Your team')] },
    { name: 'rivalry', description: 'All-time head-to-head between you and another team', options: [teamOpt(true, 'Opponent')] },
    { name: 'compare', description: 'Compare two players', options: [{ type: 3, name: 'player1', description: 'First player', required: true }, { type: 3, name: 'player2', description: 'Second player', required: true }] },
    { name: 'trades', description: 'Trade ideas for your team (only you see them)' },
    { name: 'pickem', description: 'Pick’em leaderboard' },
    { name: 'setup', description: 'Commissioner: post the weekly pick’em in this channel', default_member_permissions: '32' },
  ];
}

// Settings button: (re)register commands with this league's team choices
export async function registerCommands(req) {
  if (!isAuthed(req)) throw bad('Not connected to Yahoo', 401);
  if (!botConfigured()) throw bad('Add DISCORD_APP_ID, DISCORD_PUBLIC_KEY and DISCORD_BOT_TOKEN in Vercel first.', 503);
  const { teams } = await leagueTeams(req);
  const out = await bot(`/applications/${process.env.DISCORD_APP_ID}/commands`, { method: 'PUT', body: JSON.stringify(commandDefs(teams)) });
  return { registered: out.map(c => c.name), invite: `https://discord.com/oauth2/authorize?client_id=${process.env.DISCORD_APP_ID}&scope=bot%20applications.commands&permissions=18432` };
}

export async function botStatus(req) {
  if (!isAuthed(req)) throw bad('Not connected to Yahoo', 401);
  const cfg = await getJson('cfg:bot').catch(() => null);
  return { configured: botConfigured(), channelSet: !!cfg?.channelId, endpoint: `${(process.env.PUBLIC_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/$/, '')}/api/discord/interactions` };
}

async function cmdOdds() {
  const o = await cachedOdds();
  if (!o) return reply({ content: 'Odds haven’t been calculated yet. They update every Monday.' }, true);
  return reply({ embeds: [{ title: `📊 Playoff odds · ${PLAYOFF_SPOTS} make it`, description: o.teams.map((t, i) => `${i + 1}. **${t.name}** ${pct(t.playoffs)}${i + 1 === PLAYOFF_SPOTS ? '\n── playoff line ──' : ''}`).join('\n'), footer: { text: `As of ${new Date(o.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` } }] });
}

async function cmdMatchup(i) {
  const team = opt(i, 'team') || await linked(i);
  if (!team) return reply({ content: 'Pick a team, or link yours first with /iam.' }, true);
  const latest = await getJson('snap:recap:latest').catch(() => null);
  const rec = latest ? await getJson(`snap:recap:${latest.week}`).catch(() => null) : null;
  const day = rec?.days?.at(-1);
  const m = day?.matchups.find(x => x.a === team || x.b === team);
  if (!m) return reply({ content: 'No matchup data yet. It refreshes every morning with the league recap.' }, true);
  const flip = m.b === team;
  const name = k => rec.teams?.[k]?.name || k;
  const me = flip ? m.b : m.a, them = flip ? m.a : m.b;
  const rows = m.cats.map(c => {
    const p = flip ? 1 - c.p : c.p;
    const [a, b] = flip ? [c.opp, c.mine] : [c.mine, c.opp];
    const fmt = v => (v == null ? '–' : c.name.includes('%') ? Number(v).toFixed(3).replace(/^0/, '') : Math.round(v));
    return `${p >= 0.5 ? '🟢' : '🔴'} **${c.name}** ${fmt(a)}–${fmt(b)} · ${pct(p)}`;
  });
  const win = flip ? 1 - m.winA : m.winA;
  return reply({ embeds: [{ title: `${name(me)} vs ${name(them)}: ${pct(win)} to win`, description: rows.join('\n'), footer: { text: `As of ${day.date} morning · % = chance to win the category` } }] });
}

async function cmdIam(i) {
  const team = opt(i, 'team');
  await setJson(`discord:link:${userOf(i).id}`, { teamKey: team, name: nameOf(i), at: new Date().toISOString() });
  return reply({ content: 'Linked. /matchup, /trades and /rivalry now default to your team.' }, true);
}

async function cmdPickem() {
  const board = await pickemBoard();
  if (!board.length) return reply({ content: 'No pick’em results yet. Picks open every Monday.' }, true);
  return reply({ embeds: [{ title: '🎯 Pick’em leaderboard', description: board.map((b, n) => `${n + 1}. ${b.name}: ${b.correct}/${b.total}`).join('\n') }] });
}

async function cmdSetup(i) {
  await setJson('cfg:bot', { channelId: i.channel_id || i.channel?.id, guildId: i.guild_id, by: nameOf(i), at: new Date().toISOString() });
  return reply({ content: 'Done. The weekly pick’em will be posted in this channel every Monday.' }, true);
}

// Slow commands: answer "thinking…" now, fill in when ready
async function cmdRivalry(r, i) {
  const me = await linked(i);
  if (!me) return { content: 'Link your team first with /iam.' };
  const other = opt(i, 'team');
  const ctx = await myContext(r, noCookies);
  const [mgrs, seasons] = await Promise.all([currentManagers(r, noCookies, ctx.leagueKey), loadSeasons()]);
  const a = mgrs.get(me), b = mgrs.get(other);
  if (!a || !b) return { content: 'Couldn’t find one of those teams.' };
  const rv = rivalry(seasons, a.managerId, b.managerId);
  const po = rv.playoffs.map(p => `${seasonLabel(p.season)} wk ${p.week}: ${p.a > p.b ? a.nickname : b.nickname} ${Math.max(p.a, p.b)}-${Math.min(p.a, p.b)}`);
  return { embeds: [{ title: `⚔️ ${a.name} vs ${b.name}`, description: [rivalryLine(rv, a.nickname || a.name, b.nickname || b.name), po.length ? `Playoff meetings: ${po.join(' · ')}` : null].filter(Boolean).join('\n') }] };
}

async function cmdCompare(r, i) {
  const ctx = await myContext(r, noCookies);
  const espn = await espnRates();
  const w = realWeight(ctx.currentWeek);
  const find = async q => {
    const d = await yget(r, noCookies, `league/${ctx.leagueKey}/players;search=${encodeURIComponent(q)};count=1/stats;type=average_season`);
    const node = each(merge(d.fantasy_content.league).players, 'player')[0];
    if (!node) return null;
    const p = parsePlayer(node);
    const rates = ratesFor(p, espn, w).rates;
    return { name: p.name, team: nbaTeam(p.team), pos: p.displayPos, status: p.status, rates, rank: rosOf(p.name, espn, rates).rosRank };
  };
  const [a, b] = await Promise.all([find(opt(i, 'player1')), find(opt(i, 'player2'))]);
  if (!a || !b) return { content: `Couldn’t find ${!a ? opt(i, 'player1') : opt(i, 'player2')}.` };
  const row = (label, f, low = false) => {
    const x = f(a), y = f(b);
    const better = x === y ? '' : (low ? x < y : x > y) ? ' ◀' : '';
    const worse = x === y ? '' : (low ? y < x : y > x) ? ' ▶' : '';
    return `${label}: **${typeof x === 'number' ? x.toFixed(label.includes('%') ? 3 : 1) : x}**${better} vs **${typeof y === 'number' ? y.toFixed(label.includes('%') ? 3 : 1) : y}**${worse}`;
  };
  const r2 = p => p.rates;
  return {
    embeds: [{
      title: `${a.name} vs ${b.name}`,
      description: [
        `${a.team} ${a.pos}${a.status ? ` (${a.status})` : ''} · ${b.team} ${b.pos}${b.status ? ` (${b.status})` : ''}`,
        row('PTS', p => r2(p).pts), row('REB', p => r2(p).reb), row('AST', p => r2(p).ast), row('STL', p => r2(p).stl), row('BLK', p => r2(p).blk),
        row('3PM', p => r2(p).tpm), row('TO', p => r2(p).to, true),
        row('FG%', p => (r2(p).fga ? r2(p).fgm / r2(p).fga : 0)), row('FT%', p => (r2(p).fta ? r2(p).ftm / r2(p).fta : 0)),
        `Rest-of-season rank: **#${a.rank ?? '–'}** vs **#${b.rank ?? '–'}**`,
      ].join('\n'),
      footer: { text: 'Per game: this season blended with ESPN’s projection' },
    }],
  };
}

async function cmdTrades(r, i) {
  const me = await linked(i);
  if (!me) return { content: 'Link your team first with /iam.' };
  const ctx = await myContext(r, noCookies);
  const espn = await espnRates();
  const teams = await leagueRosters(r, noCookies, { ...ctx, teamKey: me }, espn);
  const mine = teams.find(t => t.key === me);
  const ideas = findTrades(mine, teams, { limit: 6, perPartner: 2 });
  if (!ideas.length) return { content: 'No trade the math likes right now that helps you without hurting the other side.' };
  return {
    embeds: [{
      title: `💼 Trade ideas for ${mine.name}`,
      description: ideas.map(d => `• Give **${d.give.join(' + ')}** to ${d.partner.manager || d.partner.name} for **${d.get}**: you +${d.myGain.toFixed(2)}, them ${d.theirGain >= 0 ? '+' : ''}${d.theirGain.toFixed(2)} cats/week${d.youGain.length ? ` (you gain ${d.youGain.join(', ')})` : ''}${d.winWin ? ' · win-win' : ''}`).join('\n'),
      footer: { text: 'Only you can see this. Pitch them on what they gain.' },
    }],
  };
}

const SLOW = { rivalry: [cmdRivalry, false], compare: [cmdCompare, false], trades: [cmdTrades, true] };

async function followUp(token, data) {
  await fetch(`${API}/webhooks/${process.env.DISCORD_APP_ID}/${token}/messages/@original`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, allowed_mentions: { parse: [] } }) });
}

// ── Pick'em ─────────────────────────────────────────────────────────────────
const PICKS = week => `pick:${week}`;

export async function postPickem(week, pairs, names, lockAt) {
  if (!botConfigured()) return { posted: false, reason: 'Discord bot not set up' };
  const cfg = await getJson('cfg:bot').catch(() => null);
  if (!cfg?.channelId) return { posted: false, reason: 'Run /setup in the league channel first' };
  const label = k => names.get(k)?.name || k;
  await setJson(PICKS(week), { week, pairs, names: Object.fromEntries([...names].map(([k, v]) => [k, v.name])), lockAt, picks: {}, users: {} });
  await bot(`/channels/${cfg.channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      embeds: [{ title: `🎯 Week ${week} pick’em`, description: 'Who wins each matchup (more categories)? Tap your picks. Picks lock tonight at tip-off, and you can change them until then.' }],
      components: pairs.slice(0, 5).map(([a, b], n) => ({
        type: 1,
        components: [a, b].map(k => ({ type: 2, style: 2, label: label(k).slice(0, 80), custom_id: `pk:${week}:${n}:${k}` })),
      })),
    }),
  });
  return { posted: true };
}

async function onPick(i) {
  const [, week, n, team] = String(i.data.custom_id).split(':');
  const doc = await getJson(PICKS(week)).catch(() => null);
  if (!doc) return reply({ content: 'This pick’em has expired.' }, true);
  if (doc.lockAt && Date.now() > Date.parse(doc.lockAt)) return reply({ content: 'Picks are locked for this week.' }, true);
  const uid = userOf(i).id;
  doc.picks[uid] = { ...(doc.picks[uid] || {}), [n]: team };
  doc.users[uid] = nameOf(i);
  await setJson(PICKS(week), doc);
  const made = Object.keys(doc.picks[uid]).length;
  return reply({ content: `Locked in **${doc.names[team] || team}**. ${made}/${doc.pairs.length} picks made.` }, true);
}

// results: [{ winnerKey, loserKey }] for the week
export async function scorePickem(week, results) {
  const doc = await getJson(PICKS(week)).catch(() => null);
  if (!doc || doc.scored) return null;
  const winners = new Set(results.map(r => r.winnerKey).filter(Boolean));
  const board = (await getJson('pickem:board').catch(() => null)) || { users: {} };
  let best = null, players = 0;
  for (const [uid, picks] of Object.entries(doc.picks)) {
    const total = Object.keys(picks).length;
    const correct = Object.values(picks).filter(k => winners.has(k)).length;
    const u = board.users[uid] || { name: doc.users[uid], correct: 0, total: 0 };
    board.users[uid] = { name: doc.users[uid] || u.name, correct: u.correct + correct, total: u.total + total };
    players++;
    if (!best || correct > best.correct) best = { name: doc.users[uid], correct, total };
  }
  await setJson('pickem:board', board);
  await setJson(PICKS(week), { ...doc, scored: true });
  return { players, best };
}

export async function pickemBoard() {
  const board = await getJson('pickem:board').catch(() => null);
  return Object.values(board?.users || {}).sort((a, b) => b.correct - a.correct || a.total - b.total);
}

// ── Endpoint ────────────────────────────────────────────────────────────────
export async function interactions(req) {
  if (!botConfigured()) throw bad('Discord bot not set up', 503);
  const ok = verifySignature(process.env.DISCORD_PUBLIC_KEY, req.headers['x-signature-ed25519'], req.headers['x-signature-timestamp'], req.rawBody);
  if (!ok) throw bad('invalid request signature', 401);
  const i = req.body || {};
  if (i.type === 1) return { type: 1 }; // PING
  if (!storeConfigured()) return reply({ content: 'The app’s storage isn’t set up.' }, true);
  if (i.type === 3 && String(i.data?.custom_id).startsWith('pk:')) return onPick(i);
  if (i.type !== 2) return reply({ content: 'Unsupported.' }, true);
  const name = i.data?.name;
  const fast = { odds: cmdOdds, matchup: cmdMatchup, iam: cmdIam, pickem: cmdPickem, setup: cmdSetup }[name];
  if (fast) return fast(i);
  const slow = SLOW[name];
  if (!slow) return reply({ content: 'Unknown command.' }, true);
  const [fn, ephemeral] = slow;
  const work = (async () => {
    try {
      const r = await ownerReq(req);
      await followUp(i.token, await fn(r, i));
    } catch (e) {
      await followUp(i.token, { content: `Sorry, that didn’t work: ${e.message}` }).catch(() => {});
    }
  })();
  waitUntil(work);
  return { type: 5, data: ephemeral ? { flags: EPHEMERAL } : {} };
}
