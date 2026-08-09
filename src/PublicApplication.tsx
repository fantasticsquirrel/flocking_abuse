import { useEffect, useState } from 'react';
import { AboutPage } from './AboutPage.js';
import { App } from './App.js';
import incidents from './data/incidents.json';
import unverified from './data/unverified.json';
import { IncidentSchema, type Incident } from './lib/incidentSchema.js';
import { INCIDENT_REFRESH_INTERVAL_MS, INCIDENT_RETRY_DELAYS_MS } from './lib/incidentRefresh.js';
import type { UnverifiedReport } from './lib/unverifiedSchema.js';
import { ReportPage } from './ReportPage.js';
import { SourcePolicyPage } from './SourcePolicyPage.js';
import { SummaryPage } from './SummaryPage.js';
import { TimelinePage } from './TimelinePage.js';
import { UnverifiedPage } from './UnverifiedPage.js';

export function PublicApplication() {
  const [liveIncidents, setLiveIncidents] = useState<Incident[]>(incidents as Incident[]);
  useEffect(() => {
    let disposed = false;
    let controller: AbortController | undefined;
    let inFlight: Promise<void> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryAttempt = 0;

    const clearRetry = () => {
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
    };

    const scheduleRetry = () => {
      if (disposed || retryTimer !== undefined) return;
      const delay = INCIDENT_RETRY_DELAYS_MS[Math.min(retryAttempt, INCIDENT_RETRY_DELAYS_MS.length - 1)]
        ?? INCIDENT_RETRY_DELAYS_MS[INCIDENT_RETRY_DELAYS_MS.length - 1];
      retryAttempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void refresh();
      }, delay);
    };

    const refresh = (): Promise<void> => {
      if (disposed) return Promise.resolve();
      if (inFlight) return inFlight;
      clearRetry();
      controller = new AbortController();
      const requestController = controller;
      inFlight = (async () => {
        try {
          const response = await fetch('/api/incidents', { cache: 'no-store', signal: requestController.signal });
          if (!response.ok) throw new Error('incident request failed');
          const payload = await response.json() as { incidents?: unknown };
          const parsed = IncidentSchema.array().safeParse(payload.incidents);
          if (!parsed.success) throw new Error('incident response validation failed');
          if (!disposed) setLiveIncidents(parsed.data);
          retryAttempt = 0;
        } catch (error) {
          if (!disposed && !(error instanceof DOMException && error.name === 'AbortError')) scheduleRetry();
        } finally {
          if (controller === requestController) controller = undefined;
          inFlight = undefined;
        }
      })();
      return inFlight;
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const refreshOnFocus = () => { void refresh(); };
    const interval = setInterval(() => { void refresh(); }, INCIDENT_REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshOnFocus);
    void refresh();

    return () => {
      disposed = true;
      clearRetry();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshOnFocus);
      controller?.abort();
    };
  }, []);
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  const reportId = path.startsWith('/reports/') ? decodeURIComponent(path.slice('/reports/'.length)) : '';
  const report = reportId ? liveIncidents.find((incident) => incident.id === reportId) : undefined;
  return path === '/about' ? <AboutPage />
    : path === '/summary' ? <SummaryPage incidents={liveIncidents} />
    : path === '/reported-unverified' ? <UnverifiedPage reports={unverified as UnverifiedReport[]} />
    : path === '/timeline' ? <TimelinePage incidents={liveIncidents} />
    : path === '/docs/source-policy.html' ? <SourcePolicyPage />
    : reportId ? <ReportPage incident={report} />
    : <App incidents={liveIncidents} />;
}
