import { useEffect, useState } from 'react';
import { getLeagueWeek, getPower } from '../api/yahoo';
import PageHeader from '../components/PageHeader';

const pctStr = p => `${Math.round(p * 100)}%`;
const fmt = (c, v) => (v == null ? '–' : c.pct ? v.toFixed(3).replace(/^0/, '') : Math.round(v));
const who = t => t?.manager || t?.name;
const dayLabel = ymd => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export default function League() {
  const [week, setWeek] = useState(null);
  const [power, setPower] = useState(null);
  const [error, setError] = useState(null);
  const [powerError, setPowerError] = useState(null);

  useEffect(() => {
    let live = true;
    getLeagueWeek().then(r => live && setWeek(r.data)).catch(e => live && setError(e.response?.data?.error || e.message));
    getPower().then(r => live && setPower(r.data)).catch(e => live && setPowerError(e.response?.data?.error || e.message));
    return () => { live = false; };
  }, []);

  return (
    <div>
      <PageHeader title="League" subtitle={week ? `Week ${week.week} · ${dayLabel(week.start)} – ${dayLabel(week.end)} · every matchup, the race, and who wants which free agent` : 'Projecting every matchup…'} />
      <PowerCard power={power} error={powerError} />
      {error ? <div className="error-state"><h3>Couldn’t load the league</h3><p>{error}</p></div>
        : !week ? <div className="loading-container">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton skeleton-row" />)}</div>
          : <WeekView week={week} />}
    </div>
  );
}

function PowerCard({ power, error }) {
  if (error) return <section className="card"><h3>Power rankings</h3><p className="settings-verdict settings-err">{error}</p></section>;
  if (!power) return <section className="card"><h3>Power rankings</h3><p className="meta">Ranking every team from last week…</p></section>;
  if (power.none) return <section className="card"><h3>Power rankings</h3><p className="meta">Rankings start after week 1 is played.</p></section>;
  return (
    <section className="card">
      <h3>Power rankings after week {power.week}</h3>
      <p className="meta">
        Blend: {pctStr(power.weights.roster)} roster strength (current roster against every team in an average week), {pctStr(power.weights.allPlay)} last week’s all-play (last week’s stats against every team, which removes schedule luck), {pctStr(power.weights.record)} category record so far.
      </p>
      <ol className="pr-list">
        {power.rankings.map(t => (
          <li key={t.key} className={`pr-team ${t.mine ? 'pr-mine' : ''}`}>
            <div className="pr-head">
              <span className="pr-rank">{t.rank}</span>
              {t.prevRank != null && t.prevRank !== t.rank && <span className={`tag ${t.prevRank > t.rank ? 'tag-green' : 'tag-red'}`}>{t.prevRank > t.rank ? '▲' : '▼'}{Math.abs(t.prevRank - t.rank)}</span>}
              <b>{t.name}</b> <span className="meta">{t.manager}</span>
              <span className="pr-rec">{t.record.wins}-{t.record.losses}{t.record.ties ? `-${t.record.ties}` : ''}</span>
            </div>
            <ul className="pr-notes">{t.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            <div>
              {t.best.map(c => <span key={c} className="tag tag-green">{c}</span>)}
              {t.worst.map(c => <span key={c} className="tag tag-red">{c}</span>)}
              {t.moves != null && <span className="meta"> · {t.moves} moves</span>}
            </div>
          </li>
        ))}
      </ol>
      <p className="meta">Green = top 2 in that category last week, red = bottom 2. Movement arrows show up once two weeks have been ranked.</p>
    </section>
  );
}

function WeekView({ week }) {
  const mine = week.matchups.find(m => m.mine);
  const others = week.matchups.filter(m => !m.mine);
  return (
    <>
      <section className="card">
        <h3>The race: standings now vs after this week</h3>
        <div className="table-wrap">
          <table className="gn-cats">
            <thead><tr><th>Proj.</th><th>Team</th><th>Now</th><th>This week</th><th>After</th></tr></thead>
            <tbody>
              {week.standings.map(t => (
                <tr key={t.key} className={t.mine ? 'gn-close' : ''}>
                  <td className="stat">{t.projRank}{t.rank && t.rank !== t.projRank ? <span className="meta"> (now {t.rank})</span> : ''}</td>
                  <td className="stat"><b>{t.name}</b> <span className="meta">{t.manager}</span></td>
                  <td className="stat">{t.wins}-{t.losses}{t.ties ? `-${t.ties}` : ''}</td>
                  <td className="stat">+{t.weekExpected.toFixed(1)}</td>
                  <td className="stat">{t.projW.toFixed(1)}-{t.projL.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="meta">“This week” = expected category wins from {dayLabel(week.projectingFrom)} to the end of the week, using current rosters.</p>
      </section>

      {mine && <MatchupCard m={mine} />}
      {others.map((m, i) => <MatchupCard key={i} m={m} />)}

      <section className="card">
        <h3>Free agents: what each is worth to you, and to everyone else</h3>
        <p className="settings-note">
          Your adds don’t change other teams’ matchups directly. They ripple two ways: you take a player a rival can’t add, and every category you win moves you past the teams near you.
          Ranked by your gain plus half of what the best rival within a week of you would gain. Each team is assumed to drop its lowest-value healthy player; adds play from {dayLabel(week.addsStartPlaying)}.
        </p>
        {week.freeAgents.length === 0 ? <p className="meta">No free agents to rank (the week may be over).</p> : (
          <div className="table-wrap">
            <table className="gn-cats">
              <thead><tr><th>Player</th><th>To you</th><th>Who else wants him</th></tr></thead>
              <tbody>
                {week.freeAgents.map(f => (
                  <tr key={f.name}>
                    <td className="stat"><b>{f.name}</b> <span className="meta">{f.team} · {f.pos}{f.rosRank ? ` · #${f.rosRank}` : ''}</span></td>
                    <td className={`stat ${f.mine > 0.05 ? 'win' : ''}`}>{f.mine >= 0 ? '+' : ''}{f.mine.toFixed(2)}</td>
                    <td className="stat">{f.others.filter(o => o.gain > 0.02).map(o => <span key={o.key} className={`tag ${o.rival ? 'tag-gold' : ''}`}>{who(o)} +{o.gain.toFixed(2)}</span>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="meta">Gold = a team within 9 category wins of you after this week. Numbers are extra category wins this week. Refresh This Week before adding; free agents go fast.</p>
      </section>
    </>
  );
}

function MatchupCard({ m }) {
  const [a, b] = m.teams;
  const started = m.cats.some(c => (c.aNow || 0) > 0 || (c.bNow || 0) > 0);
  const lead = started ? m.cats.reduce((r, c) => {
    if (c.aNow == null || c.bNow == null || c.aNow === c.bNow) return r;
    const aAhead = c.name === 'TO' ? c.aNow < c.bNow : c.aNow > c.bNow;
    return aAhead ? { ...r, a: r.a + 1 } : { ...r, b: r.b + 1 };
  }, { a: 0, b: 0 }) : null;
  return (
    <section className={`card ${m.mine ? 'lg-mine' : ''}`}>
      <div className="lg-head">
        <div><b>{a.name}</b> <span className="meta">{a.manager}</span><div className="tw-big">{a.expected.toFixed(1)}</div></div>
        <div className="meta lg-vs">vs{lead && <div>now {lead.a}-{lead.b}</div>}</div>
        <div className="lg-right"><b>{b.name}</b> <span className="meta">{b.manager}</span><div className="tw-big">{b.expected.toFixed(1)}</div></div>
      </div>
      {m.rooting && <p className="notice">Root for <b>{who(m.rooting.rootFor)}</b>: {who(m.rooting.against)} is close to you in the standings.</p>}
      <div className="table-wrap">
        <table className="gn-cats">
          <thead><tr><th>Cat</th>{started && <th>Now</th>}<th>Proj.</th><th>{who(a)} wins</th></tr></thead>
          <tbody>
            {m.cats.map(c => (
              <tr key={c.name} className={c.aWin > 0.35 && c.aWin < 0.65 ? 'gn-close' : ''}>
                <td className="stat">{c.name}</td>
                {started && <td className="stat">{fmt(c, c.aNow)} – {fmt(c, c.bNow)}</td>}
                <td className="stat">{fmt(c, c.aEnd)} – {fmt(c, c.bEnd)}</td>
                <td className={`stat ${c.aWin >= 0.6 ? 'win' : c.aWin <= 0.4 ? 'lose' : ''}`}>{pctStr(c.aWin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="meta">Player-games left: {who(a)} {a.gamesLeft}, {who(b)} {b.gamesLeft}. Highlighted rows are swing categories.</p>
    </section>
  );
}
