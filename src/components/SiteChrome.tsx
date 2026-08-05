import { useEffect, useState, type ReactNode } from 'react';
import tassLogo from '../assets/brand/tass-logo.png';

type PublicPage = 'incidents' | 'summary' | 'timeline' | 'unverified' | 'about' | 'source-policy';

export function SiteHeader({ current }: { current: PublicPage }) {
  return <header className="site-header">
    <a className="wordmark" href="/" aria-label="The Abusive Surveillance State home"><img aria-hidden="true" className="wordmark__mark" src={tassLogo} /><span className="wordmark__text"><strong>TASS</strong><small>The Abusive Surveillance State</small></span></a>
    <nav aria-label="Primary">
      <a href="/" aria-current={current === 'incidents' ? 'page' : undefined}>Documented</a>
      <a href="/summary" aria-current={current === 'summary' ? 'page' : undefined}>Summary</a>
      <a href="/timeline" aria-current={current === 'timeline' ? 'page' : undefined}>Timeline</a>
      <a href="/reported-unverified" aria-current={current === 'unverified' ? 'page' : undefined}>Reported / unverified</a>
      <a href="/about" aria-current={current === 'about' ? 'page' : undefined}>About</a>
      <a href="/docs/source-policy.html" aria-current={current === 'source-policy' ? 'page' : undefined}>Source policy</a>
      <a href="/admin">Admin</a>
    </nav>
  </header>;
}

export function SiteFooter() {
  const [counts, setCounts] = useState<{ today: number; total: number } | null>(null);
  useEffect(() => {
    void fetch('/api/analytics/visit', { method: 'POST', credentials: 'same-origin', cache: 'no-store' })
      .then((response) => response.ok ? response.json() as Promise<{ today: { visitors: number }; totalVisitors: number }> : Promise.reject())
      .then((data) => setCounts({ today: data.today.visitors, total: data.totalVisitors }))
      .catch(() => setCounts(null));
  }, []);
  return <footer><p>The Abusive Surveillance State</p><p>Sources accompany every record.</p><p className="visitor-counts" aria-label="Visitor counts">Today: <strong>{counts?.today ?? '—'}</strong> · Total: <strong>{counts?.total ?? '—'}</strong></p></footer>;
}

export function PublicShell({ current, skip, children }: { current: PublicPage; skip: string; children: ReactNode }) {
  return <div className="app-shell"><a className="skip-link" href="#main-content">{skip}</a><div className="scanlines" aria-hidden="true" /><SiteHeader current={current} />{children}<SiteFooter /></div>;
}
