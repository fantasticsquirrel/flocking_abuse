import { describe, expect, it } from 'vitest';
import incidents from '../src/data/incidents.json';
import { categoryForIncident, incidentCategories } from '../src/lib/incidentCategory.js';
import type { Incident } from '../src/lib/incidentSchema.js';

describe('incident categories', () => {
  it('classifies unauthorized access as system abuse', () => {
    const incident = (incidents as Incident[]).find((entry) => entry.incident_type.includes('unauthorized-search'));
    expect(incident).toBeDefined();
    expect(categoryForIncident(incident!)).toBe('system-abuse');
  });

  it('classifies exposed or shared data as a security breach', () => {
    const incident = (incidents as Incident[]).find((entry) => entry.incident_type.includes('data-sharing'));
    expect(incident).toBeDefined();
    expect(categoryForIncident(incident!)).toBe('security-breach');
  });

  it('assigns every public report to a defined colored category', () => {
    for (const incident of incidents as Incident[]) {
      const category = categoryForIncident(incident);
      expect(incidentCategories[category].color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
