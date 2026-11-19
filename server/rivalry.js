// All-time head-to-head between two managers, from the saved past seasons
// (hist:<leagueKey>). Managers are matched across seasons by Yahoo account.
import { yget, merge, each } from './yahoo.js';
import { parseTeam } from './history.js';
import { storeConfigured, listJson } from './store.js';

export const seasonLabel = s => `${s}–${String(Number(s) + 1).slice(2)}`;

export async function loadSeasons() {
  if (!storeConfigured()) return [];
  return (await listJson('hist:')).map(r => r.doc).filter(d => d?.teams && d?.weeks).sort((a, b) => a.season - b.season);
}

// Current team key → { managerId, nickname }
export async function currentManagers(req, res, leagueKey) {
  const data = await yget(req, res, `league/${leagueKey}/teams`);
  const teams = each(merge(data.fantasy_content.league).teams, 'team').map(parseTeam);
  return new Map(teams.map(t => [t.teamKey, { managerId: t.managerId, nickname: t.nickname, name: t.name }]));
}

export function rivalry(seasons, idA, idB) {
  const r = { catsA: 0, catsB: 0, catTies: 0, winsA: 0, winsB: 0, draws: 0, meetings: 0, playoffs: [], last: null };
  for (const s of seasons) {
    const mgr = new Map(s.teams.map(t => [t.teamKey, t.managerId]));
    for (const w of s.weeks || []) {
      for (const m of w.matchups || []) {
        if (m.isConsolation) continue;
        const [k1, k2] = m.teams || [];
        const i1 = mgr.get(k1), i2 = mgr.get(k2);
        const forward = i1 === idA && i2 === idB, backward = i1 === idB && i2 === idA;
        if (!forward && !backward) continue;
        const [kA, kB] = forward ? [k1, k2] : [k2, k1];
        let a = 0, b = 0, t = 0;
        for (const v of Object.values(m.winners || {})) { if (v === 'tie') t++; else if (v === kA) a++; else if (v === kB) b++; }
        r.catsA += a; r.catsB += b; r.catTies += t; r.meetings++;
        if (a > b) r.winsA++; else if (b > a) r.winsB++; else r.draws++;
        const meeting = { season: s.season, week: w.week, a, b, t, playoffs: !!m.isPlayoffs };
        if (m.isPlayoffs) r.playoffs.push(meeting);
        r.last = meeting;
      }
    }
  }
  return r;
}

// One line for the recap / slash command
export function rivalryLine(r, nameA, nameB) {
  if (!r.meetings) return `First-ever meeting between ${nameA} and ${nameB}.`;
  const lead = r.catsA === r.catsB ? `${nameA} and ${nameB} are dead even` : r.catsA > r.catsB ? `${nameA} leads ${nameB}` : `${nameB} leads ${nameA}`;
  const [hi, lo] = r.catsA >= r.catsB ? [r.catsA, r.catsB] : [r.catsB, r.catsA];
  const [wHi, wLo] = r.catsA >= r.catsB ? [r.winsA, r.winsB] : [r.winsB, r.winsA];
  const po = r.playoffs.length ? `, ${r.playoffs.length} playoff meeting${r.playoffs.length === 1 ? '' : 's'}` : '';
  const last = r.last ? `. Last time (${seasonLabel(r.last.season)} wk ${r.last.week}): ${r.last.a > r.last.b ? nameA : r.last.b > r.last.a ? nameB : 'nobody'} ${Math.max(r.last.a, r.last.b)}-${Math.min(r.last.a, r.last.b)}` : '';
  return `All-time: ${lead} ${hi}-${lo} in categories (${wHi}-${wLo}${r.draws ? `-${r.draws}` : ''} in matchups${po})${last}.`;
}
