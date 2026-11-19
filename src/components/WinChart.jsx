import { useEffect, useState } from 'react';
import { getWeekSeries } from '../api/yahoo';

// Chance to win the week (≥5 of 9 categories) from each category's odds
function weekWinProb(cats) {
  let dist = [1];
  for (const c of cats) {
    const next = new Array(dist.length + 1).fill(0);
    dist.forEach((p, k) => { next[k] += p * (1 - c.winProb); next[k + 1] += p * c.winProb; });
    dist = next;
  }
  return dist.slice(Math.floor(cats.length / 2) + 1).reduce((a, b) => a + b, 0);
}

const W = 600, H = 200, L = 40, R = 56, T = 14, B = 26;
const day = ymd => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

// Win probability through the week: one point per morning report, plus now
export default function WinChart({ categories }) {
  const [series, setSeries] = useState(null);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    let live = true;
    getWeekSeries().then(r => live && setSeries(r.data)).catch(() => live && setSeries({ days: [] }));
    return () => { live = false; };
  }, []);

  if (!series?.start) return null;
  const days = Array.from({ length: 7 }, (_, i) => addDays(series.start, i));
  const pts = series.days.map(d => ({ date: d.date, label: `${day(d.date)} morning`, p: d.winWeek, exp: d.expected }));
  if (categories?.length) pts.push({ date: null, label: 'Now', p: weekWinProb(categories), exp: categories.reduce((a, c) => a + c.winProb, 0) });
  const todayEt = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  // Mornings sit on their day; "now" sits later in today
  const x = d => L + ((d ? days.indexOf(d) : Math.min(6, Math.max(0, days.indexOf(todayEt)) + 0.5)) / 6) * (W - L - R);
  const y = p => T + (1 - p) * (H - T - B);
  const pos = pts.map(pt => ({ ...pt, cx: x(pt.date), cy: y(pt.p) })).filter(pt => pt.cx >= L);
  if (!pos.length) return null;
  const last = pos.at(-1);

  return (
    <section className="card">
      <h3>Chance to win this week</h3>
      <div className="winchart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Chance to win the week: ${pos.map(p => `${p.label} ${Math.round(p.p * 100)}%`).join(', ')}`}>
          {[0, 0.25, 0.5, 0.75, 1].map(g => (
            <g key={g}>
              <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} className={g === 0.5 ? 'wc-mid' : 'wc-grid'} />
              <text x={L - 6} y={y(g) + 4} className="wc-axis" textAnchor="end">{g * 100}%</text>
            </g>
          ))}
          {days.map(d => <text key={d} x={x(d)} y={H - 6} className="wc-axis" textAnchor="middle">{day(d)}</text>)}
          <polyline points={pos.map(p => `${p.cx},${p.cy}`).join(' ')} className="wc-line" />
          {pos.map((p, i) => (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}>
              <circle cx={p.cx} cy={p.cy} r={14} className="wc-hit" />
              <circle cx={p.cx} cy={p.cy} r={4} className="wc-dot" />
            </g>
          ))}
          <text x={last.cx + 8} y={last.cy + 4} className="wc-label">{Math.round(last.p * 100)}%</text>
          {hover != null && (() => {
            const p = pos[hover];
            const tx = Math.min(Math.max(p.cx - 70, L), W - R - 140);
            const ty = p.cy > 70 ? p.cy - 52 : p.cy + 12;
            return (
              <g className="wc-tip" pointerEvents="none">
                <rect x={tx} y={ty} width={140} height={40} rx={6} />
                <text x={tx + 8} y={ty + 16}>{p.label}</text>
                <text x={tx + 8} y={ty + 32}>{Math.round(p.p * 100)}% · {p.exp.toFixed(1)} cats</text>
              </g>
            );
          })()}
        </svg>
      </div>
      <p className="meta">Chance of winning 5+ of 9 categories, from each morning’s projection (the same numbers as your Discord report). The dashed line is 50%.</p>
    </section>
  );
}
