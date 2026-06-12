// src/components/Sidebar.jsx
import { NavLink, useLocation } from 'react-router-dom';

const navItems = [
  { to: '/',          icon: '🎯', label: 'Live Analysis',  exact: true },
  { to: '/tickets',   icon: '🎫', label: 'Ticket History'  },
  { to: '/repos',     icon: '📦', label: 'Repositories'    },
  { to: '/analytics', icon: '📊', label: 'Analytics'       },
];

export default function Sidebar({ serverStatus }) {
  const location = useLocation();

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="logo-icon">🤖</div>
        <div>
          <div className="logo-text">Jira Analyzer</div>
          <div className="logo-sub">AI · v2.0 · On-Prem</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        <div className="nav-section-label">Dashboard</div>

        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.exact}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <span className="nav-item-icon">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}

        <div className="nav-section-label" style={{ marginTop: 8 }}>System</div>

        <a
          href="http://localhost:5001"
          target="_blank"
          rel="noopener noreferrer"
          className="nav-item"
        >
          <span className="nav-item-icon">🔌</span>
          API Status
          <span className="nav-badge green">5001</span>
        </a>

        <button
          className="nav-item"
          onClick={() =>
            fetch('http://localhost:5001/api/config/reload', { method: 'POST' })
              .then(() => alert('✅ Config reloaded'))
              .catch(() => alert('❌ Could not reach backend'))
          }
        >
          <span className="nav-item-icon">🔄</span>
          Reload Config
        </button>
      </nav>

      {/* Footer status */}
      <div className="sidebar-footer">
        <div className="status-pill">
          <span className="pulse-dot" />
          <span>{serverStatus === 'running' ? 'Backend Live' : 'Connecting…'}</span>
        </div>
      </div>
    </aside>
  );
}
