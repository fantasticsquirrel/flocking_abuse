// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicApplication } from '../src/PublicApplication.js';
import { INCIDENT_REFRESH_INTERVAL_MS } from '../src/lib/incidentRefresh.js';
import incidents from '../src/data/incidents.json';
import type { Incident } from '../src/lib/incidentSchema.js';

const liveIncident = structuredClone((incidents as Incident[])[0]!);
const response = (records: Incident[]) => Promise.resolve({ ok: true, json: () => Promise.resolve({ incidents: records }) });
const incidentCalls = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls.filter(([url]) => url === '/api/incidents');

describe('public incident refresh', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('replaces bundled fallback data after a successful live refresh', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(response([liveIncident])));
    render(<PublicApplication />);
    expect(await screen.findByLabelText('Published incident count')).toHaveTextContent('001');
  });

  it('retries after a transient failure', async () => {
    vi.useFakeTimers();
    let incidentAttempt = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url !== '/api/incidents') return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      incidentAttempt += 1;
      return incidentAttempt === 1 ? Promise.reject(new Error('offline')) : response([liveIncident]);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<PublicApplication />);
    await act(async () => { await Promise.resolve(); });
    expect(incidentCalls(fetchMock)).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(incidentCalls(fetchMock)).toHaveLength(2);
    expect(screen.getByLabelText('Published incident count')).toHaveTextContent('001');
  });

  it('refreshes on focus and when a tab becomes visible', async () => {
    const fetchMock = vi.fn().mockReturnValue(response([liveIncident]));
    vi.stubGlobal('fetch', fetchMock);
    render(<PublicApplication />);
    await waitFor(() => expect(incidentCalls(fetchMock)).toHaveLength(1));
    await act(async () => { window.dispatchEvent(new Event('focus')); await Promise.resolve(); });
    await waitFor(() => expect(incidentCalls(fetchMock)).toHaveLength(2));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(incidentCalls(fetchMock)).toHaveLength(2);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); });
    await waitFor(() => expect(incidentCalls(fetchMock)).toHaveLength(3));
  });

  it('refreshes periodically', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockReturnValue(response([liveIncident]));
    vi.stubGlobal('fetch', fetchMock);
    render(<PublicApplication />);
    await act(async () => { await Promise.resolve(); });
    expect(incidentCalls(fetchMock)).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(INCIDENT_REFRESH_INTERVAL_MS); });
    expect(incidentCalls(fetchMock)).toHaveLength(2);
  });

  it('prevents overlapping requests and aborts work on unmount', async () => {
    vi.useFakeTimers();
    let resolveRequest!: (value: Awaited<ReturnType<typeof response>>) => void;
    const pending = new Promise<Awaited<ReturnType<typeof response>>>((resolve) => { resolveRequest = resolve; });
    const fetchMock = vi.fn((url: string) => url === '/api/incidents'
      ? pending
      : Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<PublicApplication />);
    await act(async () => { await Promise.resolve(); });
    const signal = incidentCalls(fetchMock)[0]![1].signal as AbortSignal;
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(INCIDENT_REFRESH_INTERVAL_MS);
    expect(incidentCalls(fetchMock)).toHaveLength(1);
    view.unmount();
    expect(signal.aborted).toBe(true);
    resolveRequest(await response([liveIncident]));
    await act(async () => { await Promise.resolve(); });
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(INCIDENT_REFRESH_INTERVAL_MS);
    expect(incidentCalls(fetchMock)).toHaveLength(1);
  });
});
