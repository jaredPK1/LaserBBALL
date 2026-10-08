import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { checkAuth } from './api/yahoo';
import Sidebar from './components/Sidebar';
import Roster from './pages/Roster';
import StartSit from './pages/StartSit';
import Matchup from './pages/Matchup';
import WaiverWire from './pages/WaiverWire';
import DraftBoard from './pages/DraftBoard';
import ScheduleStrength from './pages/ScheduleStrength';
import GamePlan from './pages/GamePlan';
import GameNight from './pages/GameNight';
import LeagueIntel from './pages/LeagueIntel';
import Today from './pages/Today';
import Connect from './pages/Connect';

// The draft board works without Yahoo (CSV import / cached pool), so it's never gated.
const PUBLIC = new Set(['/connect', '/draft']);

function AppInner() {
  const [authed, setAuthed] = useState(null);
  const location = useLocation();

  useEffect(() => { checkAuth().then(setAuthed); }, []);

  if (authed === null) {
    return <div className="boot">Loading…</div>;
  }

  if (!authed && !PUBLIC.has(location.pathname)) {
    return <Navigate to="/connect" replace />;
  }

  const showNav = authed || location.pathname === '/draft';

  return (
    <>
      {showNav && <Sidebar authed={authed} />}
      <main className={showNav ? 'main-content' : 'main-full'}>
        <Routes>
          <Route path="/connect" element={<Connect authed={authed} />} />
          <Route path="/gamenight" element={<GameNight />} />
          <Route path="/matchup" element={<Matchup />} />
          <Route path="/gameplan" element={<GamePlan />} />
          <Route path="/today" element={<Today />} />
          <Route path="/roster" element={<Roster />} />
          <Route path="/startsit" element={<StartSit />} />
          <Route path="/waivers" element={<WaiverWire />} />
          <Route path="/draft" element={<DraftBoard authed={authed} />} />
          <Route path="/intel" element={<LeagueIntel />} />
          <Route path="/schedule" element={<ScheduleStrength />} />
          <Route path="*" element={<Navigate to={authed ? '/gamenight' : '/connect'} replace />} />
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  );
}
