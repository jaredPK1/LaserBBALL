// League history analysis: your blind spots + scouting reports on leaguemates.
// Input: season payloads from /api/history/season/:key, plus current teams.
import { computeValues } from '../draft/engine.js';

export const CAT_LABELS = { 5: 'FG%', 8: 'FT%', 10: '3PM', 12: 'PTS', 15: 'REB', 16: 'AST', 17: 'STL', 18: 'BLK', 19: 'TO' };
const POS = ['PG', 'SG', 'SF', 'PF', 'C'];
const pct = (w, l, t) => (w + l + t ? (w + t / 2) / (w + l + t) : null);
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// How each drafted player actually performed that season, ranked among all drafted players
export function draftOutcomes(season) {
  const rounds = Math.max(1, ...season.draft.map(d => d.round));
  const pool = season.draft.map(d => ({
    key: d.playerKey, name: d.name, pos: d.pos || [], yahooRank: d.pick,
    hasStats: (d.pts || 0) > 0,
    fgm: d.fgm || 0, fga: d.fga || 0, ftm: d.ftm || 0, fta: d.fta || 0,
    tpm: d.tpm || 0, pts: d.pts || 0, reb: d.reb || 0, ast: d.ast || 0, stl: d.stl || 0, blk: d.blk || 0, to: d.to || 0,
  }));
  const valued = computeValues(pool, { teams: season.numTeams || 10, rounds });
  // Players who never played rank last
  const n = season.draft.length;
  const byKey = new Map(valued.map(p => [p.key, p]));
  return season.draft.map(d => {
    const v = byKey.get(d.playerKey);
    const finish = v?.valueRank ?? n;
    return {
      ...d,
      value: v?.value ?? null,
      finish,
      roi: d.pick - finish,                         // + = outperformed the slot
      reach: d.adp ? d.adp - d.pick : null,         // + = taken earlier than ADP
    };
  });
}

function categoryRecords(season) {
  const rec = {}; // teamKey -> statId -> {w,l,t}
  for (const wk of season.weeks) {
    for (const m of wk.matchups) {
      if (m.isPlayoffs || m.isConsolation || m.teams.length !== 2) continue;
      for (const [statId, winner] of Object.entries(m.winners)) {
        for (const tk of m.teams) {
          const r = ((rec[tk] ||= {})[statId] ||= { w: 0, l: 0, t: 0 });
          if (winner === 'tie') r.t++; else if (winner === tk) r.w++; else r.l++;
        }
      }
    }
  }
  return rec;
}

const addRec = (into, rec) => {
  for (const [id, r] of Object.entries(rec || {})) {
    const t = (into[id] ||= { w: 0, l: 0, t: 0 });
    t.w += r.w; t.l += r.l; t.t += r.t;
  }
};

export function analyze(seasons, currentTeams = []) {
  const done = [...seasons].filter(s => s.teams?.length).sort((a, b) => a.season - b.season);
  const managers = new Map();
  const mgr = (id, nickname) => {
    if (!managers.has(id)) {
      managers.set(id, {
        id, nickname, seasons: [], finishes: [], titles: 0, playoffs: 0, moves: [], trades: [],
        picks: [], cats: {}, isMe: false, teamNames: [],
      });
    }
    return managers.get(id);
  };

  const overview = [];
  const topCats = {};
  const leagueMoves = [];
  const topMoves = [];

  for (const s of done) {
    const outcomes = draftOutcomes(s);
    const cats = categoryRecords(s);
    const teamMgr = new Map(s.teams.map(t => [t.teamKey, t]));
    const finished = s.isFinished;

    for (const t of s.teams) {
      const m = mgr(t.managerId, t.nickname);
      m.nickname = t.nickname || m.nickname;
      m.isMe ||= t.isMe;
      m.seasons.push(s.season);
      m.teamNames.push(t.name);
      if (finished && t.rank) {
        m.finishes.push(t.rank);
        if (t.rank === 1) m.titles++;
        if (t.seed) m.playoffs++;
        m.moves.push(t.moves); m.trades.push(t.trades);
        leagueMoves.push(t.moves);
        if (t.rank <= 3) { topMoves.push(t.moves); addRec(topCats, cats[t.teamKey]); }
      }
      addRec(m.cats, cats[t.teamKey]);
    }
    for (const o of outcomes) {
      const t = teamMgr.get(o.teamKey);
      if (t) mgr(t.managerId, t.nickname).picks.push({ ...o, season: s.season, numTeams: s.numTeams });
    }

    const me = s.teams.find(t => t.isMe);
    const champ = s.teams.find(t => t.rank === 1);
    overview.push({
      season: s.season, finished,
      me: me && { rank: me.rank, record: `${me.wins}-${me.losses}${me.ties ? `-${me.ties}` : ''}`, moves: me.moves, trades: me.trades, name: me.name },
      champion: champ && { name: champ.name, nickname: champ.nickname, moves: champ.moves },
      avgMoves: mean(s.teams.map(t => t.moves)),
    });
  }

  // Link to current teams
  const currentByMgr = new Map(currentTeams.map(t => [t.managerId, t]));
  const profiles = [...managers.values()].map(m => profile(m, currentByMgr.get(m.id)));
  const me = profiles.find(p => p.isMe) || null;

  const catTable = Object.keys(CAT_LABELS).filter(id => me?.cats[id] || topCats[id]).map(id => {
    const mine = me?.cats[id] || { w: 0, l: 0, t: 0 };
    const top = topCats[id] || { w: 0, l: 0, t: 0 };
    return { id, label: CAT_LABELS[id], me: pct(mine.w, mine.l, mine.t), top: pct(top.w, top.l, top.t), rec: mine };
  });

  const ctx = { leagueMoves: mean(leagueMoves), topMoves: mean(topMoves), catTable, seasons: done.length };
  return {
    overview,
    catTable,
    me,
    insights: me ? insights(me, ctx) : [],
    scouting: profiles.filter(p => !p.isMe).sort((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0) || (a.avgFinish ?? 99) - (b.avgFinish ?? 99)),
    leagueAvgMoves: ctx.leagueMoves,
    topAvgMoves: ctx.topMoves,
  };
}

function profile(m, current) {
  const early = m.picks.filter(p => p.round <= 3);
  const earlyPos = Object.fromEntries(POS.map(pos => [pos, early.filter(p => (p.pos || []).includes(pos)).length]));
  const firstC = [];
  const bySeason = {};
  for (const p of m.picks) (bySeason[p.season] ||= []).push(p);
  for (const list of Object.values(bySeason)) {
    const c = list.filter(p => (p.pos || []).includes('C')).sort((a, b) => a.round - b.round)[0];
    if (c) firstC.push(c.round);
  }
  const teamCounts = {};
  for (const p of m.picks) if (p.team) teamCounts[p.team] = (teamCounts[p.team] || 0) + 1;
  const homer = Object.entries(teamCounts)
    .map(([team, n]) => ({ team, n, share: n / m.picks.length }))
    .filter(x => x.n >= 3 && x.share >= 2.5 / 30)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3);
  const reaches = m.picks.filter(p => p.round <= 6 && p.reach != null);
  const busts = m.picks.filter(p => p.round <= 4 && p.finish - p.pick >= (p.numTeams || 10) * 2);
  const steals = m.picks.filter(p => p.round >= 5 && p.pick - p.finish >= (p.numTeams || 10) * 3);
  const roiByRound = {};
  for (const p of m.picks) (roiByRound[p.round] ||= []).push(p.roi);

  const catPct = Object.fromEntries(Object.entries(m.cats).map(([id, r]) => [id, pct(r.w, r.l, r.t)]));
  const sortedCats = Object.entries(catPct).filter(([, v]) => v != null).sort((a, b) => b[1] - a[1]);

  return {
    id: m.id, nickname: m.nickname, isMe: m.isMe,
    current: current ? { teamKey: current.teamKey, name: current.name } : null,
    seasons: m.seasons, teamNames: [...new Set(m.teamNames)],
    avgFinish: mean(m.finishes), finishes: m.finishes, titles: m.titles, playoffs: m.playoffs,
    movesPerSeason: mean(m.moves), tradesPerSeason: mean(m.trades),
    earlyPos, firstCRound: mean(firstC),
    homer,
    avgReach: mean(reaches.map(p => p.reach)),
    busts: busts.length,
    bustList: busts.sort((a, b) => (b.finish - b.pick) - (a.finish - a.pick)).slice(0, 5),
    stealList: steals.sort((a, b) => (b.pick - b.finish) - (a.pick - a.finish)).slice(0, 5),
    roiByRound: Object.fromEntries(Object.entries(roiByRound).map(([r, xs]) => [r, mean(xs)])),
    earlyRoi: mean(m.picks.filter(p => p.round <= 3).map(p => p.roi)),
    cats: m.cats, catPct,
    strongCats: sortedCats.slice(0, 3).map(([id, v]) => ({ id, label: CAT_LABELS[id] || id, pct: v })),
    weakCats: sortedCats.slice(-3).reverse().map(([id, v]) => ({ id, label: CAT_LABELS[id] || id, pct: v })),
    picks: m.picks,
  };
}

const p100 = v => `${Math.round(v * 100)}%`;

function insights(me, ctx) {
  const out = [];
  // Categories you chronically lose vs. what winners do
  const weak = ctx.catTable
    .filter(c => c.me != null && c.me < 0.47 && (c.top == null || c.top - c.me >= 0.06))
    .sort((a, b) => a.me - b.me);
  for (const c of weak.slice(0, 3)) {
    out.push({
      kind: 'cats', severity: c.me < 0.4 ? 'high' : 'med',
      text: `You won ${c.label} in only ${p100(c.me)} of regular-season weeks${c.top != null ? ` (top-3 finishers: ${p100(c.top)})` : ''}.`,
      fix: c.label === 'TO' ? 'You can punt TO, but only on purpose. Pair it with AST/3PM guards, and toggle the punt on the Draft Board.'
        : c.label === 'FT%' || c.label === 'FG%' ? `Either punt ${c.label} on purpose (toggle on the Draft Board) or stop drafting high-volume bad shooters. Half-punting loses both ways.`
        : `Weight ${c.label} up on draft day. The Draft Board's fit score does this automatically once your roster is weak in it.`,
    });
  }
  const strong = ctx.catTable.filter(c => c.me != null && c.me >= 0.62).sort((a, b) => b.me - a.me);
  if (strong.length) {
    out.push({
      kind: 'cats', severity: 'info',
      text: `Your reliable categories: ${strong.map(c => `${c.label} ${p100(c.me)}`).join(', ')}.`,
      fix: 'Win rates above 65% usually mean surplus. That surplus is trade bait for your weak categories.',
    });
  }

  // Waiver activity: games played is the biggest H2H lever
  if (me.movesPerSeason != null && ctx.topMoves != null && me.movesPerSeason < ctx.topMoves * 0.8) {
    out.push({
      kind: 'activity', severity: 'high',
      text: `You averaged ${Math.round(me.movesPerSeason)} moves per season. Top-3 finishers averaged ${Math.round(ctx.topMoves)}.`,
      fix: 'Use all 4 adds every week. Streaming for games played is the biggest edge in H2H. Game Plan shows the best streamers.',
    });
  }
  if (me.tradesPerSeason != null && me.tradesPerSeason < 0.5) {
    out.push({
      kind: 'activity', severity: 'med',
      text: `You've made ${me.tradesPerSeason === 0 ? 'no trades' : 'almost no trades'}.`,
      fix: 'Trading surplus categories for weak ones before the Mar 4 deadline is how good drafts become titles.',
    });
  }

  // Draft
  if (me.earlyRoi != null && me.earlyRoi < -6) {
    out.push({
      kind: 'draft', severity: 'high',
      text: `Your rounds 1–3 picks finished an average of ${Math.round(-me.earlyRoi)} spots below where you drafted them.`,
      fix: me.bustList.length ? `Worst: ${me.bustList.slice(0, 3).map(p => `${p.name} (${p.season}, pick ${p.pick} → finished #${p.finish})`).join('; ')}. Look for the pattern (injury history? age? hype?) and steer away from it.` : 'Trust the Value column over name recognition early.',
    });
  }
  if (me.avgReach != null && me.avgReach > 4) {
    out.push({
      kind: 'draft', severity: 'med',
      text: `In rounds 1–6 you take players about ${Math.round(me.avgReach)} picks before their ADP.`,
      fix: 'The Draft Board\'s "gone by #N?" flag shows when you can wait a round.',
    });
  }
  const goodRounds = Object.entries(me.roiByRound).filter(([, v]) => v > 8).map(([r]) => r);
  if (goodRounds.length) {
    out.push({ kind: 'draft', severity: 'info', text: `You find value in round${goodRounds.length > 1 ? 's' : ''} ${goodRounds.join(', ')}. Your late-round eye is good.`, fix: 'Bank on it: take safe picks early and swing late.' });
  }
  if (me.homer.length) {
    out.push({
      kind: 'draft', severity: 'med',
      text: `You draft ${me.homer.map(h => `${h.team} (${h.n} players)`).join(', ')} far more than random.`,
      fix: 'Leaguemates notice. It also concentrates injury, rest, and tanking risk.',
    });
  }
  if (me.finishes.length >= 2) {
    out.push({ kind: 'results', severity: 'info', text: `Finishes: ${me.finishes.join(', ')} · ${me.titles} title${me.titles === 1 ? '' : 's'} in ${me.finishes.length} season${me.finishes.length === 1 ? '' : 's'}.` });
  }
  if (!out.length) out.push({ kind: 'info', severity: 'info', text: 'Not enough history to find patterns yet.' });
  return out;
}

// One-line scouting summary for draft day
export function scoutingNotes(p) {
  const notes = [];
  const early = Object.entries(p.earlyPos).sort((a, b) => b[1] - a[1]);
  if (early[0]?.[1] >= 3) notes.push(`loads up on ${early[0][0]} early (${early[0][1]} in rds 1–3)`);
  if (p.firstCRound != null) notes.push(p.firstCRound <= 2.5 ? `takes a C by rd ${Math.round(p.firstCRound)}` : p.firstCRound >= 6 ? `waits on C (rd ~${Math.round(p.firstCRound)})` : null);
  if (p.homer.length) notes.push(`homer: ${p.homer.map(h => h.team).join(', ')}`);
  if (p.avgReach != null && p.avgReach > 5) notes.push(`reaches ~${Math.round(p.avgReach)} picks ahead of ADP`);
  if (p.avgReach != null && p.avgReach < -3) notes.push('drafts by ADP / waits for value');
  if (p.movesPerSeason != null) notes.push(p.movesPerSeason >= 60 ? 'very active on waivers' : p.movesPerSeason <= 20 ? 'inactive on waivers' : null);
  if (p.tradesPerSeason != null && p.tradesPerSeason >= 2) notes.push('open to trades');
  if (p.weakCats.length) notes.push(`usually weak: ${p.weakCats.map(c => c.label).join(', ')}`);
  return notes.filter(Boolean);
}
