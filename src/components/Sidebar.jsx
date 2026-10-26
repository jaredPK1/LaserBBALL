import { NavLink } from 'react-router-dom';
import { startAuth, clearTokens } from '../api/yahoo';

// In-season tools first. Older pages (Matchup, Game Plan, Today, Start / Sit,
// Waivers) are superseded by Game Night + This Week; their routes still work.
const navItems = [
  {
    section: 'GAME DAY',
    items: [
      { icon: '\u{1F534}', label: 'Game Night', path: '/gamenight' },
      { icon: '\u{1F4C8}', label: 'This Week', path: '/week' },
      { icon: '\u{1F3DF}', label: 'League', path: '/league' },
    ],
  },
  {
    section: 'MANAGE',
    items: [
      { icon: '\u{1F3AF}', label: 'My Roster', path: '/roster' },
      { icon: '\u{1F91D}', label: 'Trade', path: '/trade' },
      { icon: '\u{1F3C6}', label: 'Playoffs', path: '/playoffs' },
      { icon: '\u{1F4C5}', label: 'Schedule', path: '/schedule' },
    ],
  },
  {
    section: 'DRAFT',
    items: [
      { icon: '\u{1F4CA}', label: 'Draft Board', path: '/draft' },
      { icon: '\u{1F50E}', label: 'League Intel', path: '/intel' },
    ],
  },
  {
    section: 'APP',
    items: [
      { icon: '\u{2699}\u{FE0F}', label: 'Settings', path: '/settings' },
    ],
  },
];

export default function Sidebar({ authed }) {
  return (
    <nav className="sidebar">
      <div className="sidebar-logo">HOOP INTEL</div>

      <div className="sidebar-links">
        {navItems.map((group) => (
          <div key={group.section} className="sidebar-section">
            <div className="sidebar-section-label">{group.section}</div>
            {group.items.map((item) => (
              <NavLink key={item.path} to={item.path} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </div>

      <div className="sidebar-bottom">
        {authed ? (
          <>
            <div className="connected"><span className="dot" /> CONNECTED</div>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: '6px 12px', width: '100%' }}
              onClick={async () => { await clearTokens(); window.location.assign('/connect'); }}
            >
              Disconnect
            </button>
          </>
        ) : (
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={startAuth}>
            Connect Yahoo
          </button>
        )}
      </div>
    </nav>
  );
}
