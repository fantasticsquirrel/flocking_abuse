import { z } from 'zod';
import { PartialDateSchema, SourceSchema } from './incidentSchema.js';
export const UnverifiedReportSchema = z.object({
    schema_version: z.literal(1),
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().trim().min(4).max(240),
    summary: z.string().trim().min(20).max(3000),
    location: z.object({ city: z.string(), county: z.string(), state: z.string(), country: z.string().min(2) }).strict(),
    companies: z.array(z.string().trim().min(1)).min(1),
    agencies: z.array(z.string().trim().min(1)).min(1),
    reported: z.union([PartialDateSchema, z.literal('')]),
    sources: z.array(SourceSchema).min(1),
    verification_status: z.object({
        reason: z.string().trim().min(20),
        evidence_needed: z.array(z.string().trim().min(1)).min(1),
    }).strict(),
    updated_at: z.iso.date(),
}).strict();
//# sourceMappingURL=unverifiedSchema.js.map