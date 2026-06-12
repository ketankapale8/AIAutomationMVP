// src/pages/AnalyticsPage.jsx
// Token usage, ticket type breakdown, LLM provider distribution, 30-day activity chart.

import { useState, useEffect } from 'react';
import axios from 'axios';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

const BASE = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';

const COLORS = ['#a855f7', '#00f2fe', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#0e0b1e', border: '1px solid rgba(168,85,247,0.35)', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
      {label && <div style={{ color: 'var(--text-3)', marginBottom: 4 }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || 'var(--text-1)', fontWeight: 600 }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
        </div>
      ))}
    </div>
  );
};

export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    axios.get(`${BASE}/api/analytics`)
      .then(r => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="empty-state" style={{ marginTop: 60 }}>
      <div className="spin" style={{ fontSize: 28 }}>⚙️</div>
      <div>Loading analytics…</div>
    </div>
  );

  if (!data) return (
    <div className="empty-state card" style={{ marginTop: 40, padding: 60 }}>
      <div className="empty-icon">📊</div>
      <div className="empty-title">Could not load analytics</div>
      <div className="empty-sub">Make sure the backend is running on port 5001.</div>
    </div>
  );

  const byType     = (data.byType     || []).map(d => ({ name: d.issue_type || 'Unknown', value: d.count }));
  const byFormat   = (data.byFormat   || []).map(d => ({ name: `Format ${d.format}`, value: d.count }));
  const byProvider = (data.byProvider || []).map(d => ({ name: d.llm_provider || 'unknown', value: d.count }));
  const activity   = (data.recentActivity || []).map(d => ({ date: d.date?.slice(5) || '', tickets: d.count, tokens: Math.round((d.total_tokens || 0) / 1000) }));

  const totalTokens = (data.totalTokensIn || 0) + (data.totalTokensOut || 0);

  return (
    <div className="fade-in-up">
      <div className="page-header">
        <div>
          <div className="page-title">Analytics</div>
          <div className="page-subtitle">Token usage, model distribution, and 30-day activity</div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="stats-grid" style={{ marginBottom: 24 }}>
        {[
          { label: 'Total Tickets',    value: data.totalTickets  || 0,                  cls: 'violet', icon: '🎫' },
          { label: 'Tokens In',        value: (data.totalTokensIn  || 0).toLocaleString(), cls: 'cyan',   icon: '📥' },
          { label: 'Tokens Out',       value: (data.totalTokensOut || 0).toLocaleString(), cls: 'amber',  icon: '📤' },
          { label: 'Total Tokens',     value: totalTokens.toLocaleString(),               cls: 'green',  icon: '⚡' },
        ].map(stat => (
          <div key={stat.label} className="card stat-card">
            <div className="stat-label">{stat.icon} {stat.label}</div>
            <div className={`stat-value ${stat.cls}`}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Charts row 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px,1fr))', gap: 16, marginBottom: 16 }}>
        {/* By Issue Type */}
        <div className="card" style={{ padding: 20 }}>
          <div className="section-title" style={{ marginBottom: 16 }}>
            <span>🎫</span> Tickets by Issue Type
          </div>
          {byType.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byType} margin={{ top: 0, right: 10, left: -10, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)' }} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="value" name="Tickets" radius={[4, 4, 0, 0]}>
                  {byType.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* By Format */}
        <div className="card" style={{ padding: 20 }}>
          <div className="section-title" style={{ marginBottom: 16 }}>
            <span>📝</span> Prompt Format Split
          </div>
          {byFormat.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={byFormat} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {byFormat.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* By LLM Provider */}
        <div className="card" style={{ padding: 20 }}>
          <div className="section-title" style={{ marginBottom: 16 }}>
            <span>🤖</span> LLM Provider Usage
          </div>
          {byProvider.length === 0 ? <EmptyChart /> : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={byProvider} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}>
                  {byProvider.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 30-Day Activity */}
      <div className="card" style={{ padding: 20 }}>
        <div className="section-title" style={{ marginBottom: 16 }}>
          <span>📅</span> 30-Day Activity
        </div>
        {activity.length === 0 ? <EmptyChart message="No activity yet — process some tickets first." /> : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={activity} margin={{ top: 0, right: 10, left: -10, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-3)' }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'var(--text-3)' }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: 'var(--text-3)' }} unit="k" />
              <Tooltip content={<CustomTooltip />} />
              <Bar yAxisId="left"  dataKey="tickets" name="Tickets" fill="#a855f7" radius={[3,3,0,0]} />
              <Bar yAxisId="right" dataKey="tokens"  name="Tokens (k)" fill="#00f2fe" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Recent Activity Table */}
      {data.recentActivity?.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontSize: 14, fontWeight: 600 }}>
            📋 Recent Activity Log
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Tickets</th>
                  <th>Tokens In</th>
                  <th>Tokens Out</th>
                </tr>
              </thead>
              <tbody>
                {data.recentActivity.slice(0, 15).map((row, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{row.date}</td>
                    <td><span style={{ color: 'var(--violet)', fontWeight: 700 }}>{row.count}</span></td>
                    <td style={{ color: 'var(--cyan)',  fontFamily: 'var(--font-mono)', fontSize: 12 }}>{(row.total_tokens || 0).toLocaleString()}</td>
                    <td style={{ color: 'var(--amber)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{(row.output_tokens || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyChart({ message = 'No data yet.' }) {
  return (
    <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13 }}>
      {message}
    </div>
  );
}
