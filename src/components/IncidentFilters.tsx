import type { IncidentStatus, IncidentType, SourceType } from '../lib/incidentSchema.js';

export interface FilterState {
  q: string;
  state: string;
  incidentType: string;
  status: string;
  year: string;
  sourceType: string;
}

interface IncidentFiltersProps {
  filters: FilterState;
  states: string[];
  years: string[];
  onChange: (next: FilterState) => void;
}

const statuses: IncidentStatus[] = ['verified', 'disputed', 'retracted'];
const incidentTypes: IncidentType[] = [
  'unauthorized-search', 'political-targeting', 'law-enforcement-overreach', 'data-sharing',
  'retention-or-access-policy', 'vendor-or-contracting', 'other',
];
const sourceTypes: SourceType[] = [
  'news', 'court-record', 'government-record', 'advocacy-report', 'public-record',
  'official-statement', 'other',
];

export function IncidentFilters({ filters, states, years, onChange }: IncidentFiltersProps) {
  const set = (key: keyof FilterState, value: string) => onChange({ ...filters, [key]: value });
  return (
    <section className="filters" aria-labelledby="filter-heading">
      <div className="filters__heading">
        <div>
          <p className="classification">QUERY CONSOLE // PUBLIC INDEX</p>
          <h2 id="filter-heading">Search the record</h2>
        </div>
        <button className="button button--quiet" type="button" onClick={() => onChange({ q: '', state: '', incidentType: '', status: '', year: '', sourceType: '' })}>
          Clear filters
        </button>
      </div>
      <div className="filter-grid">
        <label className="filter-grid__search">
          <span>Search incidents</span>
          <input aria-label="Search incidents" type="search" value={filters.q} onChange={(event) => set('q', event.target.value)} placeholder="Title, place, publisher…" />
        </label>
        <label><span>State</span><select aria-label="State" value={filters.state} onChange={(event) => set('state', event.target.value)}><option value="">All states</option>{states.map((state) => <option key={state}>{state}</option>)}</select></label>
        <label><span>Incident type</span><select aria-label="Incident type" value={filters.incidentType} onChange={(event) => set('incidentType', event.target.value)}><option value="">All types</option>{incidentTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
        <label><span>Status</span><select aria-label="Status" value={filters.status} onChange={(event) => set('status', event.target.value)}><option value="">Public statuses</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
        <label><span>Year</span><select aria-label="Year" value={filters.year} onChange={(event) => set('year', event.target.value)}><option value="">All years</option>{years.map((year) => <option key={year}>{year}</option>)}</select></label>
        <label><span>Source type</span><select aria-label="Source type" value={filters.sourceType} onChange={(event) => set('sourceType', event.target.value)}><option value="">All source types</option>{sourceTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
      </div>
    </section>
  );
}
