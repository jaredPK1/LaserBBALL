// Private intel for league-mates: anyone in the league can sign up (with the
// league's join code) to get their own morning report in their own private
// Discord channel. Built from the owner's Yahoo login, since rosters,
// matchups and box scores are visible to everyone in a Yahoo league, so
// nobody else has to connect Yahoo.
import crypto from 'node:crypto';
import { yget, merge, each, parseTeamInfo, myContext, ownerSession, isAuthed } from './yahoo.js';
import { nick } from './weekly.js';
import { seal, unseal } from './session.js';
import { postWebhook, isWebhook, notify, appUrl } from './notify.js';
import { storeConfigured, getJson, setJson, listJson, delJson } from './store.js';

const JOIN = 'cfg:join';
const SUB = key => `sub:${key}`;
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const needAuth = req => { if (!isAuthed(req)) throw bad('Not connected to Yahoo', 401); };

async function joinCode(regenerate = false) {
  const cur = await getJson(JOIN).catch(() => null);
  if (cur?.code && !regenerate) return cur.code;
  const code = crypto.randomBytes(4).toString('hex').toUpperCase();
  await setJson(JOIN, { code, createdAt: new Date().toISOString() });
  return code;
}

async function checkCode(code) {
  if (!storeConfigured()) throw bad('Sign-ups aren’t set up yet', 503);
  const cur = await getJson(JOIN).catch(() => null);
  const a = Buffer.from(String(code || '').toUpperCase()), b = Buffer.from(cur?.code || '');
  if (!cur?.code || a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw bad('That sign-up link isn’t valid. Ask your commissioner for the current one.', 403);
}

// A response that swallows cookies: if Yahoo makes us renew the owner's
// login during a public request, the renewed session must never be set as
// a cookie on the visitor's browser
const noCookies = { getHeader: () => undefined, setHeader: () => {} };

// Teams in the league, read with the owner's login on a private copy of req
async function leagueTeams(req) {
  const owner = await ownerSession();
  if (!owner) throw bad('Sign-ups aren’t ready yet: the app owner needs to open the app once.', 503);
  const r = Object.create(req);
  r._session = owner;
  const ctx = await myContext(r, noCookies);
  const data = await yget(r, noCookies, `league/${ctx.leagueKey}/teams`);
  return each(merge(data.fantasy_content.league.slice(1)).teams, 'team').map(node => {
    const t = parseTeamInfo(node);
    return { key: t.key, name: t.name, manager: nick(node) };
  });
}

// ── Public sign-up (join code required) ─────────────────────────────────────
export async function joinTeams(req) {
  await checkCode(req.query.code);
  const teams = await leagueTeams(req);
  const subs = new Set((await listJson('sub:')).map(s => s.doc.teamKey));
  return { teams: teams.map(t => ({ ...t, signedUp: subs.has(t.key) })) };
}

export async function joinSignup(req) {
  const { code, teamKey, webhook } = req.body || {};
  await checkCode(code);
  if (!isWebhook(webhook)) throw bad('That doesn’t look like a Discord webhook URL (https://discord.com/api/webhooks/…)');
  const team = (await leagueTeams(req)).find(t => t.key === teamKey);
  if (!team) throw bad('Pick your team from the list');
  const hi = await postWebhook(String(webhook).trim(), [{
    title: `You’re in, ${team.manager || team.name}`,
    description: `Every morning (about 8am ET) this channel gets private intel for **${team.name}**: your matchup odds with a chart, last night’s recap, tomorrow’s lineup moves, and what to watch. Only people in this channel can see it.`,
  }]);
  if (!hi.sent) throw bad(`Discord didn’t accept that webhook (${hi.status}). Copy it again from the channel’s Integrations → Webhooks.`);
  await setJson(SUB(teamKey), { teamKey, teamName: team.name, manager: team.manager, s: seal({ url: String(webhook).trim() }), joinedAt: new Date().toISOString() });
  return { ok: true, team: team.name };
}

// ── Owner controls ──────────────────────────────────────────────────────────
export async function intelAdmin(req) {
  needAuth(req);
  if (req.method === 'POST' && req.body?.regenerate) await joinCode(true);
  if (req.method === 'POST' && req.body?.remove) {
    const id = String(req.body.remove);
    await delJson(id.startsWith('dm:') ? `dmsub:${id.slice(3)}` : SUB(id));
  }
  // Team names for DM subscribers, from the latest league recap
  const latest = await getJson('snap:recap:latest').catch(() => null);
  const names = Object.fromEntries(Object.entries((latest ? (await getJson(`snap:recap:${latest.week}`).catch(() => null))?.teams : null) || {}).map(([k, v]) => [k, v.name]));
  const subs = [
    ...(await listJson('sub:')).filter(s => s.doc?.teamKey).map(({ doc }) => ({ id: doc.teamKey, via: 'Channel', teamKey: doc.teamKey, teamName: doc.teamName, manager: doc.manager, joinedAt: doc.joinedAt, lastSent: doc.lastSent || null, lastError: doc.lastError || null })),
    ...(await listJson('dmsub:')).filter(s => s.doc?.userId).map(({ doc }) => ({ id: `dm:${doc.userId}`, via: 'DM', teamKey: doc.teamKey, teamName: names[doc.teamKey] || doc.teamKey, manager: doc.name, joinedAt: doc.at, lastSent: doc.lastSent || null, lastError: doc.lastError || null })),
  ];
  const code = await joinCode();
  return { code, joinUrl: `${appUrl(req)}/join?code=${code}`, subs };
}

// Posts the how-to to the league channel
export async function intelInstructions(req) {
  needAuth(req);
  const code = await joinCode();
  const url = `${appUrl(req)}/join?code=${code}`;
  return notify({
    channel: 'league',
    embeds: [{
      title: '📬 Get your own private morning intel',
      url,
      description: [
        'Every morning (about 8am ET) the app can send **you** a private report: your matchup odds with a chart, last night’s recap, tomorrow’s best lineup moves, and what to watch. Free, takes 2 minutes, no Yahoo login needed.',
        '',
        '**1. Make a private channel for yourself.** In this server: + next to the channel list → Create Channel → name it (e.g. `intel-yourname`) → turn on **Private Channel** → only add yourself.',
        '**2. Make a webhook.** Channel settings (gear) → **Integrations → Webhooks → New Webhook → Copy Webhook URL**. Treat it like a password: don’t post it anywhere.',
        `**3. Sign up:** ${url}\nPick your team, paste the webhook, done. You’ll get a welcome message in your channel right away.`,
        '',
        'Discord won’t let you make a channel or webhook? Ask the commissioner to create your private channel and give you **Manage Webhooks** on it.',
        'Heads-up: server admins can see every channel, private ones included.',
        'To stop, just delete the webhook (or the channel).',
      ].join('\n'),
    }],
  });
}

// ── Morning send (called from the daily job, owner session on req) ───────────
// One report per team, delivered to everyone who wants it: private-channel
// webhooks (sub:<team>) and bot DMs (dmsub:<discord user>)
export async function sendIntel(req, res) {
  if (!storeConfigured()) return { sent: 0 };
  const hooks = (await listJson('sub:')).map(s => s.doc).filter(d => d?.teamKey && d.s).map(d => ({ kind: 'hook', key: SUB(d.teamKey), doc: d }));
  const dms = (await listJson('dmsub:')).map(s => s.doc).filter(d => d?.teamKey && d.userId).map(d => ({ kind: 'dm', key: `dmsub:${d.userId}`, doc: d }));
  const all = [...hooks, ...dms];
  if (!all.length) return { sent: 0 };
  const byTeam = new Map();
  for (const r of all) byTeam.set(r.doc.teamKey, [...(byTeam.get(r.doc.teamKey) || []), r]);
  const { buildReport } = await import('./report.js');
  const { lineupSuggest } = await import('./lineup.js');
  const { sendDM } = await import('./discord.js');
  const out = { sent: 0, failed: 0, removed: 0 };
  const teams = [...byTeam.keys()];
  // A few teams at a time keeps the run inside the function's time limit
  for (let i = 0; i < teams.length; i += 3) {
    await Promise.all(teams.slice(i, i + 3).map(async teamKey => {
      const r = Object.create(req);
      r._asTeam = teamKey;
      let report;
      try {
        const lineup = await lineupSuggest(r, res).catch(() => null);
        report = await buildReport(r, res, lineup, { team: teamKey });
      } catch (e) {
        for (const x of byTeam.get(teamKey)) await setJson(x.key, { ...x.doc, lastError: e.message }).catch(() => {});
        out.failed += byTeam.get(teamKey).length;
        return;
      }
      for (const x of byTeam.get(teamKey)) {
        const sent = x.kind === 'hook'
          ? await postWebhook(unseal(x.doc.s)?.url || '', report.embeds).catch(() => ({ sent: false, status: 0 }))
          : await sendDM(x.doc.userId, report.embeds);
        if (x.kind === 'hook' && sent.status === 404) { // webhook deleted: they unsubscribed
          await delJson(x.key);
          out.removed++;
          continue;
        }
        await setJson(x.key, { ...x.doc, lastSent: sent.sent ? new Date().toISOString() : x.doc.lastSent, lastError: sent.sent ? null : sent.reason || `Discord ${sent.status}` });
        if (sent.sent) out.sent++; else out.failed++;
      }
    }));
  }
  return out;
}
