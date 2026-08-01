// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminApp } from '../src/admin/AdminApp.js';

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.title = '';
});

describe('admin intake accessibility and recovery', () => {
  const candidate = {
    schema_version: 1, id: 'candidate-review-test', title: 'Candidate ready for owner review', status: 'candidate', category: 'system-abuse',
    summary: 'A neutral candidate summary with enough detail for the owner to review before publication.', incident_type: ['unauthorized-search'],
    location: { city: 'Example', county: 'Example', state: 'EX', country: 'US' },
    actors: { agencies: ['Example Police'], officials_or_entities: [], vendor_entities: ['Flock Safety'] },
    dates: { occurred: '2026-06', discovered: '2026-07-30', reported: '2026-07-29' },
    sources: [{ url: 'https://example.gov/report', title: 'Official report', publisher: 'Example Agency', published_date: '2026-07-29', source_type: 'government-record', reliability: 'primary', key_claims: ['The report documents the event.'] }],
    legal_or_policy_context: { case_numbers: [], statutes_or_policies: [] }, outcomes: ['Unknown — candidate awaiting review'],
    uniqueness: { canonical_key: 'us-ex-example:2026-06:example-police:review-test', duplicate_of: null },
    review: { added_by: 'manual', approval: 'pending', reviewed_by: '', reviewed_at: '', approval_reference: '', notes: 'Review carefully.' }, updated_at: '2026-07-30',
  };

  it('reviews and publishes a candidate only after exact owner confirmation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse({ candidates: [candidate] }))
      .mockResolvedValueOnce(jsonResponse({ incidentId: candidate.id, status: 'published' }, 201));
    vi.stubGlobal('fetch', fetchMock);
    render(<AdminApp />);
    expect(await screen.findByRole('heading', { name: candidate.title })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: /Reported outcomes/i }), 'Access was revoked.');
    await userEvent.type(screen.getByRole('textbox', { name: /Type PUBLISH/i }), `PUBLISH ${candidate.id}`);
    await userEvent.click(screen.getByRole('button', { name: 'Approve and publish' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/published candidate ready/i);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/admin/publications', expect.objectContaining({ method: 'POST' }));
  });

  it('shows the publisher evidence requirement when publication is rejected', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse({ candidates: [candidate] }))
      .mockResolvedValueOnce(jsonResponse({
        error: 'This candidate cannot be published yet. Add one primary source or sources from two independent secondary publishers.',
      }, 422));
    vi.stubGlobal('fetch', fetchMock);
    render(<AdminApp />);
    expect(await screen.findByRole('heading', { name: candidate.title })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: /Reported outcomes/i }), 'Pending stronger evidence.');
    await userEvent.type(screen.getByRole('textbox', { name: /Type PUBLISH/i }), `PUBLISH ${candidate.id}`);
    await userEvent.click(screen.getByRole('button', { name: 'Approve and publish' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/add one primary source or sources from two independent secondary publishers/i);
  });

  it('focuses intake after login, uses touch-friendly incident checkboxes, and sets an admin title', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ authenticated: false }))
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse({ candidates: [] }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AdminApp />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Admin password'), 'password');
    await user.click(screen.getByRole('button', { name: 'Authenticate' }));
    const heading = await screen.findByRole('heading', { name: 'Candidate intake' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(document.title).toBe('Admin intake — Flocking Abuse Tracker');
    expect(screen.getAllByRole('checkbox', { name: /unauthorized search|political targeting|law enforcement overreach|data sharing/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('option', { name: 'Primary' })).toBeDisabled();
  });

  it('focuses the incident-type group when client validation rejects an empty selection', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse({ candidates: [] })));
    render(<AdminApp />);
    await screen.findByRole('heading', { name: 'Candidate intake' });
    fireEvent.submit(screen.getByRole('button', { name: 'Save candidate for review' }).closest('form')!);
    const group = document.getElementById('field-incidentTypes');
    await waitFor(() => expect(group).toHaveFocus());
    expect(group).toHaveAttribute('aria-invalid', 'true');
  });

  it('announces probable duplicate warnings and maps server validation to the failing field', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse({ candidates: [] }))
      .mockResolvedValueOnce(jsonResponse({ filename: 'candidate.yaml', duplicateWarnings: [{ incidentId: 'existing-record', score: 0.82, reasons: ['same agency'] }] }, 201))
      .mockResolvedValueOnce(jsonResponse({ error: 'Validation failed', issues: [{ path: ['keyClaims', 0], message: 'Claim is too long' }] }, 400));
    vi.stubGlobal('fetch', fetchMock);
    render(<AdminApp />);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Candidate intake' });
    await user.click(screen.getAllByRole('checkbox')[0]!);
    fireEvent.submit(screen.getByRole('button', { name: 'Save candidate for review' }).closest('form')!);
    expect(await screen.findByRole('status')).toHaveTextContent(/probable duplicate.*existing-record.*same agency/i);
    await user.click(screen.getAllByRole('checkbox')[0]!);
    fireEvent.submit(screen.getByRole('button', { name: 'Save candidate for review' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(/claim is too long/i);
    expect(document.getElementById('field-keyClaims')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('link', { name: 'Admin manual' })).not.toHaveAttribute('aria-current');
  });

  it('locks evidence fields while a save snapshot is in flight', async () => {
    let resolveSave: ((response: Response) => void) | undefined;
    const save = new Promise<Response>((resolve) => { resolveSave = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse({ candidates: [] }))
      .mockReturnValueOnce(save);
    vi.stubGlobal('fetch', fetchMock);
    render(<AdminApp />);
    await screen.findByRole('heading', { name: 'Candidate intake' });
    await userEvent.click(screen.getAllByRole('checkbox')[0]!);
    fireEvent.submit(screen.getByRole('button', { name: 'Save candidate for review' }).closest('form')!);
    await waitFor(() => expect(screen.getByRole('textbox', { name: /Publisher/ })).toBeDisabled());
    resolveSave?.(jsonResponse({ filename: 'candidate.yaml', duplicateWarnings: [] }, 201));
    expect(await screen.findByRole('status')).toHaveTextContent(/candidate saved/i);
  });

  it('recovers from an expired session, preserves fields, and announces network failures', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse({ candidates: [] }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Authentication required' }, 401))
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, csrfToken: 'fresh-csrf-token' }))
      .mockResolvedValueOnce(jsonResponse({ candidates: [] }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AdminApp />);
    const form = await screen.findByRole('heading', { name: 'Candidate intake' });
    expect(form).toBeInTheDocument();
    const publisher = screen.getByRole('textbox', { name: /Publisher/ });
    await userEvent.type(publisher, 'Preserved Publisher');
    const saveButton = screen.getByRole('button', { name: 'Save candidate for review' });
    await userEvent.click(screen.getAllByRole('checkbox')[0]!);
    fireEvent.submit(saveButton.closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(/session expired/i);
    const password = await screen.findByLabelText('Admin password');
    expect(password).toHaveFocus();
    await userEvent.type(password, 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Authenticate' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Candidate intake' })).toHaveFocus());
    expect(publisher).toHaveValue('Preserved Publisher');
  });
});
