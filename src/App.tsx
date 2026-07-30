import { useMemo, useState } from 'react';
import { IncidentCard } from './components/IncidentCard.js';
import { IncidentFilters, type FilterState } from './components/IncidentFilters.js';
import type { Incident } from './lib/incidentSchema.js';

const fromQuery = (): FilterState => {
  if (typeof window === 'undefined') return { q: '', state: '', incidentType: '', status: '', year: '', sourceType: '' };
  const query = new URLSearchParams(window.location.search);
  return {
    q: query.get('q') ?? '',
    state: query.get('state') ?? '',
    incidentType: query.get('type') ?? '',
    status: query.get('status') ?? '',
    year: query.get('year') ?? '',
    sourceType: query.get('source') ?? '',
  };
};

const normalizedText = (incident: Incident): string => [
  incident.title,
  incident.summary,
  incident.location.city,
  incident.location.county,
  incident.location.state,
  incident.location.country,
  ...incident.sources.flatMap((source) => [source.title, source.publisher, ...source.key_claims]),
].join(' ').toLocaleLowerCase('en-US');

const updateQuery = (filters: FilterState) => {
  if (typeof window === 'undefined') return;
  const query = new URLSearchParams();
  const entries: Array<[string, string]> = [
    ['q', filters.q], ['state', filters.state], ['type', filters.incidentType],
    ['status', filters.status], ['year', filters.year], ['source', filters.sourceType],
  ];
  for (const [key, value] of entries) if (value) query.set(key, value);
  const next = `${window.location.pathname}${query.size > 0 ? `?${query.toString()}` : ''}${window.location.hash}`;
  window.history.replaceState({}, '', next);
};

interface AppProps {
  incidents: Incident[];
}

export function App({ incidents }: AppProps) {
  const [filters, setFilters] = useState<FilterState>(fromQuery);
  const states = useMemo(() => [...new Set(incidents.map((incident) => incident.location.state).filter(Boolean))].sort(), [incidents]);
  const years = useMemo(() => [...new Set(incidents.map((incident) => incident.dates.reported.slice(0, 4)))].sort().reverse(), [incidents]);
  const shown = useMemo(() => incidents.filter((incident) => {
    const query = filters.q.trim().toLocaleLowerCase('en-US');
    return (!query || normalizedText(incident).includes(query))
      && (!filters.state || incident.location.state === filters.state)
      && (!filters.incidentType || incident.incident_type.includes(filters.incidentType as Incident['incident_type'][number]))
      && (!filters.status || incident.status === filters.status)
      && (!filters.year || incident.dates.reported.startsWith(filters.year))
      && (!filters.sourceType || incident.sources.some((source) => source.source_type === filters.sourceType));
  }), [filters, incidents]);

  const changeFilters = (next: FilterState) => {
    setFilters(next);
    updateQuery(next);
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to incident records</a>
      <div className="scanlines" aria-hidden="true" />
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="Flocking Abuse Tracker home"><span aria-hidden="true" className="record-dot" />FAT // PUBLIC LEDGER</a>
        <nav aria-label="Primary">
          <a href="/">Incidents</a>
          <a href="/docs/source-policy.md">Source policy</a>
          <a href="/docs/reporting-format.md">Reporting format</a>
          <a href="/admin">Admin intake</a>
        </nav>
      </header>

      <main id="main-content">
        <section className="hero" aria-labelledby="page-title">
          <div className="hero__copy">
            <p className="classification">OPEN-SOURCE INTELLIGENCE // CIVIL LIBERTIES</p>
            <h1 id="page-title">Flocking<br /><span>Abuse Tracker</span></h1>
            <p className="hero__lede">A source-grounded public record of reported Flock Safety camera misuse, legal challenges, audit findings, and policy failures.</p>
            <p className="hero__note">Every published entry is attributed. Allegations remain allegations unless an official record establishes otherwise.</p>
          </div>
          <aside className="monitor-panel" aria-label="Tracker publication status">
            <p className="monitor-panel__label">SYSTEM STATUS</p>
            <strong>{String(incidents.length).padStart(3, '0')}</strong>
            <span>verified or disputed files</span>
            <dl><div><dt>Access</dt><dd>Public</dd></div><div><dt>Review</dt><dd>Human</dd></div><div><dt>Auto-publish</dt><dd>Disabled</dd></div></dl>
          </aside>
        </section>

        <IncidentFilters filters={filters} states={states} years={years} onChange={changeFilters} />

        <section className="incident-index" aria-labelledby="index-heading">
          <div className="index-heading"><p className="classification">RESULT SET // {String(shown.length).padStart(3, '0')}</p><h2 id="index-heading">Incident files</h2></div>
          {incidents.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state__code">NO PUBLIC FILES</p>
              <h3>No verified or disputed incidents have been published yet.</h3>
              <p>The public ledger stays empty until records meet the publication and source requirements. Candidate allegations are never shown here.</p>
              <div className="empty-state__links"><a href="/docs/source-policy.md">Read the source policy</a><a href="/docs/reporting-format.md">Review the reporting format</a></div>
            </div>
          ) : shown.length === 0 ? (
            <div className="empty-state"><p className="empty-state__code">NO MATCHES</p><h3>No incident files match these filters.</h3><p>Clear or change the query to search the complete public record.</p></div>
          ) : (
            <div className="incident-list">{shown.map((incident) => <IncidentCard incident={incident} key={incident.id} />)}</div>
          )}
        </section>
      </main>

      <footer><p>Evidence before accusation. Review before publication.</p><p>FLOCKING ABUSE TRACKER // PUBLIC ACCESS</p></footer>
    </div>
  );
}
