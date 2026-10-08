import { useCallback, useEffect, useMemo, useState } from 'react';
import { getHistorySeasons, getHistorySeason } from '../api/yahoo';
import PageHeader from '../components/PageHeader';
import { analyze, scoutingNotes } from '../history/analyze';

const cacheKey = lk => `hi_hist_${lk}`;
const readCache = lk => { try { return JSON.parse(localStorage.getItem(cacheKey(lk))); } catch { return null; } };
const writeCache = (lk, v) => { try { localStorage.setItem(cacheKey(lk), JSON.stringify(v)); } catch { /* storage full */ } };
const p100 = v => (v == null ? '–' : `${Math.round(v * 100)}%`);
const seasonLabel = y => `${y}-${String(y + 1).slice(2)}`;
const ordinal = n => (n == null ? '–' : `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`);

export default function LeagueIntel() {
  const [meta, setMeta] = useState(null);
  const [seasons, setSeasons] = useState([]);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('me');

  const load = useCallback(async (force = false) => {
    setError(null);
    try {
      const { data } = await getHistorySeasons();
      setMeta(data);
      const past = data.seasons.filter(s => !s.current || s.isFinished);
      const loaded = [];
      for (let i = 0; i < past.length; i++) {
        const s = past[i];
        let d = !force && s.isFinished ? readCache(s.leagueKey) : null;
        if (!d) {
          setProgress(`Loading ${seasonLabel(s.season)} season (${i + 1}/${past.length})… draft, standings, every weekly matchup`);
          try {
            d = (await getHistorySeason(s.leagueKey)).data;
            if (d.isFinished) writeCache(s.leagueKey, d);
          } catch (e) {
            d = { leagueKey: s.leagueKey, season: s.season, error: e.response?.data?.error || e.message };
          }
        }
        loaded.push(d);
        setSeasons([...loaded]);
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setProgress(null);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const usable = seasons.filter(s => s.teams?.length);
  const result = useMemo(() => (usable.length ? analyze(usable, meta?.currentTeams || []) : null), [usable, meta]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div>
        <PageHeader title="LEAGUE INTEL" />
        <div className="error-state"><h3>Failed to load</h3><p style={{ marginBottom: 16 }}>{error}</p><button className="btn btn-primary" onClick={() => load()}>Retry</button></div>
      </div>
    );
  }

  const failed = seasons.filter(s => s.error);
  return (
    <div>
      <PageHeader
        title="LEAGUE INTEL"
        subtitle={meta ? `${meta.league} · ${usable.length} past season${usable.length === 1 ? '' : 's'} analyzed` : 'Finding past seasons…'}
      />
      {progress && <div className="notice action">{progress}</div>}
      {failed.map(s => <div key={s.leagueKey} className="notice err">{seasonLabel(s.season)}: {s.error}</div>)}
      {meta && !progress && !usable.length && (
        <div className="empty-state">
          <h3>No past seasons found</h3>
          <p>Yahoo only links seasons when the league was renewed. If this league is new, there's no history to read.</p>
        </div>
      )}

      {result && (
        <>
          <div className="tabs">
            {[['me', 'My Blind Spots'], ['scout', 'Scouting Reports'], ['seasons', 'Seasons']].map(([k, l]) => (
              <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          {tab === 'me' && <BlindSpots result={result} />}
          {tab === 'scout' && <Scouting result={result} />}
          {tab === 'seasons' && <Seasons result={result} />}
          <p className="meta" style={{ marginTop: 16 }}>
            Past seasons are cached on this device.{' '}
            <button className="btn btn-ghost btn-sm" onClick={() => load(true)} disabled={!!progress}>Reload from Yahoo</button>
          </p>
        </>
      )}
    </div>
  );
}

function BlindSpots({ result }) {
  const { me, insights, catTable } = result;
  if (!me) return <div className="empty-state"><h3>Couldn't find your team in past seasons</h3></div>;
  return (
    <div className="intel">
      <div className="insights">
        {insights.map((i, k) => (
          <div key={k} className={`insight sev-${i.severity}`}>
            <div className="insight-kind meta">{i.kind.toUpperCase()}</div>
            <div className="insight-text">{i.text}</div>
            {i.fix && <div className="insight-fix">→ {i.fix}</div>}
          </div>
        ))}
      </div>

      <section className="card">
        <h3>Category win rate: you vs. top-3 finishers</h3>
        <p className="meta">Regular-season weeks only. The gap to the winners is where your titles leak.</p>
        {catTable.map(c => (
          <div key={c.id} className="cmprow">
            <span className="catlbl">{c.label}</span>
            <div className="cmpbars">
              <div className="cmpbar"><div className={`cmpfill ${c.me != null && c.top != null && c.me < c.top - 0.05 ? 'bad' : 'me'}`} style={{ width: p100(c.me) }} /></div>
              <div className="cmpbar"><div className="cmpfill top" style={{ width: p100(c.top) }} /></div>
            </div>
            <span className="stat catval">{p100(c.me)}</span>
            <span className="stat catval meta">{p100(c.top)}</span>
          </div>
        ))}
        <div className="meta" style={{ marginTop: 6 }}><span className="legend me" /> you <span className="legend top" /> top-3 avg</div>
      </section>

      <div className="mine-grid">
        <section className="card">
          <h3>Your biggest draft misses</h3>
          {me.bustList.length ? me.bustList.map(p => (
            <div key={`${p.season}-${p.pick}`} className="slotrow">
              <span className="stat meta">{p.season}</span> {p.name}
              <span className="meta" style={{ marginLeft: 'auto' }}>pick {p.pick} → #{p.finish}</span>
            </div>
          )) : <p className="meta">No major early-round busts. Nice.</p>}
        </section>
        <section className="card">
          <h3>Your best late finds</h3>
          {me.stealList.length ? me.stealList.map(p => (
            <div key={`${p.season}-${p.pick}`} className="slotrow">
              <span className="stat meta">{p.season}</span> {p.name}
              <span className="meta" style={{ marginLeft: 'auto' }}>pick {p.pick} → #{p.finish}</span>
            </div>
          )) : <p className="meta">No standout late-round steals yet.</p>}
        </section>
      </div>

      <section className="card">
        <h3>Draft return by round</h3>
        <p className="meta">Average spots gained (+) or lost (−) vs. where you picked, based on actual season production.</p>
        <div className="roi-row">
          {Object.entries(me.roiByRound).map(([r, v]) => (
            <div key={r} className="roi-cell">
              <div className="meta">R{r}</div>
              <div className={`stat ${v >= 0 ? 'status-active' : 'status-out'}`}>{v >= 0 ? '+' : ''}{Math.round(v)}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Scouting({ result }) {
  const myStrong = new Set((result.me?.strongCats || []).map(c => c.label));
  return (
    <div className="teams-grid scout-grid">
      {result.scouting.map(p => {
        const notes = scoutingNotes(p);
        const tradeFits = p.weakCats.filter(c => myStrong.has(c.label)).map(c => c.label);
        return (
          <div key={p.id} className={`team-card ${p.current ? '' : 'former'}`}>
            <div className="team-title">{p.current?.name || p.teamNames.at(-1)}</div>
            <div className="meta">
              {p.nickname} · {p.seasons.length} season{p.seasons.length === 1 ? '' : 's'}
              {!p.current && ' · not in league this year'}
            </div>
            <div className="scout-stats">
              <div><div className="meta">Avg finish</div><div className="stat">{p.avgFinish ? ordinal(Math.round(p.avgFinish)) : '–'}</div></div>
              <div><div className="meta">Titles</div><div className="stat">{p.titles}</div></div>
              <div><div className="meta">Moves/yr</div><div className="stat">{p.movesPerSeason != null ? Math.round(p.movesPerSeason) : '–'}</div></div>
              <div><div className="meta">Trades/yr</div><div className="stat">{p.tradesPerSeason != null ? p.tradesPerSeason.toFixed(1) : '–'}</div></div>
            </div>
            <ul className="scout-notes">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            <div className="meta">Rds 1–3: {Object.entries(p.earlyPos).filter(([, n]) => n).map(([pos, n]) => `${pos}×${n}`).join(' ') || '–'}</div>
            {tradeFits.length > 0 && <div className="notice action" style={{ marginTop: 8, fontSize: 12 }}>Trade target: weak in {tradeFits.join(', ')}, which are your strengths.</div>}
          </div>
        );
      })}
    </div>
  );
}

function Seasons({ result }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Season</th><th>Your finish</th><th>Record</th><th>Your moves</th><th>League avg moves</th><th>Champion</th></tr></thead>
        <tbody>
          {[...result.overview].reverse().map(o => (
            <tr key={o.season}>
              <td className="stat">{seasonLabel(o.season)}{!o.finished && ' (in progress)'}</td>
              <td className="stat">{o.me ? ordinal(o.me.rank) : '–'}</td>
              <td className="stat">{o.me?.record || '–'}</td>
              <td className="stat">{o.me?.moves ?? '–'}</td>
              <td className="stat">{o.avgMoves != null ? Math.round(o.avgMoves) : '–'}</td>
              <td>{o.champion ? `${o.champion.name} (${o.champion.nickname}, ${o.champion.moves} moves)` : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
