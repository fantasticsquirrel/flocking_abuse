import type { Incident } from '../lib/incidentSchema.js';

const formatLocation = (incident: Incident): string => [
  incident.location.city,
  incident.location.county,
  incident.location.state,
  incident.location.country,
].filter(Boolean).join(', ');

interface IncidentCardProps {
  incident: Incident;
}

export function IncidentCard({ incident }: IncidentCardProps) {
  return (
    <article className="incident-card" aria-labelledby={`incident-${incident.id}`}>
      <header className="incident-card__header">
        <div>
          <p className="classification">CASE FILE // {incident.id}</p>
          <h2 id={`incident-${incident.id}`}>{incident.title}</h2>
        </div>
        <span className={`status-badge status-badge--${incident.status}`}>
          <span aria-hidden="true">●</span> {incident.status}
        </span>
      </header>

      <dl className="incident-meta">
        <div><dt>Reported</dt><dd>{incident.dates.reported}</dd></div>
        <div><dt>Location</dt><dd>{formatLocation(incident)}</dd></div>
        <div><dt>Agency / entity</dt><dd>{incident.actors.agencies.join(', ') || 'Not identified'}</dd></div>
      </dl>

      <p className="incident-summary">{incident.summary}</p>

      <section aria-labelledby={`types-${incident.id}`}>
        <h3 id={`types-${incident.id}`}>Incident classification</h3>
        <ul className="tag-list">
          {incident.incident_type.map((type) => <li key={type}>{type}</li>)}
        </ul>
      </section>

      <section aria-labelledby={`outcomes-${incident.id}`}>
        <h3 id={`outcomes-${incident.id}`}>Reported outcomes</h3>
        <ul>{incident.outcomes.map((outcome) => <li key={outcome}>{outcome}</li>)}</ul>
      </section>

      <section className="evidence-panel" aria-labelledby={`sources-${incident.id}`}>
        <h3 id={`sources-${incident.id}`}>Source claims</h3>
        {incident.sources.map((source) => (
          <div className="source-record" key={source.url}>
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              {source.title} — {source.publisher}
            </a>
            <p className="source-record__meta">{source.published_date} // {source.source_type} // {source.reliability}</p>
            <ul>{source.key_claims.map((claim) => <li key={claim}>{claim}</li>)}</ul>
            {source.archive_url ? (
              <a className="archive-link" href={source.archive_url} target="_blank" rel="noopener noreferrer">
                Archived copy <span className="sr-only">of {source.title}</span>
              </a>
            ) : null}
          </div>
        ))}
      </section>
    </article>
  );
}
