import { useState, useEffect } from 'react';
import axios from 'axios';

// Predefined test ticket scenarios for easy MVP verification (Commented out as requested)
/*
const TEST_SCENARIOS = [
  {
    id: 1,
    key: "SCRUM-MOCK-1",
    summary: "Bug: Element layout shift inside framework card wrapper",
    description: "The framework elements in page.tsx are not aligning correctly when viewed on mobile screens. The delete button should remain on the right side and the drag handle should be easily touchable.",
    images: ["/attachments/mock-layout-bug.png"]
  },
  {
    id: 2,
    key: "SCRUM-MOCK-2",
    summary: "Feature Request: Add delete animation to SortableLinks",
    description: "Currently, when deleting a framework from the list, the item instantly disappears. We need to add a fade-out animation and transition support so the delete action feels smooth.",
    images: []
  },
  {
    id: 3,
    key: "SCRUM-MOCK-3",
    summary: "Bug: DnD sensors are too sensitive on mobile devices",
    description: "When scrolling the page on a mobile device, users accidentally trigger drag and drop. We should adjust PointerSensor properties in page.tsx to require a minimal distance of 8px or delay of 250ms before initiating drag.",
    images: []
  }
];
*/

export default function App() {
  const [data, setData] = useState({ title: 'Waiting for ticket...', description: 'Create a ticket on your Jira board to trigger the workflow.', solution: '', images: [] });
  const [loading, setLoading] = useState(false);

  const fetchLatestData = async () => {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5001';
      const response = await axios.get(`${backendUrl}/api/latest-analysis`);
      if (response.data) {
        setData(response.data);
      }
    } catch (err) {
      console.error("Error polling backend:", err);
    }
  };

  // Poll backend every 3 seconds to auto-update when a live webhook fires
  useEffect(() => {
    fetchLatestData();
    const interval = setInterval(fetchLatestData, 3000);
    return () => clearInterval(interval);
  }, []);

  // Helper function to render markdown in a premium style
  const renderMarkdown = (text) => {
    if (!text) return <p style={{ color: 'var(--text-muted)' }}>No technical solution generated yet.</p>;

    const parts = text.split(/(```[\s\S]*?```)/g);

    return parts.map((part, index) => {
      if (part.startsWith('```')) {
        // Extract language and code content
        const match = part.match(/```(\w*)\n([\s\S]*?)```/);
        const language = match ? match[1] : '';
        let code = match ? match[2] : part.slice(3, -3);
        
        // Dynamic file header extraction
        let filename = 'code-snippet.' + (language || 'txt');
        const fileHeaderMatch = code.match(/^(?:File|Location|---)\s*:\s*([^\n]+)\n/i) || code.match(/^\/\/\s*([a-zA-Z0-9_\-\./]+)\n/i);
        if (fileHeaderMatch) {
          filename = fileHeaderMatch[1].trim();
          code = code.replace(/^(?:File|Location|---)\s*:\s*[^\n]+\n/i, '').replace(/^\/\/\s*[a-zA-Z0-9_\-\./]+\n/i, '');
        }

        return (
          <div key={index} style={{ margin: '24px 0', border: '1px solid var(--panel-border)', borderRadius: '12px', overflow: 'hidden', background: '#090714', boxShadow: 'inset 0 0 20px rgba(0,0,0,0.4)' }}>
            {/* Mock Editor Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ff5f56' }}></span>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ffbd2e' }}></span>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#27c93f' }}></span>
                <span style={{ marginLeft: '12px', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '500' }}>
                  {filename}
                </span>
              </div>
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(code);
                  alert("Code copied to clipboard!");
                }} 
                style={{ background: 'rgba(168, 85, 247, 0.12)', border: '1px solid rgba(168, 85, 247, 0.3)', borderRadius: '6px', color: '#c084fc', padding: '4px 10px', fontSize: '11px', cursor: 'pointer', fontFamily: 'var(--font-sans)', transition: '0.2s', fontWeight: '500' }}
                onMouseOver={(e) => { e.target.style.background = 'rgba(168, 85, 247, 0.25)'; }}
                onMouseOut={(e) => { e.target.style.background = 'rgba(168, 85, 247, 0.12)'; }}
              >
                Copy Code
              </button>
            </div>
            <div style={{ overflowX: 'auto', padding: '18px' }}>
              <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '13px', color: '#e2e8f0', lineHeight: '1.6', textAlign: 'left', whiteSpace: 'pre-wrap' }}>
                {code.trim()}
              </pre>
            </div>
          </div>
        );
      } else {
        // Non-code block markdown
        const lines = part.split('\n');
        return lines.map((line, lineIdx) => {
          if (line.startsWith('# ')) {
            return <h1 key={`${index}-${lineIdx}`} style={{ color: 'var(--accent-secondary)', fontSize: '22px', margin: '22px 0 12px 0', borderBottom: '1px solid var(--panel-border)', paddingBottom: '6px', textAlign: 'left', fontWeight: '600' }}>{line.slice(2)}</h1>;
          }
          if (line.startsWith('## ')) {
            return <h2 key={`${index}-${lineIdx}`} style={{ color: '#c084fc', fontSize: '18px', margin: '20px 0 10px 0', textAlign: 'left', fontWeight: '500' }}>{line.slice(3)}</h2>;
          }
          if (line.startsWith('### ')) {
            return <h3 key={`${index}-${lineIdx}`} style={{ color: '#e9d5ff', fontSize: '15px', margin: '16px 0 8px 0', textAlign: 'left', fontWeight: '500' }}>{line.slice(4)}</h3>;
          }
          if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
            const content = line.trim().slice(2);
            return (
              <div key={`${index}-${lineIdx}`} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', margin: '6px 0', textAlign: 'left', paddingLeft: '12px' }}>
                <span style={{ color: 'var(--accent-primary)', marginTop: '2px', fontSize: '12px' }}>✦</span>
                <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{parseInlineCodeAndBold(content)}</span>
              </div>
            );
          }
          if (line.trim() === '') return <div key={`${index}-${lineIdx}`} style={{ height: '8px' }}></div>;
          return <p key={`${index}-${lineIdx}`} style={{ fontSize: '14.5px', color: 'var(--text-secondary)', margin: '6px 0', textAlign: 'left', lineHeight: '1.6' }}>{parseInlineCodeAndBold(line)}</p>;
        });
      }
    });
  };

  const parseInlineCodeAndBold = (text) => {
    if (!text) return "";
    const boldParts = text.split(/(\*\*.*?\*\*)/g);
    return boldParts.map((boldPart, bIdx) => {
      if (boldPart.startsWith('**') && boldPart.endsWith('**')) {
        return <strong key={bIdx} style={{ color: '#ffffff', fontWeight: '600' }}>{parseInlineCode(boldPart.slice(2, -2))}</strong>;
      }
      return parseInlineCode(boldPart);
    });
  };

  const parseInlineCode = (text) => {
    const codeParts = text.split(/(`.*?`)/g);
    return codeParts.map((codePart, cIdx) => {
      if (codePart.startsWith('`') && codePart.endsWith('`')) {
        return (
          <code key={cIdx} style={{ background: 'rgba(255, 255, 255, 0.06)', color: 'var(--accent-secondary)', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '2px 6px', borderRadius: '4px', fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
            {codePart.slice(1, -1)}
          </code>
        );
      }
      return codePart;
    });
  };

  const copyMarkdownToClipboard = () => {
    if (!data || !data.solution) return;
    navigator.clipboard.writeText(data.solution);
    alert("Markdown copied to clipboard!");
  };

  const exportToPDF = () => {
    if (!data || !data.solution) return;
    const printWindow = window.open('', '_blank');
    
    // Convert basic markdown tags to simple HTML formatting for high-quality printing
    const formattedSolution = data.solution
      .replace(/\n/g, '<br/>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/✦/g, '&bull;');

    printWindow.document.write(`
      <html>
        <head>
          <title>${data.title} - Technical Analysis</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; color: #1f2937; line-height: 1.6; }
            .header { border-bottom: 2px solid #e5e7eb; padding-bottom: 20px; margin-bottom: 30px; }
            h1 { color: #6d28d9; margin: 0; font-size: 24px; }
            .meta { margin-top: 10px; font-size: 13px; color: #4b5563; }
            h2 { color: #4338ca; font-size: 18px; margin-top: 30px; border-bottom: 1px solid #f3f4f6; padding-bottom: 5px; }
            pre { background: #f3f4f6; border: 1px solid #e5e7eb; padding: 15px; border-radius: 8px; overflow-x: auto; font-family: monospace; font-size: 13px; }
            code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 13px; }
            .description { background: #f9fafb; border: 1px solid #f3f4f6; padding: 15px; border-radius: 8px; font-size: 14px; margin-bottom: 30px; white-space: pre-wrap; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>📄 AI Technical Analysis</h1>
            <div class="meta">
              <strong>Ticket:</strong> ${data.title}<br/>
              <strong>Date:</strong> ${new Date().toLocaleString()}
            </div>
          </div>
          
          <h2>Ticket Description</h2>
          <div class="description">${data.description}</div>
          
          <h2>Technical Analysis & Suggested Changes</h2>
          <div style="font-size: 14.5px;">${formattedSolution}</div>
          
          <script>
            window.onload = function() {
              window.print();
            }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const isWaitingForTicket = !data || data.title === "Waiting for ticket...";

  return (
    <div className="fade-in" style={{ width: '100%' }}>
      {/* Glow Ambient Circles */}
      <div style={{ position: 'absolute', top: '-10%', left: '15%', width: '350px', height: '350px', background: 'radial-gradient(var(--accent-primary), transparent 70%)', filter: 'blur(80px)', opacity: '0.15', pointerEvents: 'none', zIndex: '0' }}></div>
      <div style={{ position: 'absolute', top: '20%', right: '10%', width: '400px', height: '400px', background: 'radial-gradient(var(--accent-secondary), transparent 70%)', filter: 'blur(100px)', opacity: '0.12', pointerEvents: 'none', zIndex: '0' }}></div>

      {/* Header Container */}
      <header className="glass-panel" style={{ padding: '24px 32px', marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: '1' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '24px' }}>🤖</span>
            <h1 style={{ fontSize: '28px', fontWeight: '700', letterSpacing: '-0.75px', background: 'linear-gradient(90deg, #fff, #c084fc)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', margin: 0 }}>
              Agentic JIRA Ticket Analyzer for iCIMS
            </h1>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '6px', fontWeight: '400' }}>
            Local Llama 3 Technical Analysis Engine for <code style={{ fontSize: '12px', background: 'rgba(255,255,255,0.05)', color: '#fff' }}>nextjs-dnd</code>
          </p>
        </div>
        
        {/* Sync Status Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(0, 242, 254, 0.05)', border: '1px solid rgba(0, 242, 254, 0.2)', padding: '8px 16px', borderRadius: '50px' }}>
          <span className="pulse-dot"></span>
          <span style={{ fontSize: '13px', color: 'var(--accent-secondary)', fontWeight: '600', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
            {loading ? 'Analyzing Repo' : 'Live Sync Active'}
          </span>
        </div>
      </header>

      {isWaitingForTicket ? (
        <section className="glass-panel fade-in" style={{ padding: '40px', textAlign: 'left', position: 'relative', zIndex: '1', maxWidth: '800px', margin: '0 auto' }}>
          {/* Glowing scanner header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
            <div style={{ position: 'relative', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 242, 254, 0.1)', borderRadius: '12px', border: '1px solid rgba(0, 242, 254, 0.3)' }}>
              <span style={{ fontSize: '24px', animation: 'pulse 1.5s infinite ease-in-out' }}>📡</span>
            </div>
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: '600', color: '#fff', margin: 0 }}>Waiting for Jira Ticket...</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '2px' }}>Create a ticket on your Jira board to trigger the analysis workflow.</p>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: '24px' }}>
            <h3 style={{ fontSize: '15px', color: 'var(--accent-secondary)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '16px' }}>
              How to configure the Jira Webhook locally:
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Step 1 */}
              <div style={{ display: 'flex', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '50%', background: 'rgba(168, 85, 247, 0.2)', border: '1px solid rgba(168, 85, 247, 0.4)', color: '#d8b4fe', fontSize: '13px', fontWeight: '700', flexShrink: 0 }}>1</div>
                <div>
                  <h4 style={{ fontSize: '14.5px', color: '#fff', fontWeight: '600' }}>Expose local port 5001 to the internet</h4>
                  <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    Since Jira Cloud resides on the web, it needs a public URL to send webhooks to your local machine. Start a secure tunnel in a new terminal window:
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#090714', border: '1px solid var(--panel-border)', borderRadius: '8px', padding: '10px 14px', marginTop: '8px', fontFamily: 'var(--font-mono)', fontSize: '13px', color: '#c084fc' }}>
                    <span style={{ flexGrow: 1, whiteSpace: 'nowrap', overflowX: 'auto' }}>npx localtunnel --port 5001</span>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText("npx localtunnel --port 5001");
                        alert("Command copied to clipboard!");
                      }}
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}
                    >
                      Copy
                    </button>
                  </div>
                  <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '6px' }}>
                    Alternative: <code>ngrok http 5001</code>
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div style={{ display: 'flex', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '50%', background: 'rgba(168, 85, 247, 0.2)', border: '1px solid rgba(168, 85, 247, 0.4)', color: '#d8b4fe', fontSize: '13px', fontWeight: '700', flexShrink: 0 }}>2</div>
                <div>
                  <h4 style={{ fontSize: '14.5px', color: '#fff', fontWeight: '600' }}>Add Webhook URL in Jira Settings</h4>
                  <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    Go to your Jira settings (<strong style={{ color: '#fff' }}>Jira Settings &gt; System &gt; Webhooks</strong>) and click <strong style={{ color: '#fff' }}>Create a Webhook</strong>. Set the URL to:
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#090714', border: '1px solid var(--panel-border)', borderRadius: '8px', padding: '10px 14px', marginTop: '8px', fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--accent-secondary)' }}>
                    <span style={{ flexGrow: 1, whiteSpace: 'nowrap', overflowX: 'auto' }}>https://&lt;your-tunnel-url&gt;/api/jira-webhook</span>
                  </div>
                </div>
              </div>

              {/* Step 3 */}
              <div style={{ display: 'flex', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '50%', background: 'rgba(168, 85, 247, 0.2)', border: '1px solid rgba(168, 85, 247, 0.4)', color: '#d8b4fe', fontSize: '13px', fontWeight: '700', flexShrink: 0 }}>3</div>
                <div>
                  <h4 style={{ fontSize: '14.5px', color: '#fff', fontWeight: '600' }}>Select Issue Trigger Event</h4>
                  <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    Scroll down to <strong style={{ color: '#fff' }}>Issue related events</strong>, set JQL to <code style={{ fontSize: '12px', background: 'rgba(255,255,255,0.05)' }}>All issues</code> (or filter by project), and check the <strong style={{ color: '#fff' }}>created</strong> event under the Issue column. Save the Webhook.
                  </p>
                </div>
              </div>

              {/* Step 4 */}
              <div style={{ display: 'flex', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '50%', background: 'rgba(168, 85, 247, 0.2)', border: '1px solid rgba(168, 85, 247, 0.4)', color: '#d8b4fe', fontSize: '13px', fontWeight: '700', flexShrink: 0 }}>4</div>
                <div>
                  <h4 style={{ fontSize: '14.5px', color: '#fff', fontWeight: '600' }}>Create a Ticket on Jira Board</h4>
                  <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                    Create a new ticket directly on your Kanban or Scrum board. As soon as you save the ticket, the webhook will fire, and the agentic analyzer will automatically read your codebase, analyze the ticket, and render the solution here.
                  </p>
                </div>
              </div>

            </div>
          </div>
        </section>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.5fr)', gap: '30px', position: 'relative', zIndex: '1' }}>
          
          {/* Ticket Panel */}
          <section className="glass-panel fade-in" style={{ padding: '24px', alignSelf: 'start', minWidth: '0' }}>
            <h2 style={{ fontSize: '18px', color: '#fff', borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px', marginBottom: '20px', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>📋</span> Ticket Details
            </h2>
            
            <div style={{ textAlign: 'left' }}>
              <span style={{ display: 'inline-block', background: 'rgba(168, 85, 247, 0.15)', color: '#d8b4fe', fontSize: '11px', fontWeight: '700', padding: '4px 8px', borderRadius: '4px', textTransform: 'uppercase', marginBottom: '8px', border: '1px solid rgba(168, 85, 247, 0.3)' }}>
                Webhook Triggered
              </span>
              <h3 style={{ fontSize: '18px', color: '#fff', fontWeight: '600', marginBottom: '16px', lineHeight: '1.4' }}>
                {data.title}
              </h3>

              <div style={{ margin: '20px 0' }}>
                <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', marginBottom: '8px' }}>
                  Description
                </h4>
                <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--panel-border)', padding: '16px', borderRadius: '10px', fontSize: '14px', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>
                  {data.description}
                </div>
              </div>

              {data.images && data.images.length > 0 && (
                <div style={{ margin: '20px 0' }}>
                  <h4 style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: '600', textTransform: 'uppercase', marginBottom: '8px' }}>
                    Attachments ({data.images.length})
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {data.images.map((imgUrl, idx) => (
                      <img
                        key={idx}
                        src={imgUrl}
                        alt={`Attachment ${idx + 1}`}
                        style={{ maxWidth: '100%', borderRadius: '10px', border: '1px solid var(--panel-border)', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--panel-border)', paddingTop: '16px', marginTop: '20px', fontSize: '13px' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Target Repository:</span>
                  <div style={{ color: '#fff', fontWeight: '500', marginTop: '2px' }}>repo/nextjs-dnd</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Agent Assigned:</span>
                  <div style={{ color: 'var(--accent-secondary)', fontWeight: '500', marginTop: '2px' }}>Llama 3 Analyst</div>
                </div>
              </div>
            </div>
          </section>

          {/* Analysis Output Panel */}
          <section className="glass-panel fade-in" style={{ padding: '24px', display: 'flex', flexDirection: 'column', minWidth: '0' }}>
            
            {/* Section Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--panel-border)', paddingBottom: '12px', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '18px', color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>🤖</span> Technical Analysis
              </h2>
              {/* Export Actions */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={copyMarkdownToClipboard}
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--panel-border)',
                    borderRadius: '6px',
                    color: 'var(--text-secondary)',
                    padding: '6px 12px',
                    fontSize: '12.5px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                  onMouseOver={(e) => { e.target.style.background = 'rgba(255, 255, 255, 0.1)'; e.target.style.color = '#fff'; }}
                  onMouseOut={(e) => { e.target.style.background = 'rgba(255, 255, 255, 0.05)'; e.target.style.color = 'var(--text-secondary)'; }}
                >
                  <span>📋</span> Copy Markdown
                </button>
                <button
                  onClick={exportToPDF}
                  style={{
                    background: 'rgba(0, 242, 254, 0.1)',
                    border: '1px solid rgba(0, 242, 254, 0.3)',
                    borderRadius: '6px',
                    color: 'var(--accent-secondary)',
                    padding: '6px 12px',
                    fontSize: '12.5px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                  onMouseOver={(e) => { e.target.style.background = 'rgba(0, 242, 254, 0.2)'; e.target.style.color = '#fff'; }}
                  onMouseOut={(e) => { e.target.style.background = 'rgba(0, 242, 254, 0.1)'; e.target.style.color = 'var(--accent-secondary)'; }}
                >
                  <span>📄</span> Export to PDF
                </button>
              </div>
            </div>

            {/* Section Content */}
            <div style={{ flexGrow: 1, minHeight: '350px' }}>
              {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', minHeight: '350px', gap: '16px' }}>
                  {/* Beautiful CSS Spinner */}
                  <div style={{
                    width: '40px',
                    height: '40px',
                    border: '3px solid rgba(168, 85, 247, 0.1)',
                    borderTop: '3px solid var(--accent-primary)',
                    borderRight: '3px solid var(--accent-secondary)',
                    borderRadius: '50%',
                    animation: 'pulse 1s linear infinite'
                  }}></div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '14px', fontWeight: '500' }}>
                    Scanning codebase files & querying Llama 3 model...
                  </div>
                </div>
              ) : (
                <div style={{ overflowY: 'auto' }}>
                  {renderMarkdown(data.solution)}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Footer Signature */}
      <footer style={{ 
        marginTop: '48px', 
        padding: '24px 0 8px 0', 
        borderTop: '1px solid var(--panel-border)', 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        gap: '8px', 
        fontSize: '13px', 
        color: 'var(--text-muted)', 
        position: 'relative', 
        zIndex: '1',
        fontFamily: 'var(--font-sans)',
        letterSpacing: '0.5px'
      }}>
        <span>Developed by</span>
        <a 
          href="https://ketankapale.netlify.app/" 
          target="_blank" 
          rel="noopener noreferrer" 
          style={{ color: 'var(--accent-secondary)', textDecoration: 'none', fontWeight: '600', transition: '0.2s' }}
          onMouseOver={(e) => { e.target.style.color = '#fff'; e.target.style.textDecoration = 'underline'; }}
          onMouseOut={(e) => { e.target.style.color = 'var(--accent-secondary)'; e.target.style.textDecoration = 'none'; }}
        >
          Ketan.K
        </a>
        <span style={{ margin: '0 8px', color: 'rgba(255, 255, 255, 0.15)' }}>|</span>
        <a 
          href="https://github.com/ketankapale8/AIAutomationMVP" 
          target="_blank" 
          rel="noopener noreferrer" 
          style={{ color: 'var(--text-muted)', textDecoration: 'none', display: 'flex', alignItems: 'center', transition: '0.2s' }}
          onMouseOver={(e) => { e.currentTarget.style.color = '#fff'; }}
          onMouseOut={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          title="View Source Code on GitHub"
        >
          <svg height="16" viewBox="0 0 16 16" width="16" style={{ fill: 'currentColor' }}>
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
          </svg>
        </a>
      </footer>
    </div>
  );
}