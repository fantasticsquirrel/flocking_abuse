import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminApp } from './admin/AdminApp.js';
import { App } from './App.js';
import incidents from './data/incidents.json';
import type { Incident } from './lib/incidentSchema.js';
import './styles.css';
import { AboutPage } from './AboutPage.js';
import { UnverifiedPage } from './UnverifiedPage.js';
import unverified from './data/unverified.json';
import type { UnverifiedReport } from './lib/unverifiedSchema.js';
import { TimelinePage } from './TimelinePage.js';
import { SourcePolicyPage } from './SourcePolicyPage.js';

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing');
const path = window.location.pathname.replace(/\/$/, '') || '/';
const application = path === '/admin' || path.startsWith('/admin/') ? <AdminApp />
  : path === '/about' ? <AboutPage />
  : path === '/reported-unverified' ? <UnverifiedPage reports={unverified as UnverifiedReport[]} />
  : path === '/timeline' ? <TimelinePage incidents={incidents as Incident[]} />
  : path === '/docs/source-policy.html' ? <SourcePolicyPage />
  : <App incidents={incidents as Incident[]} />;
createRoot(root).render(<StrictMode>{application}</StrictMode>);
