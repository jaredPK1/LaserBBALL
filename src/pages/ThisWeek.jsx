import { useEffect, useState } from 'react';
import { getWeek, getStreamers } from '../api/yahoo';
import PageHeader from '../components/PageHeader';

const VERDICT = {
  locked: ['Locked', 'tag-green'],
  leaning: ['Leaning yours', 'tag-green'],
  swing: ['Swing', 'tag-gold'],
  behind: ['Behind', 'tag-red'],
  gone: ['Gone', 'tag-red'],
};

const fmt = (c, v) => (v == null ? '–' : c.pct ? v.toFixed(3).replace(/^0/, '') : Math.round(v));
const pctStr = p => `${Math.round(p * 100)}%`;
const dayLabel = ymd => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const seasonLabel = s => `${s}–${String(Number(s) + 1).slice(2)}`;

export default function ThisWeek() {
  const [week, setWeek] = useState(null);
  const [streams, setStreams] = useState(null);
  const [error, setError] = useState(null);
  const [streamError, setStreamError] = useState(null);

  useEffect(() => {
    let live = true;
    getWeek().then(r => live && setWeek(r.data)).catch(e => live && setError(e.response?.data?.error || e.message));
    getStreamers().then(r => live && setStreams(r.data)).catch(e => live && setStreamError(e.response?.data?.error || e.message));
    return () => { live = false; };
  }, []);

  if (error) {
    return (
      <div>
        <PageHeader title="This Week" />
        <div className="error-state"><h3>Couldn’t load this week</h3><p>{error}</p></div>
      </div>
    );
  }
  if (!week) {
    return (
      <div>
        <PageHeader title="This Week" subtitle="Projecting your matchup…" />
        <div className="loading-container">{Array.from({ length: 9 }, (_, i) => <div key={i} className="skeleton skeleton-row" />)}</div>
      </div>
    );
  }

  const cats = week.categories;
  const swing = cats.filter(c => c.verdict === 'swing' || c.verdict === 'leaning' || c.verdict === 'behind')
    .sort((a, b) => Math.abs(a.winProb - 0.5) - Math.abs(b.winProb - 0.5));
  const sc = week.scouting;
  const started = cats.some(c => (c.mineNow || 0) > 0 || (c.oppNow || 0) > 0);

  return (
    <div>
      <PageHeader
        title="This Week"
        subtitle={`Week ${week.week} · ${dayLabel(week.start)} – ${dayLabel(week.end)} · vs ${week.opp?.name || 'no opponent'}`}
      />

      <div className="tw-head card">
        <div>
          <div className="tw-big">{week.expectedWins.toFixed(1)} <span>of 9</span></div>
          <div className="meta">projected category wins this week (each one counts in the standings)</div>
        </div>
        {swing.length > 0 && (
          <div className="tw-focus">
            <div className="meta">WHERE YOUR MOVES MATTER</div>
            <div>{swing.slice(0, 3).map(c => <span key={c.id} className="tag tag-gold">{c.name} {pctStr(c.winProb)}</span>)}</div>
          </div>
        )}
      </div>

      <div className="table-wrap">
        <table className="gn-cats tw-cats">
          <thead>
            <tr><th>Cat</th><th>Win chance</th><th>You proj.</th><th>Them proj.</th>{started && <><th>You now</th><th>Them now</th></>}</tr>
          </thead>
          <tbody>
            {cats.map(c => {
              const [label, cls] = VERDICT[c.verdict];
              return (
                <tr key={c.id} className={c.verdict === 'swing' ? 'gn-close' : ''}>
                  <td className="stat">{c.name}</td>
                  <td className="stat tw-odds">
                    <b>{pctStr(c.winProb)}</b> <span className={`tag ${cls}`}>{label}</span>
                    <span className="tw-bar"><i style={{ width: pctStr(c.winProb) }} /></span>
                  </td>
                  <td className="stat">{fmt(c, c.mineEnd)}</td>
                  <td className="stat">{fmt(c, c.oppEnd)}</td>
                  {started && <><td className="stat">{fmt(c, c.mineNow)}</td><td className="stat">{fmt(c, c.oppNow)}</td></>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="meta" style={{ margin: '6px 0 20px' }}>
        Projects from {dayLabel(week.projectingFrom)} to {dayLabel(week.end)}: everyone’s games left, at most 10 starters a day, per-game rates from ESPN projections.
        {week.unrated?.length > 0 && ` No stats yet for ${week.unrated.join(', ')}.`}
      </p>

      {week.opp && (
        <section className="card">
          <h3>Scouting: {week.opp.manager || week.opp.name}</h3>
          {!sc ? <p className="settings-note">No league history for this manager yet.</p> : (
            <>
              <p className="settings-note">
                {sc.seasons.map(s => `${seasonLabel(s.season)}: ${ordinal(s.rank)}`).join(' · ')}
                {' · '}{Math.round(sc.seasons.reduce((a, s) => a + s.moves, 0) / sc.seasons.length)} moves a season
              </p>
              {sc.weak.length > 0 && <p><b>Usually loses:</b> {sc.weak.map(n => <span key={n} className="tag tag-green">{n} {pctStr(sc.catWin[n])}</span>)}</p>}
              {sc.strong.length > 0 && <p><b>Usually wins:</b> {sc.strong.map(n => <span key={n} className="tag tag-red">{n} {pctStr(sc.catWin[n])}</span>)}</p>}
              <p className="meta">Their regular-season category win rates across past seasons of this league.</p>
            </>
          )}
        </section>
      )}

      <section className="card">
        <h3>Best adds this week</h3>
        {streamError ? <p className="settings-verdict settings-err">{streamError}</p>
          : !streams ? <p className="meta">Ranking free agents…</p> : (
            <>
              <p className="settings-note">
                Ranked by how many extra category wins each one adds this week, playing from {dayLabel(streams.addsStartPlaying)}
                {streams.drop ? <> if you drop <b>{streams.drop.name}</b> (your least useful player this week)</> : ''}. You get 4 adds a week.
              </p>
              {streams.streamers.length === 0 && <p className="meta">No free agents with stats found.</p>}
              <div className="tw-streams">
                {streams.streamers.map((p, i) => (
                  <div key={p.name} className={`tw-stream ${p.gain <= 0.005 ? 'dim' : ''}`}>
                    <div className="tw-srow">
                      <span className="tw-rank">{i + 1}</span>
                      <b>{p.name}</b>
                      <span className="meta">{p.team} · {p.pos}</span>
                      {p.status && <span className="tag tag-gold">{p.status}</span>}
                      <span className="tw-gain">{p.gain >= 0 ? '+' : ''}{p.gain.toFixed(2)} cats</span>
                    </div>
                    <div className="tw-sline meta">
                      {p.gamesLeft} game{p.gamesLeft === 1 ? '' : 's'} left · {p.perGame.pts.toFixed(1)} pts · {p.perGame.reb.toFixed(1)} reb · {p.perGame.blk.toFixed(1)} blk · {p.perGame.stl.toFixed(1)} stl · {p.perGame.tpm.toFixed(1)} 3pm
                      {p.perGame.fgPct != null && ` · ${p.perGame.fgPct.toFixed(3).replace(/^0/, '')} FG`}
                    </div>
                    {Object.keys(p.catGain).length > 0 && (
                      <div>{Object.entries(p.catGain).map(([k, v]) => <span key={k} className={`tag ${v > 0 ? 'tag-green' : 'tag-red'}`}>{k} {v > 0 ? '+' : ''}{v}%</span>)}</div>
                    )}
                  </div>
                ))}
              </div>
              <p className="meta">Checked {streams.considered} free agents: the top overall plus the best available centers and power forwards.</p>
            </>
          )}
      </section>
    </div>
  );
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
