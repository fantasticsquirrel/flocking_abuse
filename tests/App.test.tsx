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
    expect(screen.getByRole('link', { name: /read the source policy/i })).toHaveAttribute('href', '/docs/source-policy.html');
    expect(screen.queryByText(/synthetic fixture/i)).not.toBeInTheDocument();
  });

  it('renders evidence-rich incident details without hiding claims in raw markup', () => {
    render(<App incidents={[fixture()]} />);
    const article = screen.getByRole('article', { name: /synthetic fixture: audit report/i });
    expect(within(article).getByText(/Exampleville, Example County, EX/i)).toBeInTheDocument();
    expect(within(article).getByText('2026-06')).toBeInTheDocument();
    expect(within(article).getByText('2026-07-01')).toBeInTheDocument();
    expect(within(article).getByText('Flock Safety')).toBeInTheDocument();
    expect(within(article).getByText('Synthetic Policy 1')).toBeInTheDocument();
    expect(within(article).getByText('Retention Or Access Policy')).toBeInTheDocument();
    expect(within(article).getByText('Synthetic corrective action')).toBeInTheDocument();
    expect(within(article).getByText(/Synthetic claim used only to test validation/i)).toBeInTheDocument();
    const sourceLink = within(article).getByRole('link', { name: /Synthetic Official Audit — Example Inspector General/i });
    expect(sourceLink).toHaveAccessibleName(/opens in a new tab/i);
    expect(sourceLink).toHaveAttribute('target', '_blank');
    expect(sourceLink).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(sourceLink).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });

  it('shows unknown reported dates without adding an empty year filter', () => {
    const incident = fixture();
    incident.dates.reported = '';
    render(<App incidents={[incident]} />);
    const article = screen.getByRole('article', { name: /synthetic fixture: audit report/i });
    expect(within(article).getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByLabelText('Year')).not.toContainHTML('<option value="">Unknown</option>');
  });

  it('hides retractions by default but keeps them available through the status filter', async () => {
    const retracted = fixture();
    retracted.status = 'retracted';
    render(<App incidents={[retracted]} />);
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'retracted');
    expect(screen.getByRole('article', { name: /synthetic fixture/i })).toBeInTheDocument();
  });

  it('filters by full text and facets while reflecting state in URL query params', async () => {
    const first = fixture();
    const second = structuredClone(first);
    second.id = '2025-01-other-record';
    second.title = 'Different contracting challenge';
    second.location.state = 'ZZ';
    second.incident_type = ['vendor-or-contracting'];
    second.actors.vendor_entities = ['Axon', 'Motorola Solutions'];
    second.status = 'disputed';
    second.sources[0]!.publisher = 'Other Publisher';
    second.sources[0]!.source_type = 'court-record';
    second.dates.reported = '2025-01-03';
    render(<App incidents={[first, second]} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: /search incidents/i }), 'Example Inspector');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('1 incident shown');
    expect(new URLSearchParams(window.location.search).get('q')).toBe('Example Inspector');
    await user.clear(screen.getByRole('searchbox', { name: /search incidents/i }));
    await user.selectOptions(screen.getByLabelText('State'), 'ZZ');
    await user.selectOptions(screen.getByLabelText('Status'), 'disputed');
    await user.selectOptions(screen.getByLabelText('Year'), '2025');
    await user.selectOptions(screen.getByLabelText('Source type'), 'court-record');
    await user.selectOptions(screen.getByLabelText('Incident type'), 'vendor-or-contracting');
    await user.selectOptions(screen.getByLabelText('Company'), 'Axon');
    expect(screen.getByRole('heading', { name: 'Different contracting challenge' })).toBeInTheDocument();
    expect(window.location.search).toContain('state=ZZ');
    expect(new URLSearchParams(window.location.search).get('company')).toBe('Axon');
  });

  it('derives sorted company options, filters multi-vendor reports, and clears the company filter', async () => {
    const flock = fixture();
    const multiVendor = structuredClone(flock);
    multiVendor.id = '2025-01-multi-vendor-record';
    multiVendor.title = 'Multi-vendor camera report';
    multiVendor.actors.vendor_entities = ['Motorola Solutions', 'Axon'];
    render(<App incidents={[flock, multiVendor]} />);
    const user = userEvent.setup();
    const company = screen.getByLabelText('Company');

    expect(within(company).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'All companies', 'Axon', 'Flock Safety', 'Motorola Solutions',
    ]);
    await user.selectOptions(company, 'Motorola Solutions');
    expect(screen.getByRole('heading', { name: 'Multi-vendor camera report' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /synthetic fixture/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(company).toHaveValue('');
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(window.location.search).toBe('');
  });

  it('restores the company and incident type filters from URL query parameters', () => {
    window.history.replaceState({}, '', '/?company=Flock+Safety&type=retention-or-access-policy');
    render(<App incidents={[fixture()]} />);
    expect(screen.getByLabelText('Company')).toHaveValue('Flock Safety');
    expect(screen.getByLabelText('Incident type')).toHaveValue('retention-or-access-policy');
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it('searches accountability fields such as agencies and policy context', async () => {
    render(<App incidents={[fixture()]} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: /search incidents/i }), 'Example Police Department');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    await user.clear(screen.getByRole('searchbox', { name: /search incidents/i }));
    await user.type(screen.getByRole('searchbox', { name: /search incidents/i }), 'Synthetic Policy 1');
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });
});
