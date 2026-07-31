import { useEffect, useRef, useState, type FormEvent } from 'react';
import { IncidentTypeSchema, SourceReliabilitySchema, SourceTypeSchema } from '../lib/incidentSchema.js';

interface SessionResponse { authenticated: boolean; csrfToken?: string }
interface ApiError { error?: string }
type PendingOperation = '' | 'login' | 'save' | 'logout';

const incidentTypes = IncidentTypeSchema.options;
const sourceTypes = SourceTypeSchema.options;
const reliabilities = SourceReliabilitySchema.options;
const humanize = (value: string): string => value.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toLocaleUpperCase('en-US'));

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export function AdminApp() {
  const [loading, setLoading] = useState(true);
  const [csrfToken, setCsrfToken] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<PendingOperation>('');
  const [sessionExpired, setSessionExpired] = useState(false);
  const intakeHeading = useRef<HTMLHeadingElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = 'Admin intake — Flocking Abuse Tracker';
    void fetch('/api/admin/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => readJson<SessionResponse>(response))
      .then((session) => { if (session.authenticated && session.csrfToken) setCsrfToken(session.csrfToken); })
      .catch(() => setError('Unable to check the admin session.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading) return;
    if (sessionExpired || !csrfToken) passwordInput.current?.focus();
    else intakeHeading.current?.focus();
  }, [csrfToken, loading, sessionExpired]);

  const expireSession = () => {
    setSessionExpired(true);
    setNotice('');
    setError('Session expired — authenticate again. Your completed form fields remain available below.');
  };

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError('');
    setPending('login');
    const form = new FormData(formElement);
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: String(form.get('password') ?? '') }),
      });
      const payload = await readJson<SessionResponse & ApiError>(response);
      if (!response.ok || !payload.csrfToken) { setError(payload.error ?? 'Authentication failed'); return; }
      setCsrfToken(payload.csrfToken);
      setSessionExpired(false);
      formElement.reset();
    } catch {
      setError('Unable to reach the admin service. Check the connection and try again.');
    } finally {
      setPending('');
    }
  };

  const saveCandidate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setError('');
    setNotice('');
    setPending('save');
    const data = new FormData(form);
    try {
      const response = await fetch('/api/admin/candidates', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({
          url: String(data.get('url') ?? ''), archiveUrl: String(data.get('archiveUrl') ?? ''),
          publisher: String(data.get('publisher') ?? ''), title: String(data.get('title') ?? ''),
          publishedDate: String(data.get('publishedDate') ?? ''), sourceType: String(data.get('sourceType') ?? ''),
          reliability: String(data.get('reliability') ?? ''),
          location: { city: String(data.get('city') ?? ''), county: String(data.get('county') ?? ''), state: String(data.get('state') ?? ''), country: String(data.get('country') ?? '') },
          agency: String(data.get('agency') ?? ''), summary: String(data.get('summary') ?? ''),
          incidentTypes: data.getAll('incidentTypes').map(String),
          keyClaims: String(data.get('keyClaims') ?? '').split('\n').map((claim) => claim.trim()).filter(Boolean),
          notes: String(data.get('notes') ?? ''),
        }),
      });
      const payload = await readJson<{ filename?: string; error?: string }>(response);
      if (response.status === 401) { expireSession(); return; }
      if (!response.ok) { setError(payload.error ?? 'Candidate could not be saved'); return; }
      setNotice(`Candidate saved for review: ${payload.filename ?? 'candidate YAML'}`);
      form.reset();
    } catch {
      setError('Unable to save the candidate because the service could not be reached. The form has not been cleared.');
    } finally {
      setPending('');
    }
  };

  const logout = async () => {
    setError('');
    setPending('logout');
    try {
      const response = await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrfToken } });
      if (response.status === 401) { expireSession(); return; }
      if (response.ok) { setCsrfToken(''); setSessionExpired(false); setNotice(''); setError(''); }
      else setError('Logout failed');
    } catch {
      setError('Unable to reach the admin service to end the session.');
    } finally {
      setPending('');
    }
  };

  return (
    <div className="app-shell admin-shell">
      <a className="skip-link" href="#main-content">Skip to admin intake</a>
      <div className="scanlines" aria-hidden="true" />
      <header className="site-header"><a className="wordmark" href="/"><span aria-hidden="true" className="record-dot" />FAT // RESTRICTED</a><nav aria-label="Primary"><a href="/">Public ledger</a><a href="/docs/manual-admin.html">Admin manual</a></nav></header>
      <main id="main-content" className="admin-main" aria-busy={pending !== ''}>
        <section className="admin-intro">
          <p className="classification">CLASSIFICATION // RESTRICTED INTAKE</p>
          <h1>Restricted intake</h1>
          <p>Candidate reports are stored outside the public dataset and require human review before publication.</p>
        </section>
        {error ? <p className="message message--error" role="alert">{error}</p> : null}
        {notice ? <p className="message message--success" role="status">{notice}</p> : null}
        {pending ? <p className="sr-only" role="status">{pending === 'login' ? 'Authenticating' : pending === 'save' ? 'Saving candidate' : 'Ending session'}</p> : null}
        {loading ? <p role="status">Checking secure session…</p> : csrfToken ? (
          <>
            {sessionExpired ? (
              <section className="login-panel reauth-panel" aria-labelledby="login-heading">
                <p className="classification">SESSION EXPIRED</p><h2 id="login-heading">Authenticate to continue</h2>
                <form onSubmit={(event) => { void login(event); }}><label><span>Admin password</span><input ref={passwordInput} autoComplete="current-password" name="password" type="password" required /></label><button disabled={pending !== ''} className="button button--primary" type="submit">{pending === 'login' ? 'Authenticating…' : 'Authenticate'}</button></form>
              </section>
            ) : null}
          <section className="admin-panel" aria-labelledby="candidate-heading">
            <div className="admin-panel__heading"><div><p className="classification">MANUAL SOURCE ENTRY</p><h2 ref={intakeHeading} tabIndex={-1} id="candidate-heading">Candidate intake</h2></div><button disabled={pending !== '' || sessionExpired} className="button button--quiet" type="button" onClick={() => { void logout(); }}>End session</button></div>
            <form className="intake-form" onSubmit={(event) => { void saveCandidate(event); }}>
              <fieldset><legend>Source record</legend><div className="form-grid">
                <label className="wide"><span>Source URL</span><input name="url" type="url" required /></label>
                <label className="wide"><span>Archive URL <small>optional</small></span><input name="archiveUrl" type="url" /></label>
                <label><span>Publisher</span><input name="publisher" required /></label>
                <label><span>Source title</span><input name="title" required minLength={4} /></label>
                <label><span>Publication date</span><input name="publishedDate" type="date" required /></label>
                <label><span>Source type</span><select name="sourceType" defaultValue="news">{sourceTypes.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>
                <label><span>Source reliability</span><select name="reliability" defaultValue="corroborating">{reliabilities.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>
              </div></fieldset>
              <fieldset><legend>Incident claim</legend><div className="form-grid">
                <label><span>City</span><input name="city" /></label><label><span>County</span><input name="county" /></label>
                <label><span>State</span><input name="state" /></label><label><span>Country</span><input name="country" defaultValue="US" required /></label>
                <label className="wide"><span>Agency or entity</span><input name="agency" required /></label>
                <fieldset className="wide classification-options"><legend>Incident types</legend><p>Select every classification that applies.</p><div>{incidentTypes.map((value) => <label key={value}><input name="incidentTypes" type="checkbox" value={value} /><span>{humanize(value)}</span></label>)}</div></fieldset>
                <label className="wide"><span>Neutral summary</span><textarea name="summary" minLength={20} required rows={5} /></label>
                <label className="wide"><span>Key claims</span><textarea name="keyClaims" required rows={4} /><small>One source-supported claim per line.</small></label>
                <label className="wide"><span>Reviewer notes</span><textarea name="notes" rows={4} /></label>
              </div></fieldset>
              <button disabled={pending !== '' || sessionExpired} className="button button--primary" type="submit">{pending === 'save' ? 'Saving candidate…' : 'Save candidate for review'}</button>
            </form>
          </section>
          </>
        ) : (
          <section className="login-panel" aria-labelledby="login-heading">
            <p className="classification">PASSWORD-ONLY ACCESS</p><h2 id="login-heading">Authenticate to continue</h2>
            <form onSubmit={(event) => { void login(event); }}><label><span>Admin password</span><input ref={passwordInput} autoComplete="current-password" name="password" type="password" required autoFocus /></label><button disabled={pending !== ''} className="button button--primary" type="submit">{pending === 'login' ? 'Authenticating…' : 'Authenticate'}</button></form>
            <p className="login-panel__note">No username. No signup. Sessions expire after 30 minutes.</p>
          </section>
        )}
      </main>
    </div>
  );
}
