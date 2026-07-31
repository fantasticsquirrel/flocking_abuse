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

const humanize = (value: string): string => value.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toLocaleUpperCase('en-US'));

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
        <div><dt>Occurred</dt><dd>{incident.dates.occurred || 'Unknown'}</dd></div>
        <div><dt>Discovered</dt><dd>{incident.dates.discovered}</dd></div>
        <div><dt>Reported</dt><dd>{incident.dates.reported || 'Unknown'}</dd></div>
        <div><dt>Updated</dt><dd>{incident.updated_at}</dd></div>
        <div><dt>Location</dt><dd>{formatLocation(incident)}</dd></div>
        <div><dt>Agency / entity</dt><dd>{incident.actors.agencies.join(', ') || 'Not identified'}</dd></div>
      </dl>

      <p className="incident-summary">{incident.summary}</p>

      <section aria-labelledby={`types-${incident.id}`}>
        <h3 id={`types-${incident.id}`}>Incident classification</h3>
        <ul className="tag-list">{incident.incident_type.map((type) => <li key={type}>{humanize(type)}</li>)}</ul>
      </section>

      <section aria-labelledby={`accountability-${incident.id}`}>
        <h3 id={`accountability-${incident.id}`}>Accountability context</h3>
        <dl className="accountability-meta">
          <div><dt>Officials or entities</dt><dd>{incident.actors.officials_or_entities.join(', ') || 'Not identified'}</dd></div>
          <div><dt>Technology vendors</dt><dd>{incident.actors.vendor_entities.join(', ') || 'Not identified'}</dd></div>
          <div><dt>Cases</dt><dd>{incident.legal_or_policy_context.case_numbers.join(', ') || 'None cited'}</dd></div>
          <div><dt>Policies or statutes</dt><dd>{incident.legal_or_policy_context.statutes_or_policies.join(', ') || 'None cited'}</dd></div>
        </dl>
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
              {source.title} — {source.publisher} <span aria-hidden="true">↗</span> <span className="sr-only">(opens in a new tab)</span>
            </a>
            <p className="source-record__meta">{source.published_date || 'Publication date unknown'} // {humanize(source.source_type)} // {humanize(source.reliability)}</p>
            <ul>{source.key_claims.map((claim) => <li key={claim}>{claim}</li>)}</ul>
            {source.archive_url ? (
              <a className="archive-link" href={source.archive_url} target="_blank" rel="noopener noreferrer">
                Archived copy <span aria-hidden="true">↗</span> <span className="sr-only">of {source.title} (opens in a new tab)</span>
              </a>
            ) : null}
          </div>
        ))}
      </section>
    </article>
  );
}
