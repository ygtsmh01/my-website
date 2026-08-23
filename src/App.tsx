import { HashRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './lib/ThemeContext';
import Nav from './components/Nav/Nav';
import Game from './pages/Game';
import Admin from './pages/Admin';
import AdminWeeks from './pages/AdminWeeks';
import AdminLeagues from './pages/AdminLeagues';
import AdminUsers from './pages/AdminUsers';
import Live from './pages/Live';
import Profile from './pages/Profile';
import History from './pages/History';
import Leaderboard from './pages/Leaderboard';
import Guide from './pages/Guide';

export default function App() {
  return (
    <ThemeProvider>
      <HashRouter>
        <Nav />
        <Routes>
          <Route path="/" element={<Game />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/admin/haftalik-icerik" element={<AdminWeeks />} />
          <Route path="/admin/lig-yonetimi" element={<AdminLeagues />} />
          <Route path="/admin/kullanicilar" element={<AdminUsers />} />
          <Route path="/live" element={<Live />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/history" element={<History />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/guide" element={<Guide />} />
        </Routes>
      </HashRouter>
    </ThemeProvider>
  );
}
