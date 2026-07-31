import { useEffect, useRef, useState, type FormEvent } from 'react';
import { IncidentTypeSchema, SourceReliabilitySchema, SourceTypeSchema } from '../lib/incidentSchema.js';

interface SessionResponse { authenticated: boolean; csrfToken?: string }
interface ApiIssue { path: Array<string | number>; message: string }
interface DuplicateWarning { incidentId: string; score: number; reasons: string[] }
interface ApiPayload { filename?: string; error?: string; issues?: ApiIssue[]; duplicateWarnings?: DuplicateWarning[] }
type PendingOperation = '' | 'login' | 'save' | 'logout';

const incidentTypes = IncidentTypeSchema.options;
const sourceTypes = SourceTypeSchema.options;
const reliabilities = SourceReliabilitySchema.options;
const directPrimarySourceTypes = new Set(['court-record', 'government-record', 'public-record', 'official-statement']);
const humanize = (value: string): string => value.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toLocaleUpperCase('en-US'));
const fieldId = (name: string) => `field-${name.replace(/\./g, '-')}`;
const errorId = (name: string) => `${fieldId(name)}-error`;

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
  const [sourceType, setSourceType] = useState('news');
  const [reliability, setReliability] = useState('corroborating');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
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
      const payload = await readJson<SessionResponse & ApiPayload>(response);
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

  const applyIssues = (issues: ApiIssue[]) => {
    const next: Record<string, string[]> = {};
    for (const issue of issues) {
      const key = issue.path.filter((segment): segment is string => typeof segment === 'string').join('.');
      next[key] = [...(next[key] ?? []), issue.message];
    }
    setFieldErrors(next);
    const first = Object.keys(next)[0];
    if (first) requestAnimationFrame(() => document.getElementById(fieldId(first))?.focus());
  };

  const saveCandidate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setError('');
    setNotice('');
    setFieldErrors({});
    setPending('save');
    const data = new FormData(form);
    const selectedIncidentTypes = data.getAll('incidentTypes').map(String);
    if (selectedIncidentTypes.length === 0) {
      setPending('');
      setError('Choose at least one incident type before saving.');
      setFieldErrors({ incidentTypes: ['Choose at least one incident type.'] });
      requestAnimationFrame(() => document.getElementById(fieldId('incidentTypes'))?.focus());
      return;
    }
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
          eventKey: String(data.get('eventKey') ?? ''), occurredDate: String(data.get('occurredDate') ?? ''),
          incidentTypes: selectedIncidentTypes,
          keyClaims: String(data.get('keyClaims') ?? '').split('\n').map((claim) => claim.trim()).filter(Boolean),
          notes: String(data.get('notes') ?? ''),
        }),
      });
      const payload = await readJson<ApiPayload>(response);
      if (response.status === 401) { expireSession(); return; }
      if (!response.ok) {
        const issues = payload.issues ?? [];
        if (issues.length > 0) applyIssues(issues);
        setError([payload.error ?? 'Candidate could not be saved', ...issues.map((issue) => issue.message)].join(': '));
        return;
      }
      const warnings = payload.duplicateWarnings ?? [];
      const warningText = warnings.length > 0
        ? ` Probable duplicate warning: ${warnings.map((warning) => `${warning.incidentId} (${Math.round(warning.score * 100)}%: ${warning.reasons.join(', ')})`).join('; ')}. Review before promotion.`
        : '';
      setNotice(`Candidate saved for review: ${payload.filename ?? 'candidate YAML'}.${warningText}`);
      form.reset();
      setSourceType('news');
      setReliability('corroborating');
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
      if (response.ok) { setCsrfToken(''); setSessionExpired(false); setNotice(''); setError(''); setFieldErrors({}); }
      else setError('Logout failed');
    } catch {
      setError('Unable to reach the admin service to end the session.');
    } finally {
      setPending('');
    }
  };

  const fieldProps = (name: string) => ({
    id: fieldId(name),
    'aria-invalid': fieldErrors[name] ? true as const : undefined,
    'aria-describedby': fieldErrors[name] ? errorId(name) : undefined,
  });
  const fieldError = (name: string) => fieldErrors[name]
    ? <small className="field-error" id={errorId(name)}>{fieldErrors[name].join(' ')}</small>
    : null;
  const formLocked = pending !== '' || sessionExpired;
  const primaryAllowed = directPrimarySourceTypes.has(sourceType);

  return (
    <div className="app-shell admin-shell">
      <a className="skip-link" href="#main-content">Skip to admin intake</a>
      <div className="scanlines" aria-hidden="true" />
      <header className="site-header"><a className="wordmark" href="/"><span aria-hidden="true" className="record-dot" />FAT // RESTRICTED</a><nav aria-label="Primary"><a href="/">Public ledger</a><a href="/docs/manual-admin.html">Admin manual</a></nav></header>
      <main id="main-content" tabIndex={-1} className="admin-main" aria-busy={pending !== ''}>
        <section className="admin-intro">
          <p className="classification">CLASSIFICATION // RESTRICTED INTAKE</p>
          <h1>Restricted intake</h1>
          <p>Candidate reports are stored outside the public dataset and require human review before publication.</p>
        </section>
        {error ? <p className="message message--error" role="alert">{error}</p> : null}
        {notice ? <p className="message message--success" role="status">{notice}</p> : null}
        {pending ? <p className="sr-only" aria-live="polite">{pending === 'login' ? 'Authenticating' : pending === 'save' ? 'Saving candidate' : 'Ending session'}</p> : null}
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
                <fieldset disabled={formLocked}><legend>Source record</legend><div className="form-grid">
                  <label className="wide"><span>Source URL</span><input {...fieldProps('url')} name="url" type="url" required maxLength={2048} />{fieldError('url')}</label>
                  <label className="wide"><span>Archive URL <small>optional</small></span><input {...fieldProps('archiveUrl')} name="archiveUrl" type="url" maxLength={2048} />{fieldError('archiveUrl')}</label>
                  <label><span>Publisher</span><input {...fieldProps('publisher')} name="publisher" required maxLength={200} />{fieldError('publisher')}</label>
                  <label><span>Source title</span><input {...fieldProps('title')} name="title" required minLength={4} maxLength={240} />{fieldError('title')}</label>
                  <label><span>Publication date <small>optional if unavailable</small></span><input {...fieldProps('publishedDate')} name="publishedDate" type="date" />{fieldError('publishedDate')}</label>
                  <label><span>Source type</span><select {...fieldProps('sourceType')} name="sourceType" value={sourceType} onChange={(event) => { const next = event.target.value; setSourceType(next); if (!directPrimarySourceTypes.has(next) && reliability === 'primary') setReliability('corroborating'); }}>{sourceTypes.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select>{fieldError('sourceType')}</label>
                  <label><span>Source reliability</span><select {...fieldProps('reliability')} name="reliability" value={reliability} onChange={(event) => setReliability(event.target.value)}>{reliabilities.map((value) => <option disabled={value === 'primary' && !primaryAllowed} key={value} value={value}>{humanize(value)}</option>)}</select>{fieldError('reliability')}</label>
                </div></fieldset>
                <fieldset disabled={formLocked}><legend>Incident claim</legend><div className="form-grid">
                  <label><span>City</span><input {...fieldProps('location.city')} name="city" maxLength={120} />{fieldError('location.city')}</label><label><span>County</span><input {...fieldProps('location.county')} name="county" maxLength={120} />{fieldError('location.county')}</label>
                  <label><span>State</span><input {...fieldProps('location.state')} name="state" maxLength={80} />{fieldError('location.state')}</label><label><span>Country</span><input {...fieldProps('location.country')} name="country" defaultValue="US" required minLength={2} maxLength={80} />{fieldError('location.country')}</label>
                  <label className="wide"><span>Agency or entity</span><input {...fieldProps('agency')} name="agency" required maxLength={200} />{fieldError('agency')}</label>
                  <label><span>Occurrence date <small>optional when unknown</small></span><input {...fieldProps('occurredDate')} name="occurredDate" type="text" inputMode="numeric" pattern="[0-9]{4}-[0-9]{2}(-[0-9]{2})?" placeholder="YYYY-MM or YYYY-MM-DD" />{fieldError('occurredDate')}</label>
                  <label><span>Distinct event key</span><input {...fieldProps('eventKey')} name="eventKey" required minLength={4} maxLength={160} /><small>Stable factual label for the event, not the article title.</small>{fieldError('eventKey')}</label>
                  <fieldset {...fieldProps('incidentTypes')} tabIndex={-1} className="wide classification-options"><legend>Incident types</legend><p>Select every classification that applies.</p><div>{incidentTypes.map((value) => <label key={value}><input name="incidentTypes" type="checkbox" value={value} /><span>{humanize(value)}</span></label>)}</div>{fieldError('incidentTypes')}</fieldset>
                  <label className="wide"><span>Neutral summary</span><textarea {...fieldProps('summary')} name="summary" minLength={20} maxLength={3000} required rows={5} />{fieldError('summary')}</label>
                  <label className="wide"><span>Key claims</span><textarea {...fieldProps('keyClaims')} name="keyClaims" maxLength={20019} required rows={4} /><small>One source-supported claim per line; maximum 20 claims and 1,000 characters each.</small>{fieldError('keyClaims')}</label>
                  <label className="wide"><span>Reviewer notes</span><textarea {...fieldProps('notes')} name="notes" maxLength={5000} rows={4} />{fieldError('notes')}</label>
                </div></fieldset>
                <button disabled={formLocked} className="button button--primary" type="submit">{pending === 'save' ? 'Saving candidate…' : 'Save candidate for review'}</button>
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
