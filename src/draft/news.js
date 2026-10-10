// Draft-day news flags (researched 2026-10-10). Keyed by player name; matched
// accent/suffix-insensitively. level: avoid | caution | target | info.
// avoid + okFromRound: only treated as "avoid" before that round.
import { normName } from './engine.js';

export const NEWS_AS_OF = '2026-10-10';

const RAW = [
  // Avoid (confirm before drafting on your own pick)
  { name: "Kel'el Ware", level: 'avoid', okFromRound: 10, note: 'Traded to MIL in Giannis deal; behind Myles Turner, role unclear. Late flier only.' },
  { name: 'Jayson Tatum', level: 'avoid', okFromRound: 4, note: 'Achilles return Mar 2026, leg tweak in playoffs, resting in preseason (DTD). Too risky early.' },
  { name: 'Anthony Davis', level: 'avoid', okFromRound: 6, note: 'Missed 14+ games in 10 of 14 seasons; experts call him a bust at ADP.' },
  { name: 'Brandon Ingram', level: 'avoid', okFromRound: 10, note: 'Achilles injury: out for the start of the season.' },
  { name: 'Joel Embiid', level: 'avoid', okFromRound: 8, note: 'Chronic injury risk (on bust lists).' },
  { name: 'Zion Williamson', level: 'avoid', okFromRound: 8, note: 'Chronic injury risk (on bust lists).' },

  // Caution
  { name: 'Walker Kessler', level: 'caution', note: 'LAL starting C, cleared from shoulder surgery, but played only 5 games last season. Mid-rounds, don’t reach.' },
  { name: 'Reed Sheppard', level: 'caution', note: 'More competition for minutes this year.' },
  { name: 'Cooper Flagg', level: 'caution', note: 'CBS model flags as bust at ADP ~10 (new coach from college).' },
  { name: 'Matas Buzelis', level: 'caution', note: 'Left preseason game 10/9 with right ankle injury.' },
  { name: 'Nic Claxton', level: 'caution', note: 'Hamstring: out of camp.' },
  { name: 'Jaren Jackson Jr.', level: 'caution', note: 'Knee: doubtful in preseason.' },
  { name: 'Fred VanVleet', level: 'caution', note: 'Returning from torn ACL.' },
  { name: 'Kawhi Leonard', level: 'caution', note: 'Ruled out of a preseason game; long injury history.' },
  { name: 'LaMelo Ball', level: 'caution', note: 'Persistent injury risk (on bust lists).' },
  { name: 'Austin Reaves', level: 'info', note: 'Ankle tweak; cleared. Sleeper candidate.' },

  // Targets for a punt-FT% build
  { name: 'Giannis Antetokounmpo', level: 'target', note: 'Now MIA with Bam. Ideal punt-FT anchor, but played only 36 games last season.' },
  { name: 'Jalen Duren', level: 'target', note: 'Holdout resolved (5yr/$200M reported). Perfect punt-FT C. Don’t take at #7: aim #10 or #23/26.' },
  { name: 'Cason Wallace', level: 'target', note: 'Led NBA in steals last season (1.97/g). Breakout pick.' },
  { name: 'Derrick White', level: 'target', note: 'Bounce-back candidate: STL, BLK, 3PM from a guard.' },
  { name: 'Dyson Daniels', level: 'target', note: 'Steals + ~6 assists; beat his ADP last year.' },
  { name: 'Ajay Mitchell', level: 'target', note: 'Late sleeper: bigger OKC role after departures.' },
  { name: 'Coby White', level: 'info', note: 'Sleeper on multiple lists.' },
  { name: 'Victor Wembanyama', level: 'info', note: 'No new injury: the 2025 blood clot is fully cleared.' },
];

const BY_NAME = new Map(RAW.map(r => [normName(r.name), r]));

export const newsFor = p => (p ? BY_NAME.get(normName(p.name)) || null : null);

// Is this player an "avoid" right now (given the current round)?
export const avoidNow = (p, round) => {
  const n = newsFor(p);
  return !!n && n.level === 'avoid' && (!n.okFromRound || round < n.okFromRound);
};

export const ALL_NEWS = RAW;
