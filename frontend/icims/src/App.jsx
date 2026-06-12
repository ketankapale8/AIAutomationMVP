// src/App.jsx — Production Dashboard Shell
import { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import axios from 'axios';

import Sidebar from './components/Sidebar';
import LiveAnalysisPage from './pages/LiveAnalysisPage';
import TicketsPage from './pages/TicketsPage';
import ReposPage from './pages/ReposPage';
import AnalyticsPage from './pages/AnalyticsPage';

const BASE = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';

export default function App() {
  const [serverStatus, setServerStatus] = useState('connecting');

  // Ping backend health
  useEffect(() => {
    const check = () =>
      axios.get(`${BASE}/`).then(() => setServerStatus('running')).catch(() => setServerStatus('offline'));
    check();
    const id = setInterval(check, 10000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="app-layout">
      <Sidebar serverStatus={serverStatus} />
      <main className="main-content">
        <div className="page-content">
          <Routes>
            <Route path="/"          element={<LiveAnalysisPage />} />
            <Route path="/tickets"   element={<TicketsPage />} />
            <Route path="/repos"     element={<ReposPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
          </Routes>
        </div>

        {/* Footer */}
        <footer style={{ borderTop: '1px solid var(--border)', padding: '14px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--text-3)' }}>
          <span>
            Agentic Jira Analyzer v2.0 &mdash; Built by{' '}
            <a href="https://ketankapale.netlify.app/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--cyan)', textDecoration: 'none', fontWeight: 600 }}>Ketan.K</a>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: serverStatus === 'running' ? 'var(--green)' : 'var(--red)', display: 'inline-block' }} />
            <span>Backend {serverStatus === 'running' ? 'Online' : 'Offline'}</span>
          </div>
        </footer>
      </main>
    </div>
  );
}