import { z } from 'zod';

export const IncidentStatusSchema = z.enum(['candidate', 'draft', 'verified', 'disputed', 'retracted']);
export const IncidentTypeSchema = z.enum([
  'unauthorized-search',
  'political-targeting',
  'law-enforcement-overreach',
  'data-sharing',
  'retention-or-access-policy',
  'vendor-or-contracting',
  'other',
]);
export const SourceTypeSchema = z.enum([
  'news', 'court-record', 'government-record', 'advocacy-report',
  'public-record', 'official-statement', 'other',
]);
export const SourceReliabilitySchema = z.enum(['primary', 'corroborating', 'background']);

const httpUrl = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'URL must use http or https');

const datePattern = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;
export const PartialDateSchema = z.string().superRefine((value, context) => {
  const match = datePattern.exec(value);
  if (!match) {
    context.addIssue({ code: 'custom', message: 'Use YYYY-MM or YYYY-MM-DD' });
    return;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = match[3] === undefined ? undefined : Number(match[3]);
  if (month < 1 || month > 12 || (day !== undefined && (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()))) {
    context.addIssue({ code: 'custom', message: 'Use a real calendar date in YYYY-MM or YYYY-MM-DD format' });
  }
});
const FullDateSchema = PartialDateSchema.refine((value) => value.length === 10, 'Use YYYY-MM-DD');

const directPrimarySourceTypes = new Set(['court-record', 'government-record', 'public-record', 'official-statement']);

export const SourceSchema = z.object({
  url: httpUrl,
  title: z.string().trim().min(1),
  publisher: z.string().trim().min(1),
  published_date: z.union([FullDateSchema, z.literal('')]),
  source_type: SourceTypeSchema,
  archive_url: httpUrl.optional(),
  reliability: SourceReliabilitySchema,
  key_claims: z.array(z.string().trim().min(1)).min(1, 'Each source needs at least one key claim'),
}).strict().superRefine((source, context) => {
  if (source.reliability === 'primary' && !directPrimarySourceTypes.has(source.source_type)) {
    context.addIssue({
      code: 'custom',
      path: ['reliability'],
      message: 'Primary reliability requires a direct official or public record source type',
    });
  }
});

export const IncidentSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'ID must be lowercase and URL-safe (letters, numbers, hyphens)'),
  title: z.string().trim().min(4).max(240),
  status: IncidentStatusSchema,
  summary: z.string().trim().min(20).max(3000),
  incident_type: z.array(IncidentTypeSchema).min(1),
  location: z.object({
    city: z.string().trim(),
    county: z.string().trim(),
    state: z.string().trim(),
    country: z.string().trim().min(2),
  }).strict(),
  actors: z.object({
    agencies: z.array(z.string().trim().min(1)),
    officials_or_entities: z.array(z.string().trim().min(1)),
    vendor_entities: z.array(z.string().trim().min(1)),
  }).strict(),
  dates: z.object({
    occurred: z.union([PartialDateSchema, z.literal('')]),
    discovered: PartialDateSchema,
    reported: FullDateSchema,
  }).strict(),
  sources: z.array(SourceSchema).min(1, 'At least one source is required'),
  legal_or_policy_context: z.object({
    case_numbers: z.array(z.string().trim().min(1)),
    statutes_or_policies: z.array(z.string().trim().min(1)),
  }).strict(),
  outcomes: z.array(z.string().trim().min(1)).min(1),
  uniqueness: z.object({
    canonical_key: z.string().trim().min(1),
    duplicate_of: z.string().nullable(),
  }).strict(),
  review: z.object({
    added_by: z.enum(['manual', 'daily-scraper']),
    approval: z.enum(['pending', 'human-approved']),
    reviewed_by: z.string().trim(),
    reviewed_at: z.union([FullDateSchema, z.literal('')]),
    notes: z.string(),
  }).strict(),
  updated_at: FullDateSchema,
}).strict().superRefine((incident, context) => {
  const canonicalDateSegment = incident.uniqueness.canonical_key.split(':')[1] ?? '';
  if (incident.dates.occurred === '' && canonicalDateSegment !== 'unknown') {
    context.addIssue({ code: 'custom', path: ['uniqueness', 'canonical_key'], message: 'Unknown occurrence dates require an unknown canonical-key date segment' });
  }
  if (incident.dates.occurred !== '' && canonicalDateSegment === 'unknown') {
    context.addIssue({ code: 'custom', path: ['uniqueness', 'canonical_key'], message: 'Known occurrence dates must use a dated canonical-key segment' });
  }

  const isPublic = ['verified', 'disputed', 'retracted'].includes(incident.status);
  if (isPublic) {
    if (incident.review.approval !== 'human-approved' || !incident.review.reviewed_by || !incident.review.reviewed_at) {
      context.addIssue({ code: 'custom', path: ['review'], message: 'Public records require structured human approval, reviewer identity, and review date' });
    }
    if (/hermes|agent|scraper|automation/i.test(incident.review.reviewed_by)) {
      context.addIssue({ code: 'custom', path: ['review', 'reviewed_by'], message: 'Public records require a human reviewer, not an automated agent' });
    }
  } else if (incident.review.approval !== 'pending') {
    context.addIssue({ code: 'custom', path: ['review', 'approval'], message: 'Candidate and draft records must remain pending until publication review' });
  }

  if (incident.status !== 'verified') return;
  if (incident.sources.some((source) => source.reliability === 'primary')) return;
  const independentPublishers = new Set(
    incident.sources
      .filter((source) => source.reliability === 'corroborating')
      .map((source) => source.publisher.trim().toLocaleLowerCase('en-US')),
  );
  const independentHosts = new Set(
    incident.sources
      .filter((source) => source.reliability === 'corroborating')
      .map((source) => new URL(source.url).hostname.toLocaleLowerCase('en-US').replace(/^www\./, '')),
  );
  if (independentPublishers.size < 2 || independentHosts.size < 2) {
    context.addIssue({
      code: 'custom',
      path: ['sources'],
      message: 'Verified records require one primary source or two independent secondary publishers',
    });
  }
});

export type Incident = z.infer<typeof IncidentSchema>;
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;
export type IncidentType = z.infer<typeof IncidentTypeSchema>;
export type SourceType = z.infer<typeof SourceTypeSchema>;
