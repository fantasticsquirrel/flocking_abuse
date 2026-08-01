import { useEffect, useMemo, useState } from 'react';
import { IncidentCard } from './components/IncidentCard.js';
import { IncidentFilters, type FilterState } from './components/IncidentFilters.js';
import type { Incident } from './lib/incidentSchema.js';
import { PublicShell } from './components/SiteChrome.js';

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
  incident.id,
  incident.title,
  incident.summary,
  incident.location.city,
  incident.location.county,
  incident.location.state,
  incident.location.country,
  ...incident.actors.agencies,
  ...incident.actors.officials_or_entities,
  ...incident.actors.vendor_entities,
  incident.dates.occurred,
  incident.dates.discovered,
  incident.dates.reported,
  incident.updated_at,
  ...incident.legal_or_policy_context.case_numbers,
  ...incident.legal_or_policy_context.statutes_or_policies,
  ...incident.outcomes,
  ...incident.sources.flatMap((source) => [source.title, source.publisher, source.published_date, ...source.key_claims]),
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
  const years = useMemo(() => [...new Set(incidents.map((incident) => incident.dates.reported.slice(0, 4)).filter(Boolean))].sort().reverse(), [incidents]);
  const publicCount = useMemo(() => incidents.filter((incident) => ['verified', 'disputed'].includes(incident.status)).length, [incidents]);
  const shown = useMemo(() => incidents.filter((incident) => {
    const query = filters.q.trim().toLocaleLowerCase('en-US');
    return (!query || normalizedText(incident).includes(query))
      && (!filters.state || incident.location.state === filters.state)
      && (!filters.incidentType || incident.incident_type.includes(filters.incidentType as Incident['incident_type'][number]))
      && (filters.status ? incident.status === filters.status : incident.status !== 'retracted')
      && (!filters.year || incident.dates.reported.startsWith(filters.year))
      && (!filters.sourceType || incident.sources.some((source) => source.source_type === filters.sourceType));
  }), [filters, incidents]);

  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
  }, [shown]);

  const changeFilters = (next: FilterState) => {
    setFilters(next);
    updateQuery(next);
  };

  return (
    <PublicShell current="incidents" skip="Skip to incident records">
      <main id="main-content" tabIndex={-1}>
        <section className="hero" aria-labelledby="page-title">
          <div className="hero__copy">
            <p className="eyebrow">Public records of camera misuse</p>
            <h1 id="page-title">Flocking<br /><span>Abuse Tracker</span></h1>
            <p className="hero__lede">Reported misuse, legal challenges, audit findings, and policy failures involving Flock Safety, Axon, and other camera systems—documented with links to the record.</p>
            <p className="hero__note">Claims are attributed to their sources. Allegations remain allegations unless established by an official record.</p>
          </div>
          <aside className="monitor-panel" aria-label="Published incident count">
            <p className="monitor-panel__label">Documented incidents</p>
            <strong>{String(publicCount).padStart(3, '0')}</strong>
            <span>published records</span>
            <a href="#incident-records">Browse the records</a>
          </aside>
        </section>

        <IncidentFilters filters={filters} states={states} years={years} onChange={changeFilters} />

        <section className="incident-index" id="incident-records" aria-labelledby="index-heading">
          <div className="index-heading"><p className="eyebrow">{shown.length === 1 ? '1 record' : `${shown.length} records`}</p><h2 id="index-heading">Documented incidents</h2></div>
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{shown.length === 1 ? '1 incident shown' : `${shown.length} incidents shown`}</p>
          {publicCount === 0 && !filters.status ? (
            <div className="empty-state">
              <p className="empty-state__code">NO PUBLIC FILES</p>
              <h3>No verified or disputed incidents have been published yet.</h3>
              <p>The public ledger stays empty until records meet the publication and source requirements. Candidate allegations are never shown here.</p>
              <div className="empty-state__links"><a href="/docs/source-policy.html">Read the source policy</a><a href="/docs/reporting-format.html">Review the reporting format</a></div>
            </div>
          ) : shown.length === 0 ? (
            <div className="empty-state"><p className="empty-state__code">NO MATCHES</p><h3>No incident files match these filters.</h3><p>Clear or change the query to search the complete public record.</p></div>
          ) : (
            <div className="incident-list">{shown.map((incident) => <IncidentCard incident={incident} key={incident.id} />)}</div>
          )}
        </section>
      </main>

    </PublicShell>
  );
}
