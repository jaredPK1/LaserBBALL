import { useEffect, useMemo, useRef, useState } from 'react';
import { getDraftPool, startAuth } from '../api/yahoo';
import PageHeader from '../components/PageHeader';
import {
  CATS, DEFAULT_SETTINGS, computeValues, teamOnClock, picksForSlot, slotFill,
  recommend, teamProfile, importProjections,
} from '../draft/engine';

const STORE = 'hi_draft_v1';
const POSITIONS = ['ALL', 'PG', 'SG', 'SF', 'PF', 'C'];

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s && Array.isArray(s.pool)) return { ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings } };
  } catch { /* fresh state */ }
  return { pool: [], meta: null, settings: DEFAULT_SETTINGS, picks: [], teamNames: {} };
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
  const undo = () => update({ picks: picks.slice(0, -1) });
  const teamName = t => (t === slot ? 'You' : teamNames[t] || `Team ${t}`);

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
            <div className="clock-sub">
              {!slot ? 'Set your draft slot in Setup to get pick alerts.'
                : myTurn ? `After this, your next pick is #${myUpcoming[1] ?? '—'}`
                : nextMine ? `Your next pick: #${nextMine} (${nextMine - currentPick} away)` : 'No picks left'}
            </div>
          </>
        )}
        <div className="clock-actions">
          <button className="btn btn-ghost" onClick={undo} disabled={!picks.length}>Undo</button>
        </div>
      </div>

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
                <option value="yahoo">Sort: Yahoo rank</option>
              </select>
            </div>
            <div className="table-wrap">
              <table className="draft-table">
                <thead>
                  <tr>
                    <th></th><th>#</th><th>Player</th><th title="Yahoo rank — a proxy for when others will draft him">Y!</th>
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
              {rosters[t].map(p => <div key={p.key} className="team-pick"><span className="stat">{p.pickNo}</span> {p.name} <span className="meta">{(p.pos || []).join('/')}</span></div>)}
            </div>
          ))}
          <div className="team-card">
            <div className="team-title">Draft log</div>
            {picks.map((k, i) => <div key={i} className="team-pick"><span className="stat">{i + 1}</span> {byKey.get(k)?.name || k} <span className="meta">→ {teamName(teamOf(i))}</span></div>).reverse()}
          </div>
        </div>
      )}

      {tab === 'setup' && (
        <div className="setup">
          <section>
            <h3>Your draft slot</h3>
            <div className="chips">
              {Array.from({ length: teams }, (_, i) => i + 1).map(n => (
                <button key={n} className={`chip ${slot === n ? 'on' : ''}`} onClick={() => setSettings({ slot: n })}>{n}</button>
              ))}
            </div>
            <div className="row-inline">
              <label>Teams <input className="input input-sm" type="number" min="4" max="20" value={teams} onChange={e => setSettings({ teams: Number(e.target.value) || 10 })} /></label>
              <label>Rounds <input className="input input-sm" type="number" min="5" max="20" value={rounds} onChange={e => setSettings({ rounds: Number(e.target.value) || 13 })} /></label>
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
                {state.meta.projections && ` + projections from ${state.meta.projections}`}
              </p>
            )}
            <div className="row-inline">
              {authed ? (
                <>
                  <label>Stats season <input className="input input-sm" type="number" value={season} onChange={e => setSeason(Number(e.target.value))} /></label>
                  <button className="btn btn-primary" onClick={loadYahoo} disabled={busy}>{busy ? 'Loading… (≈20s)' : pool.length ? 'Reload from Yahoo' : 'Load players from Yahoo'}</button>
                </>
              ) : (
                <button className="btn btn-primary" onClick={startAuth}>Connect Yahoo to load players</button>
              )}
              <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>Import projections CSV</button>
              <input ref={fileRef} type="file" accept=".csv,.txt,.tsv" hidden onChange={onCsv} />
            </div>
            <p className="meta">
              Yahoo gives last season's stats, which miss role changes, trades and rookies. For better results, export
              projections (Hashtag Basketball, Basketball Monster, etc.) as CSV with columns like Player, PTS, REB, AST, STL, BLK, 3PM, TO, FG%, FT% (FGA/FTA if available) and import them on top.
            </p>
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
