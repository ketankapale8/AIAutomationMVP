// src/pages/ReposPage.jsx
// Shows index status for each configured repo. Trigger re-index from UI.

import { useState, useEffect } from 'react';
import axios from 'axios';

const BASE = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';

export default function ReposPage() {
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [indexing, setIndexing] = useState({});

  const load = () => {
    setLoading(true);
    axios.get(`${BASE}/api/repos`)
      .then(r => setRepos(r.data.repos || []))
      .catch(() => setRepos([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const triggerIndex = async (repoId, force = false) => {
    setIndexing(prev => ({ ...prev, [repoId]: true }));
    try {
      await axios.post(`${BASE}/api/repos/${repoId}/index`, { force });
      setTimeout(() => { load(); setIndexing(prev => ({ ...prev, [repoId]: false })); }, 2000);
    } catch {
      alert(`❌ Could not trigger index for ${repoId}. Make sure the backend is running.`);
      setIndexing(prev => ({ ...prev, [repoId]: false }));
    }
  };

  return (
    <div className="fade-in-up">
      <div className="page-header">
        <div>
          <div className="page-title">Repositories</div>
          <div className="page-subtitle">LanceDB vector index status per configured repo</div>
        </div>
        <button className="btn btn-ghost" onClick={load}>🔄 Refresh</button>
      </div>

      {loading ? (
        <div className="empty-state">
          <div className="spin" style={{ fontSize: 28 }}>⚙️</div>
          <div>Loading repo status…</div>
        </div>
      ) : repos.length === 0 ? (
        <div className="empty-state card" style={{ padding: 60 }}>
          <div className="empty-icon">📦</div>
          <div className="empty-title">No repos configured</div>
          <div className="empty-sub">Add repos to <code style={{ color: 'var(--violet)' }}>backend/config.yaml</code> then reload.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {repos.map(repo => (
            <RepoCard
              key={repo.id}
              repo={repo}
              isIndexing={!!indexing[repo.id]}
              onIndex={(force) => triggerIndex(repo.id, force)}
            />
          ))}
        </div>
      )}

      {/* How to index guide */}
      <div className="card" style={{ marginTop: 24, padding: 24 }}>
        <div className="section-title" style={{ marginBottom: 16 }}>
          <span>📋</span> How to Build the Index
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { cmd: 'npm run index',       desc: 'Delta index — only scans new/changed files (fast, recommended)' },
            { cmd: 'npm run index:full',  desc: 'Full re-index — forces re-embedding of every file (slow, use when changing models)' },
          ].map(({ cmd, desc }) => (
            <div key={cmd} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ background: '#090714', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--violet)', whiteSpace: 'nowrap' }}>
                {cmd}
              </div>
              <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{desc}</span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => navigator.clipboard.writeText(`cd backend && ${cmd}`)}
                style={{ marginLeft: 'auto', whiteSpace: 'nowrap', flexShrink: 0 }}
              >
                📋 Copy
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RepoCard({ repo, isIndexing, onIndex }) {
  const isIndexed = repo.status === 'indexed' || repo.totalChunks > 0;
  const statusClass = isIndexed ? 'badge-indexed' : repo.status === 'error' ? 'badge-error' : 'badge-pending';
  const statusLabel = isIndexed ? 'Indexed' : repo.status === 'error' ? 'Error' : 'Not Indexed';

  const pct = repo.totalChunks > 0 ? Math.min(100, (repo.totalChunks / 5000) * 100) : 0;

  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 18 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 20 }}>📦</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)' }}>{repo.name || repo.id}</span>
            <span className={`badge ${statusClass}`}>{statusLabel}</span>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-3)', marginBottom: 4 }}>
            📁 {repo.localPath}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(repo.jiraProjects || []).map(p => (
              <span key={p} style={{ background: 'var(--violet-dim)', color: 'var(--violet)', border: '1px solid rgba(168,85,247,0.2)', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4 }}>
                {p}
              </span>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-ghost btn-sm"
            disabled={isIndexing}
            onClick={() => onIndex(false)}
          >
            {isIndexing ? '⏳ Indexing…' : '⚡ Delta Index'}
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={isIndexing}
            onClick={() => onIndex(true)}
          >
            {isIndexing ? '⏳ Indexing…' : '🔄 Full Re-index'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 14, marginBottom: 14 }}>
        {[
          { label: 'Files Indexed', value: repo.totalFiles?.toLocaleString() || '0', icon: '📄' },
          { label: 'Chunks Stored', value: repo.totalChunks?.toLocaleString() || '0', icon: '🧩' },
          { label: 'Last Indexed',  value: repo.lastIndexedAt ? new Date(repo.lastIndexedAt).toLocaleDateString() : 'Never', icon: '🕐' },
          { label: 'Jira Boards',   value: (repo.jiraProjects || []).length, icon: '🎫' },
        ].map(stat => (
          <div key={stat.label} style={{ background: 'var(--inner-bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, marginBottom: 4 }}>
              {stat.icon} {stat.label}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-1)', letterSpacing: -0.5 }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>
          <span>Vector Coverage</span>
          <span>{repo.totalChunks} / ~5000 chunks</span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
