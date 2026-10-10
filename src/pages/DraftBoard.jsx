import { useEffect, useMemo, useRef, useState } from 'react';
import { getDraftPool, getEspnPool } from '../api/yahoo';
import PageHeader from '../components/PageHeader';
import {
  CATS, DEFAULT_SETTINGS, computeValues, teamOnClock, picksForSlot, slotFill,
  recommend, teamProfile, importProjections,
  normName,
} from '../draft/engine';
import { analyze, scoutingNotes } from '../history/analyze';
import { botPick, rng, simulateSeason } from '../draft/sim';

const STORE = 'hi_draft_v1';
const POSITIONS = ['ALL', 'PG', 'SG', 'SF', 'PF', 'C'];

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s && Array.isArray(s.pool)) return { ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings } };
  } catch { /* fresh state */ }
  return { pool: [], meta: null, settings: DEFAULT_SETTINGS, picks: [], teamNames: {} };
}

// Scouting reports from League Intel's cached past seasons (if visited on this device)
function loadScouting() {
  try {
    const seasons = Object.keys(localStorage).filter(k => k.startsWith('hi_hist_'))
      .map(k => JSON.parse(localStorage.getItem(k))).filter(s => s?.teams?.length);
    if (!seasons.length) return [];
    const r = analyze(seasons, []);
    return [...(r.me ? [r.me] : []), ...r.scouting].map(p => ({ id: p.id, nickname: p.nickname, isMe: p.isMe, notes: scoutingNotes(p) }));
  } catch {
    return [];
  }
}

const zClass = z => (z == null ? '' : z >= 1.5 ? 'z z-hi' : z >= 0.5 ? 'z z-up' : z <= -1.5 ? 'z z-lo' : z <= -0.5 ? 'z z-dn' : 'z');
const fmt = (v, d = 1) => (v == null || Number.isNaN(v) ? '–' : v.toFixed(d));

export default function DraftBoard({ authed }) {
  const [state, setState] = useState(load);
  const [tab, setTab] = useState(state.pool.length ? 'board' : 'setup');
  const [query, setQuery] = useState('');
  const [posFilter, setPosFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('fit');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [season, setSeason] = useState(new Date().getFullYear() - 1);
  const fileRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* storage full/blocked */ }
  }, [state]);

  const { pool, settings, picks, teamNames } = state;
  const teamManagers = state.teamManagers || {};
  const [scouting] = useState(loadScouting);
  const scoutById = useMemo(() => new Map(scouting.map(p => [p.id, p])), [scouting]);
  const scoutFor = t => scoutById.get(teamManagers[t]);
  const { teams, rounds, slot, weights } = settings;
  const update = patch => setState(s => ({ ...s, ...patch }));
  const setSettings = patch => setState(s => ({ ...s, settings: { ...s.settings, ...patch } }));

  const valued = useMemo(() => computeValues(pool, { teams, rounds, weights }), [pool, teams, rounds, weights]);
  const byKey = useMemo(() => new Map(valued.map(p => [p.key, p])), [valued]);

  const totalPicks = teams * rounds;
  const currentPick = picks.length + 1;
  const done = currentPick > totalPicks;
  const clock = teamOnClock(Math.min(currentPick, totalPicks), teams);
  const myPickNums = slot ? picksForSlot(slot, teams, rounds) : [];
  const myUpcoming = myPickNums.filter(n => n >= currentPick);
  const myTurn = !done && slot && clock.team === slot;
  const nextMine = myUpcoming[0];
  const riskPick = myTurn ? myUpcoming[1] : nextMine;

  const teamOf = i => teamOnClock(i + 1, teams).team;
  const rosters = useMemo(() => {
    const r = Object.fromEntries(Array.from({ length: teams }, (_, i) => [i + 1, []]));
    picks.forEach((k, i) => { const p = byKey.get(k); if (p) r[teamOf(i)].push({ ...p, pickNo: i + 1 }); });
    return r;
  }, [picks, byKey, teams]); // eslint-disable-line react-hooks/exhaustive-deps
  const myPlayers = useMemo(() => (slot ? rosters[slot] || [] : []), [rosters, slot]);

  const picked = useMemo(() => new Set(picks), [picks]);
  const available = useMemo(() => valued.filter(p => !picked.has(p.key)), [valued, picked]);
  const recs = useMemo(
    () => recommend(available, myPlayers, weights, Math.max(myUpcoming.length, 1)),
    [available, myPlayers, weights, myUpcoming.length],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = recs.filter(p =>
      (!q || p.name.toLowerCase().includes(q) || (p.team || '').toLowerCase() === q) &&
      (posFilter === 'ALL' || (p.pos || []).includes(posFilter)));
    const key = { fit: p => p.fit, value: p => p.value, yahoo: p => -(p.yahooRank ?? 999) }[sortBy];
    list = [...list].sort((a, b) => (key(b) ?? -1e9) - (key(a) ?? -1e9));
    return list.slice(0, 150);
  }, [recs, query, posFilter, sortBy]);

  const topFit = useMemo(() => [...recs].filter(p => p.fit != null).sort((a, b) => b.fit - a.fit).slice(0, 3), [recs]);

  const draft = key => { if (!done) update({ picks: [...picks, key] }); };
  // In a mock, undo also rewinds the bots' picks back to your last pick
  const undo = () => {
    if (!state.mock || !slot) return update({ picks: picks.slice(0, -1) });
    let i = picks.length - 1;
    while (i >= 0 && teamOf(i) !== slot) i--;
    update({ picks: picks.slice(0, Math.max(0, i)) });
  };

  // Mock draft: bots pick by ADP (with noise) whenever it isn't your turn
  const mockRand = useRef(null);
  useEffect(() => {
    if (!state.mock || done || myTurn || !slot || !available.length) return;
    const t = setTimeout(() => {
      if (!mockRand.current) mockRand.current = rng(Date.now() % 2147483647);
      const p = botPick(available, mockRand.current);
      if (p) setState(s => ({ ...s, picks: [...s.picks, p.key] }));
    }, 120);
    return () => clearTimeout(t);
  }, [state.mock, done, myTurn, slot, available]);

  const mockResult = useMemo(() => {
    if (!state.mock || !done || !slot) return null;
    const teamRosters = Array.from({ length: teams }, (_, i) => rosters[i + 1].filter(p => p.z));
    const season = simulateSeason(teamRosters, { weeks: 20, seed: picks.length * 31 + slot });
    const me = season[slot - 1];
    const rank = 1 + season.filter((x, i) => i !== slot - 1 && x.winPct > me.winPct).length;
    return { ...me, rank };
  }, [state.mock, done, slot, teams, rosters, picks.length]);

  // LASER: simulate the rest of the draft + season for the top candidates
  const [laser, setLaser] = useState(null);
  const laserWorker = useRef(null);
  function runLaser() {
    if (!myTurn) return;
    laserWorker.current?.terminate();
    const w = new Worker(new URL('../draft/laser.worker.js', import.meta.url), { type: 'module' });
    laserWorker.current = w;
    const atPick = picks.length;
    setLaser({ atPick, progress: 0 });
    w.onmessage = ({ data }) => {
      if (data.progress != null) setLaser(l => (l && l.atPick === atPick ? { ...l, progress: data.progress } : l));
      if (data.results || data.error) {
        setLaser(l => (l && l.atPick === atPick ? { ...l, progress: 1, results: data.results, error: data.error } : l));
        w.terminate();
      }
    };
    w.postMessage({
      valued, pickedKeys: picks, teams, rounds, slot, weights,
      candidates: 8, rollouts: 24, weeks: 12, seed: atPick + 1,
    });
  }
  const laserNow = laser && laser.atPick === picks.length ? laser : null;

  function startMock() {
    if (!slot) { setMsg({ ok: false, text: 'Pick your draft slot first.' }); return; }
    if (!pool.length) { setMsg({ ok: false, text: 'Load ESPN projections first.' }); return; }
    mockRand.current = rng(Date.now() % 2147483647);
    update({ picks: [], mock: true });
    setMsg({ ok: true, text: 'Mock draft started. Bots draft by ADP with some randomness; you pick on your turn.' });
    setTab('board');
  }
  const teamName = t => (t === slot ? 'You' : teamNames[t] || scoutFor(t)?.nickname || `Team ${t}`);

  // Fix a past pick: tap it in the draft log, then choose the right player
  const [fixIndex, setFixIndex] = useState(null);
  const assign = key => {
    if (fixIndex != null) {
      if (picks.includes(key) && picks[fixIndex] !== key) return;
      const next = picks.slice();
      next[fixIndex] = key;
      update({ picks: next });
      setFixIndex(null);
      return;
    }
    draft(key);
  };

  // Changing league size: keep names, drop a slot that no longer exists
  const changeTeams = n => {
    if (picks.length && !confirm('Changing the number of teams re-assigns picks already made. Continue?')) return;
    setSettings({ teams: n, ...(slot && slot > n ? { slot: null } : {}) });
  };

  // Paste a numbered or plain list of owners → names + team count; detects your row if you've named it before
  const [orderText, setOrderText] = useState('');
  const applyOrder = () => {
    const names = orderText.split(/\r?\n/).map(l => l.replace(/^\s*\d+[.):-]?\s*/, '').trim()).filter(Boolean);
    if (names.length < 2) return;
    const myName = slot ? (teamNames[slot] || '').trim().toLowerCase() : '';
    const mine = names.findIndex(n => myName && n.toLowerCase() === myName);
    setState(s2 => ({
      ...s2,
      teamNames: Object.fromEntries(names.map((n, i) => [i + 1, n])),
      settings: { ...s2.settings, teams: names.length, slot: mine >= 0 ? mine + 1 : (s2.settings.slot && s2.settings.slot <= names.length ? s2.settings.slot : null) },
    }));
    setOrderText('');
    setMsg({ ok: true, text: `Draft order set: ${names.length} teams. Tap Me on your row if it isn't highlighted.` });
  };

  // Draft order editor helpers (names live in teamNames by slot number)
  const moveSlot = (t, dir) => {
    const u = t + dir;
    if (u < 1 || u > teams) return;
    const names = { ...teamNames, [t]: teamNames[u] || '', [u]: teamNames[t] || '' };
    const patch = { teamNames: names };
    if (slot === t) setSettings({ slot: u }); else if (slot === u) setSettings({ slot: t });
    update(patch);
  };

  async function loadEspn() {
    setBusy(true); setMsg(null);
    try {
      const { data } = await getEspnPool();
      update({ pool: data.players, meta: { source: 'espn', season: data.season, at: data.fetchedAt } });
      setMsg({ ok: true, text: `Loaded ${data.players.length} players from ESPN: ${data.withProjections} with ${data.season - 1}-${String(data.season).slice(2)} projections. ADP = ESPN average draft position.` });
      setTab('board');
    } catch (e) {
      setMsg({ ok: false, text: e.response?.data?.error || e.message });
    } finally { setBusy(false); }
  }

  async function loadYahoo() {
    setBusy(true); setMsg(null);
    try {
      const { data } = await getDraftPool(season);
      update({ pool: data.players, meta: { source: 'yahoo', season: data.season, sort: data.sort, statType: data.statType, perGame: data.perGame, league: data.league, at: data.fetchedAt } });
      setMsg({ ok: true, text: `Loaded ${data.players.length} players from Yahoo (${data.sort === 'OR' ? 'preseason rank' : 'last-season rank'}, ${data.season}-${String(data.season + 1).slice(2)} ${data.perGame ? 'per-game' : 'season-total'} stats).` });
      setTab('board');
    } catch (e) {
      setMsg({ ok: false, text: e.response?.data?.error || e.message });
    } finally { setBusy(false); }
  }

  function onCsv(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(text => {
      try {
        const r = importProjections(pool, text);
        update({ pool: r.players, meta: { ...(state.meta || {}), projections: file.name, at: new Date().toISOString() } });
        setMsg({ ok: true, text: `Projections imported: ${r.matched} matched, ${r.added} new players${r.skipped ? `, ${r.skipped} skipped` : ''}.` });
      } catch (err) {
        setMsg({ ok: false, text: err.message });
      }
      e.target.value = '';
    });
  }

  const togglePunt = k => setSettings({ weights: { ...weights, [k]: weights[k] === 0 ? 1 : 0 } });
  const punted = CATS.filter(c => weights[c.k] === 0).map(c => c.label);

  return (
    <div>
      <PageHeader title="DRAFT BOARD" subtitle={`${teams}-team snake · 9-cat H2H${punted.length ? ` · punting ${punted.join(', ')}` : ''}`} />

      {/* Clock bar */}
      <div className={`clock ${myTurn ? 'clock-mine' : ''}`}>
        {done ? (
          <div className="clock-main">Draft complete — {picks.length} picks</div>
        ) : (
          <>
            <div className="clock-main">
              <span className="stat">#{currentPick}</span> · R{clock.round}.{clock.inRound} · {myTurn ? 'YOU ARE ON THE CLOCK' : `${teamName(clock.team)} on the clock`}
            </div>
            {!myTurn && scoutFor(clock.team)?.notes.length > 0 && (
              <div className="clock-scout meta">{scoutFor(clock.team).notes.slice(0, 3).join(' · ')}</div>
            )}
            <div className="clock-sub">
              {!slot ? 'Set your draft slot in Setup to get pick alerts.'
                : myTurn ? `After this, your next pick is #${myUpcoming[1] ?? '—'}`
                : nextMine ? `Your next pick: #${nextMine} (${nextMine - currentPick} away)` : 'No picks left'}
            </div>
          </>
        )}
        <div className="clock-actions">
          {scouting.length === 0 && <span className="meta">Open League Intel once to get scouting notes here</span>}
          <button className="btn btn-ghost" onClick={undo} disabled={!picks.length}>Undo</button>
        </div>
      </div>

      {pool.length > 0 && (!done || fixIndex != null) && !(state.mock && !myTurn && fixIndex == null) && (
        <QuickPick
          title={fixIndex != null
            ? <>Fix pick #{fixIndex + 1} ({teamName(teamOf(fixIndex))}), now: {byKey.get(picks[fixIndex])?.name}</>
            : myTurn ? <>Your pick: tap who you take</> : <><b>{teamName(clock.team)}</b> is on the clock: who did they take?</>}
          available={available}
          onPick={assign}
          onCancel={fixIndex != null ? () => setFixIndex(null) : null}
          mine={myTurn && fixIndex == null}
        />
      )}

      {myTurn && (
        <div className="laser">
          {!laserNow ? (
            <button className="btn btn-laser" onClick={runLaser}>⚡ LASER pick</button>
          ) : !laserNow.results ? (
            <div className="laser-run">
              <div className="meta">LASER: simulating the rest of the draft + season for 8 candidates × 24 rollouts…</div>
              <div className="laser-bar"><div style={{ width: `${Math.round((laserNow.progress || 0) * 100)}%` }} /></div>
            </div>
          ) : laserNow.error ? (
            <div className="notice err">LASER failed: {laserNow.error}</div>
          ) : (
            <div className="laser-results">
              <div className="recs-label">⚡ LASER: simulated H2H win rate if you take…</div>
              {laserNow.results.map((r, i) => (
                <button key={r.key} className={`laser-row ${i === 0 ? 'best' : ''}`} onClick={() => draft(r.key)}>
                  <span className="laser-name">{r.name} <span className="meta">{(r.pos || []).join('/')}</span></span>
                  <span className="stat">{(r.winPct * 100).toFixed(1)}%</span>
                  <span className="meta">±{(r.se * 100).toFixed(1)}</span>
                </button>
              ))}
              {laserNow.results[0]?.edge && (
                <div className="meta" style={{ marginTop: 6 }}>
                  Edge over {laserNow.results[0].edge.vs}: {(laserNow.results[0].edge.mean * 100).toFixed(1)} pts
                  (±{(laserNow.results[0].edge.se * 100).toFixed(1)}, paired). {laserNow.results[0].edge.mean < 2 * laserNow.results[0].edge.se ? 'Too close to call: take either.' : 'Clear edge.'}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {myTurn && topFit.length > 0 && (
        <div className="recs">
          <div className="recs-label">BEST FITS</div>
          {topFit.map(p => (
            <button key={p.key} className="rec" onClick={() => draft(p.key)}>
              <b>{p.name}</b> <span className="meta">{(p.pos || []).join('/')} · fit {fmt(p.fit)}{p.fillsSlot ? ' · fills slot' : ''}</span>
            </button>
          ))}
        </div>
      )}

      <div className="tabs">
        {[['board', 'Board'], ['mine', `My Team (${myPlayers.length})`], ['teams', 'All Teams'], ['setup', 'Setup']].map(([k, l]) => (
          <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {msg && <div className={`notice ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}

      {state.mock && (
        <div className="notice action" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <b>MOCK DRAFT</b>
          {mockResult ? (
            <span>
              Simulated season: you'd win <b>{Math.round(mockResult.winPct * 100)}%</b> of matchups and finish
              <b> #{mockResult.rank}</b> of {teams} in all-play. Categories won:{' '}
              {CATS.map(c => `${c.label} ${Math.round(mockResult.cats[c.k] * 100)}%`).join(' · ')}
            </span>
          ) : <span>Bots are drafting; tap Draft when you're on the clock. Undo rewinds to your last pick.</span>}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button className="btn btn-primary btn-sm" onClick={startMock}>New mock</button>
            <button className="btn btn-ghost btn-sm" onClick={() => update({ mock: false, picks: [] })}>End mock</button>
          </span>
        </div>
      )}

      {tab === 'board' && (
        pool.length === 0 ? (
          <div className="empty-state"><h3>No players loaded</h3><p>Go to Setup to load players from Yahoo or import a projections CSV.</p></div>
        ) : (
          <>
            <div className="filters">
              <input className="input" placeholder="Search player or team (e.g. BOS)" value={query} onChange={e => setQuery(e.target.value)} />
              <div className="chips">
                {POSITIONS.map(p => <button key={p} className={`chip ${posFilter === p ? 'on' : ''}`} onClick={() => setPosFilter(p)}>{p}</button>)}
              </div>
              <select className="input" value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ maxWidth: 170 }}>
                <option value="fit">Sort: Best fit</option>
                <option value="value">Sort: Raw value</option>
                <option value="yahoo">Sort: ADP</option>
              </select>
            </div>
            <div className="table-wrap">
              <table className="draft-table">
                <thead>
                  <tr>
                    <th></th><th>#</th><th>Player</th><th title="Market rank by average draft position: roughly when others will take him">ADP</th>
                    <th>Value</th><th>Fit</th>
                    {CATS.map(c => <th key={c.k} className={weights[c.k] === 0 ? 'punted' : ''}>{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p, i) => {
                    const prev = shown[i - 1];
                    const tierBreak = sortBy === 'value' && prev && p.tier !== prev.tier;
                    const gone = riskPick && p.yahooRank && p.yahooRank < riskPick;
                    const steal = p.valueRank && p.yahooRank && p.yahooRank - p.valueRank >= 15;
                    return [
                      tierBreak && <tr key={`t${p.tier}`} className="tier-row"><td colSpan={6 + CATS.length}>TIER {p.tier}</td></tr>,
                      <tr key={p.key} className={p.status && ['O', 'INJ'].includes(p.status) ? 'row-inj' : ''}>
                        <td><button className="btn btn-primary btn-sm" onClick={() => draft(p.key)} disabled={done}>Draft</button></td>
                        <td className="stat">{p.valueRank ?? '–'}</td>
                        <td className="name-cell">
                          <div className="pname">{p.name}{p.status && <span className="status-out"> {p.status}</span>}</div>
                          <div className="meta">
                            {(p.pos || []).join('/')} · {p.team}
                            {p.gp ? ` · ${p.gp}gp` : ''}
                            {p.projected && <span className="tag">proj</span>}
                            {!p.z && <span className="tag">no stats</span>}
                            {gone && <span className="tag tag-red" title={`Yahoo ranks him above your next pick (#${riskPick})`}>gone by #{riskPick}?</span>}
                            {steal && <span className="tag tag-green" title="Our value rank is well ahead of Yahoo's — others may let him slide">value</span>}
                          </div>
                        </td>
                        <td className="stat">{p.yahooRank ?? '–'}</td>
                        <td className="stat">{fmt(p.value)}</td>
                        <td className="stat strong">{fmt(p.fit)}</td>
                        {CATS.map(c => <td key={c.k} className={`${zClass(p.z?.[c.k])} ${weights[c.k] === 0 ? 'punted' : ''}`}>{fmt(p.z?.[c.k])}</td>)}
                      </tr>,
                    ];
                  })}
                </tbody>
              </table>
            </div>
            <p className="meta" style={{ marginTop: 8 }}>
              Value = sum of category z-scores vs. the draftable pool (FG%/FT% weighted by attempts, TO negative). Fit adjusts for your team's weak categories and open lineup slots.
            </p>
          </>
        )
      )}

      {tab === 'mine' && <MyTeam players={myPlayers} slot={slot} weights={weights} myPickNums={myPickNums} />}

      {tab === 'teams' && (
        <div className="teams-grid">
          {Array.from({ length: teams }, (_, i) => i + 1).map(t => (
            <div key={t} className={`team-card ${t === slot ? 'mine' : ''} ${!done && t === clock.team ? 'on-clock' : ''}`}>
              {t === slot ? <div className="team-title">You (slot {t})</div> : (
                <input className="team-title-input" value={teamNames[t] || ''} placeholder={`Team ${t}`}
                  onChange={e => update({ teamNames: { ...teamNames, [t]: e.target.value } })} />
              )}
              {t !== slot && scouting.length > 0 && (
                <select className="input team-mgr" value={teamManagers[t] || ''}
                  onChange={e => update({ teamManagers: { ...teamManagers, [t]: e.target.value } })}>
                  <option value="">Who is this? (scouting)</option>
                  {scouting.filter(m => !m.isMe).map(m => <option key={m.id} value={m.id}>{m.nickname}</option>)}
                </select>
              )}
              {t !== slot && scoutFor(t)?.notes.map((n, i) => <div key={i} className="meta scout-line">• {n}</div>)}
              {rosters[t].map(p => <div key={p.key} className="team-pick"><span className="stat">{p.pickNo}</span> {p.name} <span className="meta">{(p.pos || []).join('/')}</span></div>)}
            </div>
          ))}
          <div className="team-card">
            <div className="team-title">Draft log</div>
            <div className="meta" style={{ marginBottom: 4 }}>Tap a pick to fix it</div>
            {picks.map((k, i) => (
              <button key={i} className={`team-pick log-pick ${fixIndex === i ? 'fixing' : ''}`} onClick={() => { setFixIndex(i); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                <span className="stat">{i + 1}</span> {byKey.get(k)?.name || k} <span className="meta">→ {teamName(teamOf(i))}</span>
              </button>
            )).reverse()}
          </div>
        </div>
      )}

      {tab === 'setup' && (
        <div className="setup">
          <section>
            <h3>Draft order</h3>
            <details className="paste-order">
              <summary>Paste the draft order (one name per line)</summary>
              <textarea className="input" rows={6} value={orderText} onChange={e => setOrderText(e.target.value)}
                placeholder={'1. Caleb\n2. John\n3. Jake\n…'} />
              <button className="btn btn-primary btn-sm" onClick={applyOrder} disabled={!orderText.trim()}>Use this order</button>
            </details>
            <p className="meta">Type each owner's name in pick order and tap <b>Me</b> on your row. Use ↑ ↓ if the order gets shuffled.</p>
            <div className="order-list">
              {Array.from({ length: teams }, (_, i) => i + 1).map(n => (
                <div key={n} className={`order-row ${slot === n ? 'mine' : ''}`}>
                  <span className="stat order-num">{n}</span>
                  <input className="input order-name" value={teamNames[n] || ''} placeholder={slot === n ? 'Your name' : `Owner of pick ${n}`}
                    onChange={e => update({ teamNames: { ...teamNames, [n]: e.target.value } })} />
                  <button className={`chip ${slot === n ? 'on' : ''}`} onClick={() => setSettings({ slot: n })}>Me</button>
                  <button className="chip" onClick={() => moveSlot(n, -1)} disabled={n === 1} aria-label="Move up">↑</button>
                  <button className="chip" onClick={() => moveSlot(n, 1)} disabled={n === teams} aria-label="Move down">↓</button>
                </div>
              ))}
            </div>
            <div className="row-inline">
              <label>Teams{' '}
                <select className="input input-sm" value={teams} onChange={e => changeTeams(Number(e.target.value))}>
                  {Array.from({ length: 13 }, (_, i) => i + 4).map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label>Rounds{' '}
                <select className="input input-sm" value={rounds} onChange={e => setSettings({ rounds: Number(e.target.value) })}>
                  {Array.from({ length: 16 }, (_, i) => i + 5).map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
          </section>

          <section>
            <h3>Punt categories</h3>
            <p className="meta">Tap a category to ignore it in value and fit. In H2H you only need 5 of 9; punting FT% or TO is common with big men / ball-dominant guards.</p>
            <div className="chips">
              {CATS.map(c => <button key={c.k} className={`chip ${weights[c.k] === 0 ? 'punt' : 'on'}`} onClick={() => togglePunt(c.k)}>{weights[c.k] === 0 ? `✕ ${c.label}` : c.label}</button>)}
            </div>
          </section>

          <section>
            <h3>Player pool</h3>
            {state.meta && (
              <p className="meta">
                Current: {pool.length} players{state.meta.source === 'yahoo' && ` from Yahoo (${state.meta.league}, ${state.meta.season} stats, ${state.meta.statType})`}
                {state.meta.source === 'espn' && ` from ESPN projections (loaded ${new Date(state.meta.at).toLocaleString()})`}
                {state.meta.projections && ` + projections from ${state.meta.projections}`}
              </p>
            )}
            <div className="row-inline">
              <button className="btn btn-primary" onClick={loadEspn} disabled={busy}>{busy ? 'Loading…' : pool.length ? 'Reload ESPN projections' : 'Load ESPN projections'}</button>
              {authed && (
                <>
                  <label>Stats season <input className="input input-sm" type="number" value={season} onChange={e => setSeason(Number(e.target.value))} /></label>
                  <button className="btn btn-ghost" onClick={loadYahoo} disabled={busy}>Load from Yahoo</button>
                </>
              )}
              <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>Import projections CSV</button>
              <input ref={fileRef} type="file" accept=".csv,.txt,.tsv" hidden onChange={onCsv} />
            </div>
            <p className="meta">
              ESPN projections need no login and include rookies, injuries and average draft position. Yahoo's API is currently
              gated behind Yahoo's approval program. Optional: import a CSV from another projection source (Hashtag Basketball,
              Basketball Monster) on top. Columns like Player, PTS, REB, AST, STL, BLK, 3PM, TO, FG%, FT%, FGA, FTA.
            </p>
          </section>

          <section>
            <h3>Practice</h3>
            <p className="meta">Run a full mock against 9 bots that draft by ADP, then see how your team does over a simulated 20-week season.</p>
            <div className="row-inline">
              <button className="btn btn-primary" onClick={startMock}>Start mock draft</button>
            </div>
          </section>

          <section>
            <h3>Reset</h3>
            <div className="row-inline">
              <button className="btn btn-ghost" onClick={() => { if (confirm('Clear all picks?')) update({ picks: [] }); }}>Clear picks</button>
              <button className="btn btn-ghost" onClick={() => { if (confirm('Clear picks AND player pool?')) setState({ pool: [], meta: null, settings, picks: [], teamNames }); }}>Clear everything</button>
            </div>
            <p className="meta">Everything is saved on this device. Load the pool before the draft — after that the board works offline.</p>
          </section>
        </div>
      )}
    </div>
  );
}

function MyTeam({ players, slot, weights, myPickNums }) {
  if (!slot) return <div className="empty-state"><h3>Set your draft slot in Setup</h3></div>;
  const { filled, bench, open } = slotFill(players);
  const prof = teamProfile(players);
  const max = Math.max(1, ...CATS.map(c => Math.abs(prof.sums[c.k])));
  return (
    <div className="mine-grid">
      <section>
        <h3>Category profile</h3>
        <p className="meta">Sum of z-scores. Aim to be clearly positive in 5–6 categories; don't chase all 9.</p>
        {CATS.map(c => {
          const v = prof.sums[c.k];
          return (
            <div key={c.k} className={`catrow ${weights[c.k] === 0 ? 'punted' : ''}`}>
              <span className="catlbl">{c.label}</span>
              <div className="catbar">
                <div className={`catfill ${v >= 0 ? 'pos' : 'neg'}`} style={{ width: `${(Math.abs(v) / max) * 50}%`, [v >= 0 ? 'left' : 'right']: '50%' }} />
              </div>
              <span className="stat catval">{v >= 0 ? '+' : ''}{v.toFixed(1)}</span>
            </div>
          );
        })}
      </section>
      <section>
        <h3>Lineup</h3>
        {filled.map((f, i) => (
          <div key={i} className="slotrow"><span className="pos-badge">{f.slot}</span> {f.player ? f.player.name : <span className="status-gtd">open</span>}</div>
        ))}
        {bench.map(p => <div key={p.key} className="slotrow"><span className="pos-badge">BN</span> {p.name}</div>)}
        {open.length > 0 && <p className="meta" style={{ marginTop: 8 }}>Still need: {open.join(', ')}</p>}
        <p className="meta" style={{ marginTop: 8 }}>Your picks: {myPickNums.join(', ')}</p>
      </section>
    </div>
  );
}

// Fast pick entry while following the room: likely picks as one-tap buttons + search
function QuickPick({ title, available, onPick, onCancel, mine }) {
  const [q, setQ] = useState('');
  const likely = useMemo(
    () => [...available].sort((a, b) => (a.yahooRank ?? 999) - (b.yahooRank ?? 999)).slice(0, 6),
    [available],
  );
  const matches = useMemo(() => {
    const n = normName(q);
    if (n.length < 2) return [];
    return available
      .filter(p => normName(p.name).includes(n) || normName(p.name).split(' ').some(w => w.startsWith(n)))
      .sort((a, b) => (a.yahooRank ?? 999) - (b.yahooRank ?? 999))
      .slice(0, 8);
  }, [q, available]);
  const pick = key => { onPick(key); setQ(''); };
  const list = q.trim().length >= 2 ? matches : likely;
  return (
    <div className={`quickpick ${mine ? 'mine' : ''}`}>
      <div className="qp-title">{title}</div>
      <input className="input qp-search" placeholder="Type a name: “jok”, “wemb”, “dyson”…" value={q} onChange={e => setQ(e.target.value)} />
      <div className="qp-list">
        {q.trim().length < 2 && <div className="meta qp-hint">Most likely (by ADP):</div>}
        {list.map(p => (
          <button key={p.key} className="qp-btn" onClick={() => pick(p.key)}>
            <span className="qp-name">{p.name}</span>
            <span className="meta">{(p.pos || []).join('/')} · {p.team} · ADP {p.yahooRank ?? '–'}</span>
          </button>
        ))}
        {q.trim().length >= 2 && !matches.length && <div className="meta">No available player matches “{q}”.</div>}
      </div>
      {onCancel && <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel fix</button>}
    </div>
  );
}
