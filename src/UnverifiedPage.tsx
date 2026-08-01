import { PublicShell } from './components/SiteChrome.js';
import type { UnverifiedReport } from './lib/unverifiedSchema.js';

export function UnverifiedPage({ reports }: { reports: UnverifiedReport[] }) {
  return <PublicShell current="unverified" skip="Skip to reported but unverified cases"><main id="main-content" tabIndex={-1} className="content-page unverified-page">
    <p className="eyebrow">Separate evidence lane</p><h1>Reported but unverified</h1>
    <p className="page-lede">These reports are plausible and sourced, but do not meet the documented-incident standard. They are published as leads—not established findings—and do not count toward the documented total.</p>
    <div className="incident-list">{reports.map((report) => <article className="incident-card incident-card--unverified" key={report.id}>
      <header className="incident-card__header"><div><p className="eyebrow">Lead {report.id}</p><h2>{report.title}</h2></div><span className="status-badge status-badge--candidate">● Unverified</span></header>
      <dl className="incident-meta"><div><dt>Reported</dt><dd>{report.reported || 'Unknown'}</dd></div><div><dt>Location</dt><dd>{[report.location.city, report.location.county, report.location.state, report.location.country].filter(Boolean).join(', ')}</dd></div><div><dt>Agency</dt><dd>{report.agencies.join(', ')}</dd></div><div><dt>Companies involved</dt><dd>{report.companies.join(', ')}</dd></div></dl>
      <p className="incident-summary">{report.summary}</p>
      <section className="verification-gap"><h3>Why this is not verified</h3><p>{report.verification_status.reason}</p><h3>Evidence still needed</h3><ul>{report.verification_status.evidence_needed.map((item) => <li key={item}>{item}</li>)}</ul></section>
      <section className="evidence-panel"><h3>Reported sources</h3>{report.sources.map((source) => <div className="source-record" key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title} — {source.publisher} ↗</a><ul>{source.key_claims.map((claim) => <li key={claim}>{claim}</li>)}</ul></div>)}</section>
    </article>)}</div>
  </main></PublicShell>;
}
