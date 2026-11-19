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
  if (req.method === 'POST' && req.body?.remove) await delJson(SUB(String(req.body.remove)));
  const subs = (await listJson('sub:')).filter(s => s.doc?.teamKey)
    .map(({ doc }) => ({ teamKey: doc.teamKey, teamName: doc.teamName, manager: doc.manager, joinedAt: doc.joinedAt, lastSent: doc.lastSent || null, lastError: doc.lastError || null }));
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
export async function sendIntel(req, res) {
  if (!storeConfigured()) return { sent: 0 };
  const subs = (await listJson('sub:')).map(s => s.doc).filter(d => d?.teamKey && d.s);
  if (!subs.length) return { sent: 0 };
  const { buildReport } = await import('./report.js');
  const { lineupSuggest } = await import('./lineup.js');
  const out = { sent: 0, failed: 0, removed: 0 };
  // A few at a time keeps the run inside the function's time limit
  for (let i = 0; i < subs.length; i += 3) {
    await Promise.all(subs.slice(i, i + 3).map(async sub => {
      const r = Object.create(req);
      r._asTeam = sub.teamKey;
      try {
        const lineup = await lineupSuggest(r, res).catch(() => null);
        const report = await buildReport(r, res, lineup, { team: sub.teamKey });
        const url = unseal(sub.s)?.url;
        const sent = url ? await postWebhook(url, report.embeds) : { sent: false, status: 0 };
        if (sent.status === 404) { // webhook deleted: they unsubscribed
          await delJson(SUB(sub.teamKey));
          out.removed++;
          return;
        }
        await setJson(SUB(sub.teamKey), { ...sub, lastSent: sent.sent ? new Date().toISOString() : sub.lastSent, lastError: sent.sent ? null : `Discord ${sent.status}` });
        if (sent.sent) out.sent++; else out.failed++;
      } catch (e) {
        await setJson(SUB(sub.teamKey), { ...sub, lastError: e.message }).catch(() => {});
        out.failed++;
      }
    }));
  }
  return out;
}
