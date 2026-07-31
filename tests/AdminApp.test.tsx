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
  it('focuses intake after login, uses touch-friendly incident checkboxes, and sets an admin title', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ authenticated: false }))
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, csrfToken: 'csrf-token' }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AdminApp />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Admin password'), 'password');
    await user.click(screen.getByRole('button', { name: 'Authenticate' }));
    const heading = await screen.findByRole('heading', { name: 'Candidate intake' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(document.title).toBe('Admin intake — Flocking Abuse Tracker');
    expect(screen.getAllByRole('checkbox', { name: /unauthorized search|political targeting|law enforcement overreach|data sharing/i }).length).toBeGreaterThan(0);
  });

  it('recovers from an expired session and announces network failures', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Authentication required' }, 401));
    vi.stubGlobal('fetch', fetchMock);
    render(<AdminApp />);
    const form = await screen.findByRole('heading', { name: 'Candidate intake' });
    expect(form).toBeInTheDocument();
    const saveButton = screen.getByRole('button', { name: 'Save candidate for review' });
    fireEvent.submit(saveButton.closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(/session expired/i);
    expect(await screen.findByLabelText('Admin password')).toHaveFocus();
  });
});
