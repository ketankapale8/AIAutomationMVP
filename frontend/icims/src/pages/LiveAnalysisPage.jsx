// src/pages/LiveAnalysisPage.jsx
// The original MVP view — shows the latest ticket analysis in real-time.
// Polls /api/latest-analysis every 3 seconds.

import { useState, useEffect } from 'react';
import axios from 'axios';
import MarkdownRenderer from '../components/MarkdownRenderer';

const BASE = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';

const FORMAT_INFO = {
  A: { label: 'Bug / Task', color: 'var(--amber)', bg: 'var(--amber-dim)' },
  B: { label: 'Feature / Epic', color: 'var(--cyan)',   bg: 'var(--cyan-dim)' },
};

export default function LiveAnalysisPage() {
  const [data, setData] = useState({
    title: 'Waiting for ticket...',
    description: 'Create a ticket on your Jira board to trigger the analysis.',
    solution: '',
    images: [],
    key: '',
    format: null,
    issueType: '',
    repoId: '',
    llmProvider: '',
  });

  useEffect(() => {
    const fetch = () =>
      axios.get(`${BASE}/api/latest-analysis`).then(r => setData(r.data)).catch(() => {});
    fetch();
    const id = setInterval(fetch, 3000);
    return () => clearInterval(id);
  }, []);

  const isWaiting = !data.key;
  const fmt = FORMAT_INFO[data.format] || null;

  const handleExportPDF = () => {
    const w = window.open('', '_blank');
    const html = (data.solution || '').replace(/\n/g, '<br/>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/`(.*?)`/g, '<code>$1</code>');
    w.document.write(`<html><head><title>${data.title}</title>
      <style>body{font-family:sans-serif;padding:40px;color:#111;line-height:1.6}h1{color:#6d28d9}code{background:#f3f4f6;padding:2px 5px;border-radius:4px}</style>
      </head><body><h1>${data.title}</h1><p><strong>Description:</strong> ${data.description}</p><hr/>${html}<script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  };

  return (
    <div className="fade-in-up">
      {/* Ambient glow */}
      <div style={{ position: 'fixed', top: '5%', left: '30%', width: 500, height: 400, background: 'radial-gradient(var(--violet), transparent 70%)', filter: 'blur(100px)', opacity: 0.07, pointerEvents: 'none', zIndex: 0 }} />

      <div className="page-header">
        <div>
          <div className="page-title">Live Analysis</div>
          <div className="page-subtitle">Auto-updates when a new Jira ticket is processed</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="pulse-dot" />
          <span style={{ fontSize: 12, color: 'var(--cyan)', fontWeight: 600 }}>LIVE SYNC</span>
        </div>
      </div>

      {isWaiting ? (
        <WaitingState />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.6fr)', gap: 20 }}>
          {/* Left: Ticket Info */}
          <div className="card" style={{ padding: 24, alignSelf: 'start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 18 }}>🎫</span>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Ticket Details</span>
            </div>

            {/* Badges row */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              <span className="badge" style={{ background: 'var(--violet-dim)', color: 'var(--violet)', borderColor: 'rgba(168,85,247,0.2)' }}>
                🔔 Webhook
              </span>
              {data.issueType && (
                <span className={`badge badge-${data.issueType?.toLowerCase().replace(/\s/g,'') === 'bug' ? 'bug' : data.issueType?.toLowerCase().includes('story') ? 'story' : data.issueType?.toLowerCase().includes('epic') ? 'epic' : 'task'}`}>
                  {data.issueType}
                </span>
              )}
              {fmt && (
                <span className="badge" style={{ background: fmt.bg, color: fmt.color }}>
                  Format {data.format} — {fmt.label}
                </span>
              )}
            </div>

            <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-1)', marginBottom: 16, lineHeight: 1.4 }}>
              {data.title}
            </h3>

            <div style={{ background: 'var(--inner-bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, fontSize: 13, color: 'var(--text-2)', whiteSpace: 'pre-wrap', lineHeight: 1.6, marginBottom: 16 }}>
              {data.description}
            </div>

            {data.images?.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  Attachments ({data.images.length})
                </div>
                {data.images.map((url, i) => (
                  <img key={i} src={url} alt={`att-${i}`} style={{ maxWidth: '100%', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 8 }} />
                ))}
              </div>
            )}

            {/* Meta footer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 14, borderTop: '1px solid var(--border)', fontSize: 12 }}>
              <div>
                <div style={{ color: 'var(--text-3)' }}>Repo</div>
                <div style={{ color: 'var(--cyan)', fontWeight: 600, marginTop: 2 }}>{data.repoId || '—'}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: 'var(--text-3)' }}>Model</div>
                <div style={{ color: 'var(--violet)', fontWeight: 600, marginTop: 2 }}>{data.llmProvider || '—'}</div>
              </div>
            </div>
          </div>

          {/* Right: Analysis */}
          <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600 }}>
                <span>🤖</span> Technical Analysis
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(data.solution || '')}>
                  📋 Copy
                </button>
                <button className="btn btn-ghost btn-sm" onClick={handleExportPDF}>
                  📄 PDF
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <MarkdownRenderer text={data.solution} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WaitingState() {
  return (
    <div className="card" style={{ padding: 48, maxWidth: 720, margin: '0 auto', textAlign: 'left' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
        <div style={{ width: 52, height: 52, background: 'var(--cyan-dim)', border: '1px solid rgba(0,242,254,0.2)', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>📡</div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>Waiting for Jira Ticket</div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>Create a ticket on your Jira board to trigger the analysis.</div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 20 }}>
          Quick Setup — Connect Jira Webhook
        </div>

        {[
          { n: 1, title: 'Expose port 5001 to the internet', code: 'npx localtunnel --port 5001', note: 'Alternative: ngrok http 5001' },
          { n: 2, title: 'Add Webhook URL in Jira Settings', code: 'https://<your-tunnel-url>/api/jira-webhook', note: 'Jira Settings → System → Webhooks → Create' },
          { n: 3, title: 'Select trigger: Issue Created', code: null, note: 'Check "created" and "updated" under Issue events' },
          { n: 4, title: 'Create a ticket — analysis fires automatically', code: null, note: null },
        ].map(step => (
          <div key={step.n} style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
            <div style={{ width: 28, height: 28, flexShrink: 0, borderRadius: '50%', background: 'var(--violet-dim)', border: '1px solid rgba(168,85,247,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'var(--violet)' }}>{step.n}</div>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-1)' }}>{step.title}</div>
              {step.code && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#090714', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', margin: '6px 0', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--violet)' }}>
                  <span style={{ flex: 1 }}>{step.code}</span>
                  <button style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
                    onClick={() => navigator.clipboard.writeText(step.code)}>Copy</button>
                </div>
              )}
              {step.note && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{step.note}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
