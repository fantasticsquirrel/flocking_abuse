// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import yaml from 'js-yaml';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.js';
import type { Incident } from '../src/lib/incidentSchema.js';

const fixture = (): Incident => yaml.load(readFileSync(resolve('tests/fixtures/validIncident.yaml'), 'utf8')) as Incident;

beforeEach(() => window.history.replaceState({}, '', '/'));

describe('public tracker', () => {
  it('shows a truthful evidence-focused empty state and methodology links', () => {
    render(<App incidents={[]} />);
    expect(screen.getByRole('heading', { name: 'Flocking Abuse Tracker', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/no verified or disputed incidents have been published/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /read the source policy/i })).toHaveAttribute('href', '/docs/source-policy.md');
    expect(screen.queryByText(/synthetic fixture/i)).not.toBeInTheDocument();
  });

  it('renders evidence-rich incident details without hiding claims in raw markup', () => {
    render(<App incidents={[fixture()]} />);
    const article = screen.getByRole('article', { name: /synthetic fixture: audit report/i });
    expect(within(article).getByText(/Exampleville, Example County, EX/i)).toBeInTheDocument();
    expect(within(article).getByText('retention-or-access-policy')).toBeInTheDocument();
    expect(within(article).getByText('Synthetic corrective action')).toBeInTheDocument();
    expect(within(article).getByText(/Synthetic claim used only to test validation/i)).toBeInTheDocument();
    const sourceLink = within(article).getByRole('link', { name: /Synthetic Official Audit — Example Inspector General/i });
    expect(sourceLink).toHaveAttribute('target', '_blank');
    expect(sourceLink).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(sourceLink).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });

  it('filters by full text and facets while reflecting state in URL query params', async () => {
    const first = fixture();
    const second = structuredClone(first);
    second.id = '2025-01-other-record';
    second.title = 'Different contracting challenge';
    second.location.state = 'ZZ';
    second.incident_type = ['vendor-or-contracting'];
    second.status = 'disputed';
    second.sources[0]!.publisher = 'Other Publisher';
    second.sources[0]!.source_type = 'court-record';
    second.dates.reported = '2025-01-03';
    render(<App incidents={[first, second]} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: /search incidents/i }), 'Example Inspector');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(new URLSearchParams(window.location.search).get('q')).toBe('Example Inspector');
    await user.clear(screen.getByRole('searchbox', { name: /search incidents/i }));
    await user.selectOptions(screen.getByLabelText('State'), 'ZZ');
    await user.selectOptions(screen.getByLabelText('Status'), 'disputed');
    await user.selectOptions(screen.getByLabelText('Year'), '2025');
    await user.selectOptions(screen.getByLabelText('Source type'), 'court-record');
    await user.selectOptions(screen.getByLabelText('Incident type'), 'vendor-or-contracting');
    expect(screen.getByRole('heading', { name: 'Different contracting challenge' })).toBeInTheDocument();
    expect(window.location.search).toContain('state=ZZ');
  });
});
