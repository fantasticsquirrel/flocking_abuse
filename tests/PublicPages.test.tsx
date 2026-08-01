// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AboutPage } from '../src/AboutPage.js';
import { UnverifiedPage } from '../src/UnverifiedPage.js';
import reports from '../src/data/unverified.json';
import type { UnverifiedReport } from '../src/lib/unverifiedSchema.js';
import { SourcePolicyPage } from '../src/SourcePolicyPage.js';
import { TimelinePage } from '../src/TimelinePage.js';
import incidents from '../src/data/incidents.json';
import type { Incident } from '../src/lib/incidentSchema.js';

afterEach(() => vi.unstubAllGlobals());

describe('public information pages', () => {
  it('explains evidence lanes, multi-company coverage, and visitor privacy', () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<AboutPage />);
    expect(screen.getByRole('heading', { name: /about the tracker/i })).toBeInTheDocument();
    expect(screen.getByText(/began with Flock Safety.*Axon and other vendors/i)).toBeInTheDocument();
    expect(screen.getByText(/random, HTTP-only visitor token/i)).toBeInTheDocument();
  });

  it('keeps an unverified report visibly separate and states its evidence gap and companies', () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<UnverifiedPage reports={reports as UnverifiedReport[]} />);
    const article = screen.getByRole('article');
    expect(within(article).getByText(/Unverified/i)).toBeInTheDocument();
    expect(within(article).getByText('Flock Safety')).toBeInTheDocument();
    expect(within(article).getByRole('heading', { name: /why this is not verified/i })).toBeInTheDocument();
    expect(within(article).getAllByText(/underlying court record/i)).toHaveLength(2);
  });

  it('formats the source policy as a first-class public page', () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<SourcePolicyPage />);
    expect(screen.getByRole('heading', { name: /source policy/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /what “documented” requires/i })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /reported \/ unverified/i })).toEqual(expect.arrayContaining([
      expect.objectContaining({ pathname: '/reported-unverified' }),
    ]));
  });

  it('puts every documented report on a chronological linked timeline', () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const publicIncidents = (incidents as Incident[]).filter((incident) => ['verified', 'disputed', 'retracted'].includes(incident.status));
    render(<TimelinePage incidents={incidents as Incident[]} />);
    const timeline = screen.getByRole('list', { name: new RegExp(`${publicIncidents.length} documented reports`) });
    expect(within(timeline).getAllByRole('listitem')).toHaveLength(publicIncidents.length);
    const links = within(timeline).getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', expect.stringMatching(/^\/#/));
    expect(links.every((link) => (link.textContent?.trim().split(/\s+/).length ?? 0) <= 3)).toBe(true);
  });
});
