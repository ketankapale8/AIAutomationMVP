// src/pages/TicketsPage.jsx
// Full ticket history from SQLite — search, filter by type/format, click to view full analysis.

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import MarkdownRenderer from '../components/MarkdownRenderer';

const BASE = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';

const TYPE_BADGE = {
  bug: 'badge-bug', task: 'badge-task', story: 'badge-story',
  epic: 'badge-epic', feature: 'badge-story', 'new feature': 'badge-story',
};

function getBadgeClass(type) {
  return TYPE_BADGE[(type || '').toLowerCase()] || 'badge-task';
}

export default function TicketsPage() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterFormat, setFilterFormat] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback((isBackground = false) => {
    if (!isBackground) setLoading(true);
    axios.get(`${BASE}/api/tickets?limit=100`)
      .then(r => setTickets(r.data.tickets || []))
      .catch(() => setTickets([]))
      .finally(() => { if (!isBackground) setLoading(false); });
  }, []);

  useEffect(() => {
    load();
    const intervalId = setInterval(() => load(true), 5000);
    return () => clearInterval(intervalId);
  }, [load]);

  const openDetail = async (key) => {
    setSelected(key);
    setDetailLoading(true);
    setDetail(null);
    try {
      const r = await axios.get(`${BASE}/api/tickets/${key}`);
      setDetail(r.data);
    } catch { setDetail(null); }
    setDetailLoading(false);
  };

  const closeDetail = () => { setSelected(null); setDetail(null); };

  // Filter
  const filtered = tickets.filter(t => {
    const q = search.toLowerCase();
    const matchSearch = !q || t.issue_key?.toLowerCase().includes(q) || t.title?.toLowerCase().includes(q);
    const matchFormat = filterFormat === 'all' || t.format === filterFormat;
    const matchType   = filterType  === 'all' || (t.issue_type || '').toLowerCase() === filterType.toLowerCase();
    return matchSearch && matchFormat && matchType;
  });

  const uniqueTypes = [...new Set(tickets.map(t => t.issue_type).filter(Boolean))];

  // Pagination states
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Reset page to 1 when filters or search change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, filterFormat, filterType]);

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedTickets = filtered.slice(startIndex, startIndex + itemsPerPage);

  return (
    <div className="fade-in-up">
      <div className="page-header">
        <div>
          <div className="page-title">Ticket History</div>
          <div className="page-subtitle">{tickets.length} analyses stored · click any row to view full output</div>
        </div>
        <button className="btn btn-ghost" onClick={load}>🔄 Refresh</button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="search-bar" style={{ flex: 1, minWidth: 200 }}>
          <span style={{ color: 'var(--text-3)' }}>🔍</span>
          <input
            placeholder="Search by key or title…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <select
          value={filterFormat}
          onChange={e => setFilterFormat(e.target.value)}
          style={{ background: 'var(--inner-bg)', border: '1px solid var(--border)', color: 'var(--text-2)', padding: '8px 12px', borderRadius: 8, fontSize: 13, fontFamily: 'var(--font-sans)' }}
        >
          <option value="all">All Formats</option>
          <option value="A">Format A (Bug/Task)</option>
          <option value="B">Format B (Feature/Epic)</option>
        </select>

        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          style={{ background: 'var(--inner-bg)', border: '1px solid var(--border)', color: 'var(--text-2)', padding: '8px 12px', borderRadius: 8, fontSize: 13, fontFamily: 'var(--font-sans)' }}
        >
          <option value="all">All Types</option>
          {uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="card">
        {loading ? (
          <div className="empty-state">
            <div style={{ fontSize: 28 }} className="spin">⚙️</div>
            <div className="empty-title">Loading tickets…</div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🎫</div>
            <div className="empty-title">No tickets yet</div>
            <div className="empty-sub">Ticket analyses appear here after Jira webhooks fire. Make sure the indexer has run first.</div>
          </div>
        ) : (
          <>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Format</th>
                    <th>Repo</th>
                    <th>Model</th>
                    <th>Tokens In</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedTickets.map(t => (
                    <tr key={t.id} onClick={() => openDetail(t.issue_key)} style={{ cursor: 'pointer' }}>
                      <td>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--violet)', fontWeight: 600 }}>{t.issue_key}</span>
                      </td>
                      <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-1)' }}>
                        {t.title}
                      </td>
                      <td><span className={`badge ${getBadgeClass(t.issue_type)}`}>{t.issue_type || '—'}</span></td>
                      <td>
                        <span className={`badge badge-${(t.format || '').toLowerCase()}`}>
                          {t.format ? `Format ${t.format}` : '—'}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--text-3)' }}>{t.repo_id || '—'}</td>
                      <td style={{ fontSize: 11.5, color: 'var(--text-3)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.llm_provider || '—'}
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--amber)' }}>{t.input_tokens?.toLocaleString() || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>
                        {t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderTop: '1px solid var(--border)', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  Showing <span style={{ color: 'var(--text-2)', fontWeight: 500 }}>{startIndex + 1}</span> to <span style={{ color: 'var(--text-2)', fontWeight: 500 }}>{Math.min(startIndex + itemsPerPage, filtered.length)}</span> of <span style={{ color: 'var(--text-2)', fontWeight: 500 }}>{filtered.length}</span> tickets
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button 
                    className="btn btn-ghost btn-sm" 
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    style={{ opacity: currentPage === 1 ? 0.4 : 1, cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
                  >
                    ◀ Prev
                  </button>
                  {[...Array(totalPages)].map((_, index) => {
                    const pageNum = index + 1;
                    return (
                      <button
                        key={pageNum}
                        className={`btn btn-sm ${currentPage === pageNum ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setCurrentPage(pageNum)}
                        style={{ minWidth: 32, justifyContent: 'center' }}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                  <button 
                    className="btn btn-ghost btn-sm" 
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    style={{ opacity: currentPage === totalPages ? 0.4 : 1, cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}
                  >
                    Next ▶
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Detail Modal */}
      {selected && (
        <div className="modal-overlay" onClick={closeDetail}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--violet)', fontWeight: 700 }}>{selected}</span>
                  {detail && <span className={`badge ${getBadgeClass(detail.issue_type)}`}>{detail.issue_type}</span>}
                  {detail && <span className={`badge badge-${(detail.format||'').toLowerCase()}`}>Format {detail.format}</span>}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.3 }}>
                  {detailLoading ? 'Loading…' : detail?.title || '—'}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={closeDetail}>✕ Close</button>
            </div>

            <div className="modal-body">
              {detailLoading ? (
                <div className="empty-state" style={{ padding: 40 }}>
                  <div className="spin" style={{ fontSize: 24 }}>⚙️</div>
                  <div>Loading analysis…</div>
                </div>
              ) : detail ? (
                <>
                  {detail.description && (
                    <div style={{ background: 'var(--inner-bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, fontSize: 13, color: 'var(--text-2)', marginBottom: 20, lineHeight: 1.6 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Description</div>
                      {detail.description}
                    </div>
                  )}
                  <MarkdownRenderer text={detail.analysis} />
                </>
              ) : (
                <div className="empty-state">Could not load ticket details.</div>
              )}
            </div>

            <div className="modal-footer">
              {detail?.jira_url && (
                <a href={detail.jira_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
                  🔗 Open in Jira
                </a>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => detail && navigator.clipboard.writeText(detail.analysis || '')}>
                📋 Copy Analysis
              </button>
              <button className="btn btn-primary btn-sm" onClick={closeDetail}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
