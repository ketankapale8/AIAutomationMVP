// src/components/MarkdownRenderer.jsx
// Renders LLM-generated markdown with code blocks, tables, bold, inline code, headings.

export default function MarkdownRenderer({ text }) {
  if (!text) {
    return <p style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>No analysis generated yet.</p>;
  }

  // Split on fenced code blocks first
  const parts = text.split(/(```[\s\S]*?```)/g);

  return (
    <div style={{ fontSize: 13.5, lineHeight: 1.7 }}>
      {parts.map((part, idx) => {
        if (part.startsWith('```')) {
          const match = part.match(/```(\S*)\n?([\s\S]*?)```/);
          const lang = match ? match[1].split(':')[0] : '';
          const filename = match && match[1].includes(':') ? match[1].split(':')[1] : null;
          const code = match ? match[2] : part.slice(3, -3);

          return (
            <div key={idx} className="code-block">
              <div className="code-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="code-dots">
                    <span style={{ background: '#ff5f56' }} />
                    <span style={{ background: '#ffbd2e' }} />
                    <span style={{ background: '#27c93f' }} />
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>
                    {filename || (lang ? lang + ' snippet' : 'code')}
                  </span>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => navigator.clipboard.writeText(code.trim())}
                >
                  Copy
                </button>
              </div>
              <div className="code-body">
                <pre>{code.trim()}</pre>
              </div>
            </div>
          );
        }

        // Render text lines
        return part.split('\n').map((line, li) => {
          const key = `${idx}-${li}`;
          if (line.startsWith('# '))  return <h1 key={key} style={{ fontSize: 20, fontWeight: 700, color: 'var(--cyan)',   margin: '20px 0 10px', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>{inline(line.slice(2))}</h1>;
          if (line.startsWith('## ')) return <h2 key={key} style={{ fontSize: 16, fontWeight: 600, color: 'var(--violet)', margin: '18px 0 8px' }}>{inline(line.slice(3))}</h2>;
          if (line.startsWith('### '))return <h3 key={key} style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', margin: '14px 0 6px' }}>{inline(line.slice(4))}</h3>;

          // Table detection: lines starting with |
          if (line.startsWith('|') && line.endsWith('|')) {
            const cells = line.slice(1, -1).split('|').map(c => c.trim());
            const isDivider = cells.every(c => /^[-:]+$/.test(c));
            if (isDivider) return null;
            return (
              <div key={key} style={{ display: 'grid', gridTemplateColumns: `repeat(${cells.length}, 1fr)`, gap: 0, borderBottom: '1px solid var(--border)', padding: '6px 0' }}>
                {cells.map((cell, ci) => (
                  <span key={ci} style={{ padding: '4px 8px', fontSize: 12.5, color: 'var(--text-2)' }}>{inline(cell)}</span>
                ))}
              </div>
            );
          }

          // Bullet list
          const bulletMatch = line.match(/^(\s*)([-*•]|\d+\.) (.*)/);
          if (bulletMatch) {
            const indent = (bulletMatch[1].length / 2) * 14;
            return (
              <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginLeft: indent, padding: '3px 0' }}>
                <span style={{ color: 'var(--violet)', marginTop: 2, fontSize: 11, flexShrink: 0 }}>✦</span>
                <span style={{ color: 'var(--text-2)' }}>{inline(bulletMatch[3])}</span>
              </div>
            );
          }

          if (line.trim() === '') return <div key={key} style={{ height: 8 }} />;

          return <p key={key} style={{ color: 'var(--text-2)', margin: '4px 0' }}>{inline(line)}</p>;
        });
      })}
    </div>
  );
}

// Inline formatting: **bold**, `code`, _italic_
function inline(text) {
  if (!text) return '';
  const parts = text.split(/(\*\*.*?\*\*|`[^`]+`|_[^_]+_)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i} style={{ color: 'var(--text-1)', fontWeight: 600 }}>{p.slice(2, -2)}</strong>;
    if (p.startsWith('`') && p.endsWith('`'))  return <code key={i} style={{ background: 'rgba(255,255,255,0.07)', color: 'var(--cyan)', padding: '1px 5px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{p.slice(1, -1)}</code>;
    if (p.startsWith('_') && p.endsWith('_'))  return <em key={i} style={{ color: 'var(--text-3)' }}>{p.slice(1, -1)}</em>;
    return p;
  });
}
