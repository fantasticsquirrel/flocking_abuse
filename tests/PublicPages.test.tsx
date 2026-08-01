// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AboutPage } from '../src/AboutPage.js';
import { UnverifiedPage } from '../src/UnverifiedPage.js';
import reports from '../src/data/unverified.json';
import type { UnverifiedReport } from '../src/lib/unverifiedSchema.js';

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
});
