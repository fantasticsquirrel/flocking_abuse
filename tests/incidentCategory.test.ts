import { describe, expect, it } from 'vitest';
import { categoryForIncident, incidentCategories } from '../src/lib/incidentCategory.js';
import type { Incident } from '../src/lib/incidentSchema.js';

const incidentWithTypes = (...incident_type: Incident['incident_type']): Incident => ({ incident_type } as Incident);

describe('incident categories', () => {
  it('classifies unauthorized access as system abuse', () => {
    expect(categoryForIncident(incidentWithTypes('unauthorized-search'))).toBe('system-abuse');
  });

  it('classifies exposed or shared data as a security breach', () => {
    expect(categoryForIncident(incidentWithTypes('data-sharing'))).toBe('security-breach');
  });

  it('assigns every public report to a defined colored category', () => {
    const incidents = Object.keys(incidentCategories).map((category) => {
      if (category === 'security-breach') return incidentWithTypes('data-sharing');
      if (category === 'political-abuse') return incidentWithTypes('political-targeting');
      if (category === 'policy-abuse') return incidentWithTypes('retention-or-access-policy');
      if (category === 'institutional-overreach') return incidentWithTypes('law-enforcement-overreach');
      return incidentWithTypes('unauthorized-search');
    });
    for (const incident of incidents) {
      const category = categoryForIncident(incident);
      expect(incidentCategories[category].color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
