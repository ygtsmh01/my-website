import { Suspense, lazy } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './lib/ThemeContext';
import Nav from './components/Nav/Nav';
import Game from './pages/Game';
import ErrorBoundary from './components/ErrorBoundary';
import BackgroundTaskToasts from './lib/BackgroundTaskToasts';

const Admin = lazy(() => import('./pages/Admin'));
const AdminWeeks = lazy(() => import('./pages/AdminWeeks'));
const AdminLeagues = lazy(() => import('./pages/AdminLeagues'));
const AdminUsers = lazy(() => import('./pages/AdminUsers'));
const Live = lazy(() => import('./pages/Live'));
const Profile = lazy(() => import('./pages/Profile'));
const History = lazy(() => import('./pages/History'));
const Leaderboard = lazy(() => import('./pages/Leaderboard'));
const Guide = lazy(() => import('./pages/Guide'));

export default function App() {
  return (
    <ThemeProvider>
      <HashRouter>
        <ErrorBoundary>
          <Nav />
          <BackgroundTaskToasts />
          <Suspense fallback={<div className="root"><p className="panel-sub">Yükleniyor…</p></div>}>
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
          </Suspense>
        </ErrorBoundary>
      </HashRouter>
    </ThemeProvider>
  );
}
