import { useMemo } from 'react';
import type { Incident, IncidentType } from './lib/incidentSchema.js';
import { PublicShell } from './components/SiteChrome.js';

const typeLabels: Record<IncidentType, string> = {
  'unauthorized-search': 'Unauthorized search',
  'political-targeting': 'Political targeting',
  'law-enforcement-overreach': 'Law-enforcement overreach',
  'data-sharing': 'Data sharing',
  'retention-or-access-policy': 'Retention or access policy',
  'vendor-or-contracting': 'Vendor or contracting',
  other: 'Other',
};

const timelineDate = (incident: Incident): string => incident.dates.occurred || incident.dates.reported || incident.dates.discovered;
const displayDate = (value: string): string => value.length === 7 ? value : value.slice(0, 10);

function countsFor(values: string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'en-US'));
}

export function SummaryPage({ incidents }: { incidents: Incident[] }) {
  const publicIncidents = useMemo(() => incidents.filter((incident) => ['verified', 'disputed'].includes(incident.status)), [incidents]);
  const companies = useMemo(() => countsFor(publicIncidents.flatMap((incident) => incident.actors.vendor_entities)), [publicIncidents]);
  const types = useMemo(() => countsFor(publicIncidents.flatMap((incident) => incident.incident_type)), [publicIncidents]);
  const years = useMemo(() => countsFor(publicIncidents.map((incident) => timelineDate(incident).slice(0, 4))).sort((left, right) => right[0].localeCompare(left[0])), [publicIncidents]);
  const recent = useMemo(() => [...publicIncidents].sort((left, right) => timelineDate(right).localeCompare(timelineDate(left)) || right.id.localeCompare(left.id)).slice(0, 6), [publicIncidents]);
  const maxCompany = companies[0]?.[1] ?? 1;
  const maxType = types[0]?.[1] ?? 1;
  const firstYear = years.at(-1)?.[0];
  const latestYear = years[0]?.[0];

  return <PublicShell current="summary" skip="Skip to report summary">
    <main id="main-content" tabIndex={-1} className="content-page summary-page">
      <p className="eyebrow">Public record overview</p>
      <h1>Report summary</h1>
      <p className="page-lede">A compact view of the documented record by company, incident type, and year. One report may name multiple companies or carry multiple incident types, so breakdown totals can exceed the report count.</p>

      <section className="summary-totals" aria-label="Report totals">
        <div><span>Published reports</span><strong>{publicIncidents.length}</strong></div>
        <div><span>Companies named</span><strong>{companies.length}</strong></div>
        <div><span>Incident types</span><strong>{types.length}</strong></div>
        <div><span>Chronology</span><strong>{firstYear && latestYear ? `${firstYear}–${latestYear}` : '—'}</strong></div>
      </section>

      {publicIncidents.length === 0 ? <section className="empty-state" aria-labelledby="summary-empty"><p className="empty-state__code">NO PUBLIC FILES</p><h2 id="summary-empty">No reports to summarize yet.</h2><p>The summary appears after records clear the publication and source requirements.</p></section> : <>
        <div className="summary-grid">
          <section className="summary-panel" aria-labelledby="company-summary">
            <div className="summary-panel__heading"><div><p className="eyebrow">Vendor footprint</p><h2 id="company-summary">Reports by company</h2></div><a href="/">Browse records</a></div>
            <ol className="summary-bars">{companies.map(([company, count]) => <li key={company}>
              <a href={`/?company=${encodeURIComponent(company)}`}><span>{company}</span><strong>{count}</strong></a>
              <span className="summary-bar" aria-hidden="true"><span style={{ width: `${(count / maxCompany) * 100}%` }} /></span>
            </li>)}</ol>
          </section>

          <section className="summary-panel" aria-labelledby="type-summary">
            <div className="summary-panel__heading"><div><p className="eyebrow">Accountability themes</p><h2 id="type-summary">Reports by type</h2></div><a href="/">Browse records</a></div>
            <ol className="summary-bars">{types.map(([type, count]) => <li key={type}>
              <a href={`/?type=${encodeURIComponent(type)}`}><span>{typeLabels[type as IncidentType]}</span><strong>{count}</strong></a>
              <span className="summary-bar" aria-hidden="true"><span style={{ width: `${(count / maxType) * 100}%` }} /></span>
            </li>)}</ol>
          </section>
        </div>

        <section className="summary-panel summary-years" aria-labelledby="year-summary">
          <div className="summary-panel__heading"><div><p className="eyebrow">Chronology</p><h2 id="year-summary">Reports by year</h2></div><a href="/timeline">Open timeline</a></div>
          <ol>{years.map(([year, count]) => <li key={year}><strong>{year}</strong><span>{count} {count === 1 ? 'report' : 'reports'}</span></li>)}</ol>
        </section>

        <section className="summary-panel summary-recent" aria-labelledby="recent-summary">
          <div className="summary-panel__heading"><div><p className="eyebrow">Latest chronology</p><h2 id="recent-summary">Recent reports</h2></div><a href="/">All records</a></div>
          <ol>{recent.map((incident) => <li key={incident.id}><time dateTime={timelineDate(incident)}>{displayDate(timelineDate(incident))}</time><a href={`/reports/${incident.id}`}>{incident.title}</a><span>{incident.location.city || incident.location.state || incident.location.country}</span></li>)}</ol>
        </section>
      </>}
    </main>
  </PublicShell>;
}
