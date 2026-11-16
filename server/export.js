// "Send to Claude": one snapshot of the whole league, saved to the cloud
// store (snap:export) so an assistant with database access can analyze it,
// and offered as a file download. Built from the logged-in Yahoo session;
// each section fails on its own so a slow piece doesn't sink the rest.
import { yget, merge, each, parseTeamInfo, myContext } from './yahoo.js';
import { etDate } from './nba.js';
import { CATS, yahooLine, catValue } from './gamenight.js';
import { historySeason } from './history.js';
import { espnRates } from './weekly.js';
import { leagueRosters } from './manage.js';
import { leagueWeek, powerWeek } from './league.js';
import { storeConfigured, setJson } from './store.js';

const settle = (p) => p.then(v => v, e => ({ error: e.message }));

// Every matchup of a week with both teams' category totals and Yahoo's winners
async function weekResults(req, res, lk, week) {
  const data = await yget(req, res, `league/${lk}/scoreboard;week=${week}`);
  const sb = merge(merge(data.fantasy_content.league).scoreboard);
  return each(sb['0']?.matchups || sb.matchups, 'matchup').map(m => {
    const teams = each(merge(m['0'] || m).teams, 'team').map(parseTeamInfo).map(t => {
      const line = yahooLine(t.stats || {});
      return { key: t.key, name: t.name, cats: Object.fromEntries(CATS.map(c => [c.name, catValue(c, line)])) };
    });
    const winners = {};
    for (const sw of m.stat_winners || []) {
      const s = sw.stat_winner;
      const cat = s && CATS.find(c => c.id === String(s.stat_id));
      if (cat) winners[cat.name] = Number(s.is_tied) ? 'tie' : s.winner_team_key;
    }
    return { status: m.status || null, teams, winners };
  });
}

// League-wide transactions: adds, drops and trades with who moved where
function parseTransactions(data) {
  const txs = each(merge(data?.fantasy_content?.league?.slice?.(1) || []).transactions, 'transaction');
  return txs.map(t => {
    const meta = merge(t[0] || t);
    const players = each(merge(t.slice?.(1) || []).players, 'player').flatMap(pl => {
      const info = merge(pl[0]);
      const raw = merge(pl.slice(1)).transaction_data;
      return (Array.isArray(raw) ? raw : [raw]).filter(Boolean).map(td => ({
        name: info.name?.full, type: td.type, from: td.source_team_name || td.source_type, to: td.destination_team_name || td.destination_type,
      }));
    });
    return { type: meta.type, day: meta.timestamp ? etDate(new Date(Number(meta.timestamp) * 1000)) : null, status: meta.status, players };
  });
}

export async function buildExport(req, res) {
  const ctx = await myContext(req, res);
  if (!ctx.teamKey) throw Object.assign(new Error('Could not find your team in this league'), { status: 404 });
  const lk = ctx.leagueKey;
  const played = Array.from({ length: Math.max(0, ctx.currentWeek) }, (_, i) => i + 1);
  const espn = await espnRates();
  req.params = { ...req.params, leagueKey: lk };

  const [season, weeks, rosters, thisWeek, power, tx] = await Promise.all([
    settle(historySeason(req, res)),
    settle(Promise.all(played.map(w => weekResults(req, res, lk, w).then(m => ({ week: w, matchups: m }))))),
    settle(leagueRosters(req, res, ctx, espn)),
    settle(leagueWeek(req, res)),
    settle(powerWeek(req, res)),
    settle(yget(req, res, `league/${lk}/transactions`).then(parseTransactions)),
  ]);

  return {
    savedAt: new Date().toISOString(),
    league: { key: lk, name: ctx.leagueName || null, currentWeek: ctx.currentWeek, myTeamKey: ctx.teamKey },
    standings: season.error ? season : season.teams,
    draft: season.error ? null : season.draft,
    weeks,
    rosters: rosters.error ? rosters : rosters.map(t => ({
      key: t.key, name: t.name, manager: t.manager, mine: t.mine,
      players: t.players.map(p => ({ name: p.name, team: p.team, pos: p.pos, slot: p.slot, status: p.status, rosRank: p.rosRank, rates: p.rates, src: p.src })),
    })),
    thisWeek,
    power,
    transactions: tx,
  };
}

export async function exportLeague(req, res) {
  const doc = await buildExport(req, res);
  // A storage outage shouldn't block the download
  let storeError = storeConfigured() ? null : 'Cloud storage is not set up';
  if (!storeError) await setJson('snap:export', doc).catch(e => { storeError = e.message; });
  if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="league-week-${doc.league.currentWeek}.json"`);
  return req.query.download ? doc : { ok: true, savedAt: doc.savedAt, stored: !storeError, storeError, sections: Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, v?.error ? `error: ${v.error}` : 'ok'])) };
}
