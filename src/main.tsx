import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminApp } from './admin/AdminApp.js';
import './styles.css';
import { PublicApplication } from './PublicApplication.js';

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing');
const path = window.location.pathname.replace(/\/$/, '') || '/';
const application = path === '/admin' || path.startsWith('/admin/') ? <AdminApp /> : <PublicApplication />;
createRoot(root).render(<StrictMode>{application}</StrictMode>);
