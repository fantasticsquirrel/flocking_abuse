import type { Incident } from './incidentSchema.js';

export const incidentCategories = {
  'system-abuse': { label: 'System abuse', color: '#72ff9d' },
  'security-breach': { label: 'Security breach', color: '#ff5d73' },
  'political-abuse': { label: 'Political abuse', color: '#c58cff' },
  'policy-abuse': { label: 'Policy abuse', color: '#ffbd59' },
  'institutional-overreach': { label: 'Institutional overreach', color: '#59c7ff' },
} as const;

export type IncidentCategory = keyof typeof incidentCategories;

export function categoryForIncident(incident: Incident): IncidentCategory {
  const types = new Set(incident.incident_type);
  if (types.has('political-targeting')) return 'political-abuse';
  if (types.has('unauthorized-search')) return 'system-abuse';
  if (types.has('law-enforcement-overreach') && types.has('retention-or-access-policy')) return 'policy-abuse';
  if (types.has('data-sharing')) return 'security-breach';
  if (types.has('retention-or-access-policy') || types.has('vendor-or-contracting')) return 'policy-abuse';
  return 'institutional-overreach';
}
