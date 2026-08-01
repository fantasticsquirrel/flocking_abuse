import type { CSSProperties } from 'react';
import { PublicShell } from './components/SiteChrome.js';
import type { Incident } from './lib/incidentSchema.js';

const timelineDate = (incident: Incident): string => incident.dates.occurred || incident.dates.discovered || incident.dates.reported || incident.updated_at;
const monthIndex = (value: string): number => {
  const [year = '0', month = '1'] = value.split('-');
  return Number(year) * 12 + Number(month) - 1;
};

export const timelineGapRem = (elapsedMonths: number): number =>
  Math.min(Math.max(elapsedMonths - 1, 0) * 1.5, 12);

const timelineLabel = (incident: Incident): string => {
  const place = incident.location.city || incident.location.county || incident.location.state || 'Report';
  return place.trim().split(/\s+/).slice(0, 3).join(' ');
};

export function TimelinePage({ incidents }: { incidents: Incident[] }) {
  const entries = [...incidents
    .filter((incident) => ['verified', 'disputed', 'retracted'].includes(incident.status))]
    .sort((left, right) => timelineDate(left).localeCompare(timelineDate(right)) || left.id.localeCompare(right.id));

  return <PublicShell current="timeline" skip="Skip to report timeline"><main id="main-content" tabIndex={-1} className="content-page timeline-page">
    <p className="eyebrow">Chronological record</p>
    <h1>Report timeline</h1>
    <p className="page-lede">Every documented report, ordered by when the underlying event occurred. Select a location bubble to jump directly to the full report.</p>
    <ol className="report-timeline" aria-label={`${entries.length} documented reports in chronological order`}>
      {entries.map((incident, index) => {
        const date = timelineDate(incident);
        const previousDate = timelineDate(entries[index - 1] ?? incident);
        const elapsedMonths = Math.max(0, monthIndex(date) - monthIndex(previousDate));
        const extraGapRem = timelineGapRem(elapsedMonths);
        const spacing = { '--timeline-gap': `${extraGapRem}rem` } as CSSProperties;
        return <li className="report-timeline__item" key={incident.id} style={spacing} data-elapsed-months={elapsedMonths}>
          <time dateTime={date}>{date}</time>
          <span className="report-timeline__dot" aria-hidden="true" />
          <a className="report-timeline__bubble" href={`/reports/${incident.id}`} aria-label={`${timelineLabel(incident)}: ${incident.title}`}>
            {timelineLabel(incident)}
          </a>
        </li>;
      })}
    </ol>
  </main></PublicShell>;
}
