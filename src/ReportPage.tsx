import { IncidentCard } from './components/IncidentCard.js';
import { PublicShell } from './components/SiteChrome.js';
import type { Incident } from './lib/incidentSchema.js';

export function ReportPage({ incident }: { incident?: Incident }) {
  if (!incident) return <PublicShell current="incidents" skip="Skip to report"><main id="main-content" tabIndex={-1} className="content-page report-page"><p className="eyebrow">Record not found</p><h1>Report unavailable</h1><p className="page-lede">That report does not exist or is not public.</p><p><a href="/timeline">Return to the timeline</a></p></main></PublicShell>;

  return <PublicShell current="incidents" skip="Skip to report"><main id="main-content" tabIndex={-1} className="content-page report-page">
    <h1 className="sr-only">{incident.title}</h1>
    <p className="report-page__back"><a href="/timeline">← Back to timeline</a></p>
    <IncidentCard incident={incident} />
  </main></PublicShell>;
}
