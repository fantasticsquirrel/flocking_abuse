import { useEffect, useState } from 'react';
import { AboutPage } from './AboutPage.js';
import { App } from './App.js';
import incidents from './data/incidents.json';
import unverified from './data/unverified.json';
import { IncidentSchema, type Incident } from './lib/incidentSchema.js';
import type { UnverifiedReport } from './lib/unverifiedSchema.js';
import { ReportPage } from './ReportPage.js';
import { SourcePolicyPage } from './SourcePolicyPage.js';
import { TimelinePage } from './TimelinePage.js';
import { UnverifiedPage } from './UnverifiedPage.js';

export function PublicApplication() {
  const [liveIncidents, setLiveIncidents] = useState<Incident[]>(incidents as Incident[]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/incidents', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<{ incidents?: unknown }> : Promise.reject(new Error('incident request failed')))
      .then((payload) => {
        const parsed = IncidentSchema.array().safeParse(payload.incidents);
        if (parsed.success) setLiveIncidents(parsed.data);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  const reportId = path.startsWith('/reports/') ? decodeURIComponent(path.slice('/reports/'.length)) : '';
  const report = reportId ? liveIncidents.find((incident) => incident.id === reportId) : undefined;
  return path === '/about' ? <AboutPage />
    : path === '/reported-unverified' ? <UnverifiedPage reports={unverified as UnverifiedReport[]} />
    : path === '/timeline' ? <TimelinePage incidents={liveIncidents} />
    : path === '/docs/source-policy.html' ? <SourcePolicyPage />
    : reportId ? <ReportPage incident={report} />
    : <App incidents={liveIncidents} />;
}
