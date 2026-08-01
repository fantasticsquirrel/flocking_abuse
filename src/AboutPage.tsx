import { PublicShell } from './components/SiteChrome.js';

export function AboutPage() {
  return <PublicShell current="about" skip="Skip to About"><main id="main-content" tabIndex={-1} className="content-page">
    <p className="eyebrow">Why this exists</p><h1>About the tracker</h1>
    <section><h2>Camera accountability, with receipts</h2><p>Flocking Abuse Tracker documents reported misuse, overreach, policy failures, legal challenges, and accountability involving automated license-plate readers and related camera systems. The project began with Flock Safety, but coverage includes any company whose technology is materially involved, including systems from Axon and other vendors.</p></section>
    <section><h2>Two evidence lanes</h2><p><strong>Documented incidents</strong> meet the publication standard: a primary record or sufficiently independent reliable reporting, human review, and source links. <strong>Reported but unverified</strong> entries are credible leads that do not yet clear that bar. Each one says exactly what evidence is missing. They are never silently mixed into the documented count.</p></section>
    <section><h2>What a listing means</h2><p>A company being named means its technology was reportedly involved; it does not mean the company directed or endorsed the conduct. Claims remain attributed to their sources, allegations remain allegations, and outcomes are updated when reliable records become available.</p></section>
    <section><h2>Corrections and submissions</h2><p>Use the source and reporting guidance linked throughout the site when submitting a lead or correction. Strong documentation beats a dramatic claim every time.</p><p><a href="/docs/reporting-format.html">Reporting format</a> · <a href="/docs/source-policy.html">Source policy</a></p></section>
    <section><h2>Visitor privacy</h2><p>The site uses first-party aggregate analytics only. A random, HTTP-only visitor token prevents repeat visits from inflating unique counts. The server stores a keyed hash—not the token—and the public sees only today’s and all-time totals. No advertising pixels, fingerprinting, or third-party analytics are used.</p></section>
  </main></PublicShell>;
}
