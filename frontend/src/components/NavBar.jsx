import { NavLink } from 'react-router-dom';
import { useApp } from '../context/AppContext.jsx';

const icons = {
  scan: (active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 5v2M12 17v2M5 12h2M17 12h2" />
    </svg>
  ),
  cart: (active, count) => (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
      {count > 0 && (
        <span style={{
          position: 'absolute', top: -5, right: -6,
          background: 'var(--avoid)', color: '#fff',
          fontSize: 9, fontWeight: 800, borderRadius: '50%',
          width: 15, height: 15, display: 'flex', alignItems: 'center', justifyContent: 'center',
          lineHeight: 1,
        }}>{count}</span>
      )}
    </div>
  ),
  planner: (active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" strokeWidth="2.5" />
    </svg>
  ),
  profile: (active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
};

const tabs = [
  { to: '/scanner', key: 'scan',    label: 'Scan' },
  { to: '/cart',    key: 'cart',    label: 'Cart' },
  { to: '/planner', key: 'planner', label: 'Planner' },
  { to: '/profile', key: 'profile', label: 'Profile' },
];

export default function NavBar() {
  const { cart } = useApp();

  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      background: '#fff',
      borderTop: '1px solid #EEE8E0',
      boxShadow: '0 -2px 12px rgba(0,0,0,0.07)',
      zIndex: 50,
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      <div style={{ maxWidth: 500, margin: '0 auto', display: 'flex' }}>
        {tabs.map(({ to, key, label }) => (
          <NavLink key={to} to={to} style={{ flex: 1, textDecoration: 'none' }}>
            {({ isActive }) => (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 3, padding: '10px 0 8px',
                color: isActive ? 'var(--green-mid)' : '#9A9590',
                position: 'relative',
              }}>
                {/* Active top indicator */}
                {isActive && (
                  <div style={{
                    position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
                    width: 24, height: 2.5, borderRadius: '0 0 3px 3px',
                    background: 'var(--green-mid)',
                  }} />
                )}

                {key === 'cart'
                  ? icons.cart(isActive, cart.length)
                  : icons[key](isActive)}

                <span style={{
                  fontSize: 10, fontWeight: isActive ? 700 : 500,
                  fontFamily: 'Inter, sans-serif',
                  letterSpacing: '0.2px',
                }}>
                  {label}
                </span>
              </div>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
