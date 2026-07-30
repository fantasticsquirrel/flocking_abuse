import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminApp } from './admin/AdminApp.js';
import { App } from './App.js';
import incidents from './data/incidents.json';
import type { Incident } from './lib/incidentSchema.js';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing');
const application = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/')
  ? <AdminApp />
  : <App incidents={incidents as Incident[]} />;
createRoot(root).render(<StrictMode>{application}</StrictMode>);
