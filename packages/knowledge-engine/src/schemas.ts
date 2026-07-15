import { z } from 'zod';

/**
 * The strict JSON contract between LLM extraction and the knowledge store.
 * Every provider response is validated against these schemas — malformed
 * output fails validation and is retried once with the error feedback,
 * then rejected. Nothing unvalidated ever reaches the database.
 */

export const ENTITY_TYPES = [
  'PERSON',
  'TEAM',
  'ORGANIZATION',
  'PROJECT',
  'TASK',
  'BUG',
  'ISSUE',
  'MEETING',
  'ACTION_ITEM',
  'DECISION',
  'DEADLINE',
  'FEATURE',
  'REQUIREMENT',
  'MILESTONE',
  'RISK',
  'QUESTION',
  'POLICY',
  'CUSTOMER',
  'VENDOR',
  'BOOKING',
  'PAYMENT',
  'INVOICE',
  'PRODUCT',
  'SERVICE',
  'LOCATION',
  'EMAIL',
  'CALENDAR_EVENT',
  'DOCUMENT',
  'FILE',
  'URL',
  'EVENT',
  'CONVERSATION',
  'COMMENT',
  'OTHER',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const RELATIONSHIP_TYPES = [
  'ASSIGNED_TO',
  'REPORTED',
  'CREATED',
  'CREATES',
  'BELONGS_TO',
  'OWNS',
  'BLOCKS',
  'DEPENDS_ON',
  'MENTIONS',
  'LINKS_TO',
  'PART_OF',
  'ATTENDED',
  'WORKS_ON',
  'MANAGES',
  'RESOLVES',
  'AFFECTS',
  'SCHEDULED_FOR',
  'RESPONSIBLE_FOR',
  'RELATES_TO',
  'DUPLICATES',
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const OBJECT_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'BLOCKED',
  'RESOLVED',
  'COMPLETED',
  'CANCELLED',
  'ACTIVE',
  'ARCHIVED',
  'UNKNOWN',
] as const;
export type ObjectStatus = (typeof OBJECT_STATUSES)[number];

export const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const entityTypeSchema = z.enum(ENTITY_TYPES);
export const relationshipTypeSchema = z.enum(RELATIONSHIP_TYPES);
export const objectStatusSchema = z.enum(OBJECT_STATUSES);
export const prioritySchema = z.enum(PRIORITIES);

const confidenceSchema = z.number().min(0).max(1);

/** Base shape shared by every extracted knowledge object. */
export const baseExtractedObjectSchema = z.object({
  /** Chunk-local handle used by relationships (e.g. "obj_1"). */
  ref: z.string().min(1),
  type: entityTypeSchema,
  title: z.string().min(1).max(500),
  summary: z.string().max(2000).nullish(),
  description: z.string().max(8000).nullish(),
  status: objectStatusSchema.default('UNKNOWN'),
  priority: prioritySchema.default('NONE'),
  confidence: confidenceSchema,
  /** Other surface forms of the same entity found in the text. */
  aliases: z.array(z.string().min(1).max(300)).default([]),
  /** Short verbatim quote from the chunk that evidences this object. */
  evidence: z.string().max(1000).nullish(),
  /** Type-specific structured fields — validated per type below. */
  metadata: z.record(z.unknown()).default({}),
});
export type ExtractedObject = z.infer<typeof baseExtractedObjectSchema>;

// ── Per-type metadata schemas ─────────────────────────────────────
// Validation must fail on malformed outputs, but extraction is lossy by
// nature — every field is optional; unknown keys are rejected.

const isoDate = z.string().max(64);

export const PersonSchema = z
  .object({
    email: z.string().max(320).nullish(),
    role: z.string().max(200).nullish(),
    team: z.string().max(200).nullish(),
  })
  .strict();

export const TeamSchema = z.object({ department: z.string().max(200).nullish() }).strict();

export const OrganizationSchema = z
  .object({ domain: z.string().max(255).nullish(), industry: z.string().max(200).nullish() })
  .strict();

export const ProjectSchema = z
  .object({
    owner: z.string().max(200).nullish(),
    startDate: isoDate.nullish(),
    endDate: isoDate.nullish(),
  })
  .strict();

export const TaskSchema = z
  .object({
    assignee: z.string().max(200).nullish(),
    dueDate: isoDate.nullish(),
    project: z.string().max(300).nullish(),
  })
  .strict();

export const BugSchema = z
  .object({
    severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).nullish(),
    component: z.string().max(300).nullish(),
    stepsToReproduce: z.string().max(2000).nullish(),
    reportedBy: z.string().max(200).nullish(),
    assignee: z.string().max(200).nullish(),
  })
  .strict();

export const MeetingSchema = z
  .object({
    date: isoDate.nullish(),
    attendees: z.array(z.string().max(200)).nullish(),
    location: z.string().max(300).nullish(),
  })
  .strict();

export const DecisionSchema = z
  .object({
    decidedBy: z.string().max(200).nullish(),
    date: isoDate.nullish(),
    rationale: z.string().max(2000).nullish(),
  })
  .strict();

export const DeadlineSchema = z
  .object({ date: isoDate.nullish(), appliesTo: z.string().max(300).nullish() })
  .strict();

export const FeatureSchema = z
  .object({ component: z.string().max(300).nullish(), requestedBy: z.string().max(200).nullish() })
  .strict();

export const RequirementSchema = z
  .object({
    kind: z.enum(['FUNCTIONAL', 'NON_FUNCTIONAL', 'CONSTRAINT']).nullish(),
    source: z.string().max(300).nullish(),
  })
  .strict();

export const PaymentSchema = z
  .object({
    amount: z.number().nullish(),
    currency: z.string().max(10).nullish(),
    date: isoDate.nullish(),
    payer: z.string().max(200).nullish(),
    payee: z.string().max(200).nullish(),
  })
  .strict();

export const InvoiceSchema = z
  .object({
    number: z.string().max(100).nullish(),
    amount: z.number().nullish(),
    currency: z.string().max(10).nullish(),
    dueDate: isoDate.nullish(),
  })
  .strict();

export const BookingSchema = z
  .object({
    date: isoDate.nullish(),
    reference: z.string().max(200).nullish(),
    location: z.string().max(300).nullish(),
  })
  .strict();

export const CalendarEventSchema = z
  .object({
    start: isoDate.nullish(),
    end: isoDate.nullish(),
    attendees: z.array(z.string().max(200)).nullish(),
  })
  .strict();

export const UrlSchema = z.object({ url: z.string().max(2000).nullish() }).strict();

/** Per-type metadata validators; types without one accept any object. */
export const TYPE_METADATA_SCHEMAS: Partial<Record<EntityType, z.ZodTypeAny>> = {
  PERSON: PersonSchema,
  TEAM: TeamSchema,
  ORGANIZATION: OrganizationSchema,
  PROJECT: ProjectSchema,
  TASK: TaskSchema,
  BUG: BugSchema,
  ISSUE: BugSchema,
  MEETING: MeetingSchema,
  ACTION_ITEM: TaskSchema,
  DECISION: DecisionSchema,
  DEADLINE: DeadlineSchema,
  FEATURE: FeatureSchema,
  REQUIREMENT: RequirementSchema,
  PAYMENT: PaymentSchema,
  INVOICE: InvoiceSchema,
  BOOKING: BookingSchema,
  CALENDAR_EVENT: CalendarEventSchema,
  URL: UrlSchema,
};

/** Full object validation: base shape + per-type metadata. */
export const extractedObjectSchema = baseExtractedObjectSchema.superRefine((obj, ctx) => {
  const metadataSchema = TYPE_METADATA_SCHEMAS[obj.type];
  if (!metadataSchema) return;
  const result = metadataSchema.safeParse(obj.metadata);
  if (!result.success) {
    for (const issue of result.error.issues) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['metadata', ...issue.path],
        message: `${obj.type} metadata: ${issue.message}`,
      });
    }
  }
});

export const extractedRelationshipSchema = z.object({
  /** `ref` of the source object in this extraction. */
  from: z.string().min(1),
  /** `ref` of the target object in this extraction. */
  to: z.string().min(1),
  type: relationshipTypeSchema,
  confidence: confidenceSchema,
});
export type ExtractedRelationship = z.infer<typeof extractedRelationshipSchema>;

/** The complete result one extraction call must produce. */
export const extractionResultSchema = z
  .object({
    objects: z.array(extractedObjectSchema).max(50),
    relationships: z.array(extractedRelationshipSchema).max(100),
  })
  .superRefine((result, ctx) => {
    const refs = new Set(result.objects.map((o) => o.ref));
    if (refs.size !== result.objects.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['objects'],
        message: 'object refs must be unique',
      });
    }
    result.relationships.forEach((rel, i) => {
      if (!refs.has(rel.from)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['relationships', i, 'from'],
          message: `unknown object ref "${rel.from}"`,
        });
      }
      if (!refs.has(rel.to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['relationships', i, 'to'],
          message: `unknown object ref "${rel.to}"`,
        });
      }
    });
  });
export type ExtractionResult = z.infer<typeof extractionResultSchema>;
