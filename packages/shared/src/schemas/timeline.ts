import { z } from 'zod';

export const SourceType = z.enum(['gmail', 'drive']);

export const isoDateString = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid ISO date string');

export const SourceMetadataSchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    subject: z.string().optional(),
    dateISO: isoDateString.optional(),
    threadId: z.string().optional(),
    labels: z.array(z.string()).optional(),
    mimeType: z.string().optional(),
    driveName: z.string().optional(),
    driveModifiedTime: isoDateString.optional(),
    driveWebViewLink: z.string().optional(),
    url: z.string().url().optional(),
    finalUrl: z.string().url().optional(),
    driveMetaFileId: z.string().optional(),
    fetchedAtISO: isoDateString.optional(),
  })
  .strict();

export const UrlSelectionSchema = z
  .object({
    kind: z.literal('url'),
    url: z.string().url(),
    driveTextFileId: z.string().min(1),
    driveMetaFileId: z.string().min(1),
    title: z.string().optional(),
  })
  .strict();

export const SourceSelectionSchema = z
  .object({
    source: SourceType,
    id: z.string(),
  })
  .strict();

export const SuggestedActionSchema = z
  .object({
    id: z.string().min(1).optional(),
    type: z.enum(['reminder', 'task', 'calendar']),
    text: z.string().trim().min(3).max(240),
    dueDateISO: z.union([isoDateString, z.null()]).optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    status: z.enum(['proposed', 'accepted', 'dismissed']).optional(),
    createdAtISO: isoDateString.optional(),
    updatedAtISO: isoDateString.optional(),
    calendarEvent: z
      .object({
        id: z.string().min(1),
        htmlLink: z.string().url(),
        startISO: isoDateString,
        endISO: isoDateString,
        createdAtISO: isoDateString,
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

const structuredText = z.string().trim().min(3).max(240);
const structuredOwner = z.string().trim().min(1).max(120).nullable().optional();
const structuredConfidence = z.number().min(0).max(1).nullable().optional();

export const EntitySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    type: z.enum(['person', 'org', 'project', 'product', 'place', 'other']).optional(),
  })
  .strict();

export const DecisionSchema = z
  .object({
    text: structuredText,
    dateISO: z.union([isoDateString, z.null()]).optional(),
    owner: structuredOwner,
    confidence: structuredConfidence,
  })
  .strict();

export const OpenLoopSchema = z
  .object({
    text: structuredText,
    owner: structuredOwner,
    dueDateISO: z.union([isoDateString, z.null()]).optional(),
    status: z.enum(['open', 'closed']).default('open').optional(),
    closedAtISO: z.union([isoDateString, z.null()]).optional(),
    closedReason: z.string().trim().max(240).nullable().optional(),
    sourceActionId: z.string().min(1).nullable().optional(),
    confidence: structuredConfidence,
  })
  .strict();

export const RiskSchema = z
  .object({
    text: structuredText,
    severity: z.enum(['low', 'medium', 'high']).optional(),
    likelihood: z.enum(['low', 'medium', 'high']).optional(),
    owner: structuredOwner,
    mitigation: z.string().trim().max(240).nullable().optional(),
    confidence: structuredConfidence,
  })
  .strict();

export const SummaryArtifactSchema = z
  .object({
    artifactId: z.string(),
    source: SourceType,
    sourceId: z.string(),
    title: z.string(),
    createdAtISO: isoDateString,
    contentDateISO: isoDateString.optional(),
    summary: z.string(),
    highlights: z.array(z.string()),
    evidence: z
      .array(
        z
          .object({
            sourceId: z.string().optional(),
            excerpt: z.string(),
          })
          .strict(),
      )
      .optional(),
    dateConfidence: z.number().min(0).max(1).optional(),
    sourceMetadata: SourceMetadataSchema.optional(),
    sourcePreview: z.string().optional(),
    suggestedActions: z.array(SuggestedActionSchema).optional(),
    entities: z.array(EntitySchema).max(30).optional(),
    decisions: z.array(DecisionSchema).max(30).optional(),
    openLoops: z.array(OpenLoopSchema).max(50).optional(),
    risks: z.array(RiskSchema).max(30).optional(),
    participants: z.array(z.string().trim().min(1)).max(30).optional(),
    tags: z.array(z.string().trim().min(1)).max(20).optional(),
    topics: z.array(z.string().trim().min(1)).max(20).optional(),
    driveFolderId: z.string(),
    driveFileId: z.string(),
    driveWebViewLink: z.string().optional(),
    model: z.string(),
    version: z.number(),
  })
  .strict();

export const DriveSummaryEnvelopeSchema = z
  .object({
    type: z.literal('summary'),
    status: z.literal('complete'),
    id: z.string(),
    updatedAtISO: isoDateString,
    meta: z
      .object({
        mimeType: z.string().optional(),
        driveFileId: z.string(),
        driveWebViewLink: z.string().optional(),
        driveFolderId: z.string(),
        source: SourceType,
        sourceId: z.string(),
        model: z.string(),
        version: z.number(),
      })
      .strict(),
  })
  .strict();

export const DriveSummaryJsonSchema = SummaryArtifactSchema.merge(DriveSummaryEnvelopeSchema);

const DriveFileOptionalMetaSchema = z
  .object({
    mimeType: z.string().optional(),
    driveFileId: z.string().optional(),
    driveWebViewLink: z.string().optional(),
    driveFolderId: z.string().optional(),
    source: SourceType.optional(),
    sourceId: z.string().optional(),
    model: z.string().optional(),
    version: z.number().optional(),
  })
  .passthrough();

export const SelectionSetItemSchema = z
  .object({
    source: SourceType,
    id: z.string(),
    title: z.string().optional(),
    dateISO: isoDateString.optional(),
  })
  .strict();

export const SelectionSetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    createdAtISO: isoDateString,
    updatedAtISO: isoDateString,
    items: z.array(SelectionSetItemSchema),
    notes: z.string().optional(),
    version: z.number(),
    driveFolderId: z.string(),
    driveFileId: z.string(),
    driveWebViewLink: z.string().optional(),
  })
  .strict();

export const TimelineIndexSummarySchema = z
  .object({
    driveFileId: z.string().min(1),
    title: z.string(),
    source: SourceType,
    sourceId: z.string().min(1),
    createdAtISO: isoDateString.optional(),
    updatedAtISO: isoDateString.optional(),
    webViewLink: z.string().optional(),
  })
  .strict();

export const TimelineIndexSelectionSetSchema = z
  .object({
    driveFileId: z.string().min(1),
    name: z.string(),
    updatedAtISO: isoDateString.optional(),
    webViewLink: z.string().optional(),
  })
  .strict();

export const TimelineIndexStatsSchema = z
  .object({
    totalSummaries: z.number(),
    totalSelectionSets: z.number(),
  })
  .strict();

export const TimelineIndexSchema = z
  .object({
    version: z.number(),
    updatedAtISO: isoDateString,
    driveFolderId: z.string(),
    indexFileId: z.string(),
    summaries: z.array(TimelineIndexSummarySchema),
    selectionSets: z.array(TimelineIndexSelectionSetSchema),
    stats: TimelineIndexStatsSchema.optional(),
  })
  .strict();

export const DriveTimelineIndexJsonSchema = TimelineIndexSchema.extend({
  type: z.string().optional(),
  status: z.string().optional(),
  id: z.string().optional(),
  meta: DriveFileOptionalMetaSchema.optional(),
}).passthrough();

export const DriveSelectionSetJsonSchema = SelectionSetSchema.extend({
  type: z.string().optional(),
  status: z.string().optional(),
  meta: DriveFileOptionalMetaSchema.optional(),
}).passthrough();

export const AdminSettingsSchema = z
  .object({
    type: z.literal('admin_settings'),
    version: z.literal(1),
    provider: z.enum(['stub', 'openai', 'gemini']),
    model: z.string(),
    systemPrompt: z.string(),
    summaryPromptTemplate: z.string().optional(),
    highlightsPromptTemplate: z.string().optional(),
    maxOutputTokens: z.number().optional(),
    maxContextItems: z.number(),
    temperature: z.number(),
    updatedAtISO: isoDateString,
  })
  .strict();

export const SummarizeRequestSchema = z
  .object({
    items: z.array(z.union([SourceSelectionSchema, UrlSelectionSchema])),
  })
  .strict();

export const SummarizeResponseSchema = z
  .object({
    artifacts: z.array(SummaryArtifactSchema),
    failed: z.array(
      z
        .object({
          source: SourceType,
          id: z.string(),
          error: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export const ArtifactIndexEntrySchema = z
  .object({
    id: z.string().min(1),
    driveFileId: z.string().min(1),
    kind: z.enum(['summary', 'synthesis']).optional(),
    title: z.string().optional(),
    contentDateISO: isoDateString.optional(),
    tags: z.array(z.string()).optional(),
    topics: z.array(z.string()).optional(),
    participants: z.array(z.string()).optional(),
    entities: z.array(EntitySchema).max(10).optional(),
    decisionsCount: z.number().int().min(0).optional(),
    openLoopsCount: z.number().int().min(0).optional(),
    risksCount: z.number().int().min(0).optional(),
    updatedAtISO: isoDateString.optional(),
  })
  .strict();

export const SynthesisModeSchema = z.enum([
  'briefing',
  'status_report',
  'decision_log',
  'open_loops',
]);

export const SynthesisRequestSchema = z
  .object({
    mode: SynthesisModeSchema,
    title: z.string().trim().min(3).max(120).optional(),
    artifactIds: z.array(z.string().min(1)).max(50).optional(),
    dateFromISO: isoDateString.optional(),
    dateToISO: isoDateString.optional(),
    tags: z.array(z.string().trim().min(1)).max(10).optional(),
    participants: z.array(z.string().trim().min(1)).max(10).optional(),
    includeEvidence: z.boolean().default(false),
    saveToTimeline: z.boolean().default(true),
    limit: z.number().int().min(1).max(30).default(15),
  })
  .strict();

export const SynthesisCitationSchema = z
  .object({
    artifactId: z.string().min(1),
    excerpt: z.string().trim().min(1),
    contentDateISO: isoDateString.optional(),
    title: z.string().optional(),
  })
  .strict();

export const SynthesisOutputSchema = z
  .object({
    synthesisId: z.string().min(1),
    mode: SynthesisModeSchema,
    title: z.string().trim().min(1),
    createdAtISO: isoDateString,
    content: z.string().trim().min(1),
    keyPoints: z.array(z.string().trim().min(1)).max(20).optional(),
    decisions: z.array(DecisionSchema).max(30).optional(),
    risks: z.array(RiskSchema).max(30).optional(),
    openLoops: z.array(OpenLoopSchema).max(50).optional(),
    entities: z.array(EntitySchema).max(30).optional(),
    participants: z.array(z.string().trim().min(1)).max(30).optional(),
    tags: z.array(z.string().trim().min(1)).max(20).optional(),
    topics: z.array(z.string().trim().min(1)).max(20).optional(),
    suggestedActions: z.array(SuggestedActionSchema).optional(),
  })
  .strict();

export const SynthesisResponseSchema = z
  .object({
    ok: z.literal(true),
    synthesis: SynthesisOutputSchema,
    citations: z.array(SynthesisCitationSchema),
    usedArtifactIds: z.array(z.string()),
    savedArtifactId: z.string().optional(),
  })
  .strict();

export const SynthesisArtifactSchema = z
  .object({
    kind: z.literal('synthesis'),
    id: z.string().min(1),
    title: z.string().trim().min(1),
    mode: SynthesisModeSchema,
    createdAtISO: isoDateString,
    contentDateISO: isoDateString.optional(),
    sourceArtifactIds: z.array(z.string().min(1)).max(50),
    content: z.string().trim().min(1),
    citations: z.array(
      z
        .object({
          artifactId: z.string().min(1),
          excerpt: z.string().trim().min(1),
        })
        .strict(),
    ),
    summary: z.string().optional(),
    tags: z.array(z.string()).optional(),
    topics: z.array(z.string()).optional(),
    participants: z.array(z.string()).optional(),
    entities: z.array(EntitySchema).max(30).optional(),
    decisions: z.array(DecisionSchema).max(30).optional(),
    openLoops: z.array(OpenLoopSchema).max(50).optional(),
    risks: z.array(RiskSchema).max(30).optional(),
    suggestedActions: z.array(SuggestedActionSchema).optional(),
  })
  .strict();

export const ArtifactIndexSchema = z
  .object({
    version: z.literal(1),
    updatedAtISO: isoDateString,
    artifacts: z.array(ArtifactIndexEntrySchema),
  })
  .strict();

export const StructuredQueryRequestSchema = z
  .object({
    dateFromISO: isoDateString.optional(),
    dateToISO: isoDateString.optional(),
    kind: z.array(z.enum(['summary', 'synthesis'])).max(2).optional(),
    entity: z.string().trim().min(1).max(120).optional(),
    tags: z.array(z.string().trim().min(1)).max(10).optional(),
    participants: z.array(z.string().trim().min(1)).max(10).optional(),
    hasOpenLoops: z.boolean().optional(),
    openLoopStatus: z.enum(['open', 'closed']).optional(),
    openLoopDueFromISO: isoDateString.optional(),
    openLoopDueToISO: isoDateString.optional(),
    hasRisks: z.boolean().optional(),
    riskSeverity: z.enum(['low', 'medium', 'high']).optional(),
    hasDecisions: z.boolean().optional(),
    decisionFromISO: isoDateString.optional(),
    decisionToISO: isoDateString.optional(),
    limitArtifacts: z.number().int().min(1).max(80).default(30),
    limitItemsPerArtifact: z.number().int().min(1).max(30).default(10),
  })
  .strict();

export const StructuredQueryResponseSchema = z
  .object({
    ok: z.literal(true),
    query: StructuredQueryRequestSchema,
    totals: z
      .object({
        artifactsMatched: z.number().int().min(0),
        openLoopsMatched: z.number().int().min(0),
        risksMatched: z.number().int().min(0),
        decisionsMatched: z.number().int().min(0),
      })
      .strict(),
    results: z.array(
      z
        .object({
          artifactId: z.string().min(1),
          kind: z.enum(['summary', 'synthesis']).optional(),
          title: z.string().optional(),
          contentDateISO: isoDateString.optional(),
          entities: z.array(EntitySchema).optional(),
          matches: z
            .object({
              openLoops: z.array(OpenLoopSchema).optional(),
              risks: z.array(RiskSchema).optional(),
              decisions: z.array(DecisionSchema).optional(),
            })
            .strict(),
        })
        .strict(),
    ),
  })
  .strict();

export const ReportExportRequestSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    format: z.literal('markdown'),
    query: StructuredQueryRequestSchema.optional(),
    weekInReview: z
      .object({
        dateFromISO: isoDateString,
        dateToISO: isoDateString,
      })
      .strict()
      .optional(),
    includeCitations: z.boolean().default(true),
    saveToDrive: z.boolean().default(true),
  })
  .strict();

export const ReportExportResponseSchema = z
  .object({
    ok: z.literal(true),
    report: z
      .object({
        reportId: z.string().min(1),
        title: z.string().trim().min(1),
        createdAtISO: isoDateString,
        driveFileId: z.string().optional(),
        driveFileName: z.string().optional(),
      })
      .strict(),
  })
  .strict();



const ScheduleSchema = z
  .object({
    cron: z.string().trim().min(1),
    timezone: z.string().trim().min(1),
  })
  .strict();

const NotificationConfigSchema = z
  .object({
    enabled: z.boolean(),
    mode: z.enum(['broadcast', 'routes']).default('broadcast').optional(),
    to: z.array(z.string().email()).min(1).max(10).optional(),
    cc: z.array(z.string().email()).max(10).optional(),
    routes: z
      .array(
        z
          .object({
            profileId: z.string().min(1).max(40),
            subjectPrefix: z.string().max(60).optional(),
            filtersOverride: z
              .object({
                entities: z.array(z.string().trim().min(1)).max(20).optional(),
                tags: z.array(z.string().trim().min(1)).max(20).optional(),
                participants: z.array(z.string().trim().min(1)).max(20).optional(),
                kind: z.array(z.enum(['summary', 'synthesis'])).max(2).optional(),
                riskSeverityMin: z.enum(['low', 'medium', 'high']).optional(),
                includeOpenLoops: z.boolean().default(true).optional(),
                includeRisks: z.boolean().default(true).optional(),
                includeDecisions: z.boolean().default(true).optional(),
                includeActions: z.boolean().default(true).optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(30)
      .optional(),
    subjectPrefix: z.string().max(60).optional(),
    includeReportAttachment: z.boolean().default(false).optional(),
    includeLinks: z.boolean().default(true).optional(),
    sendWhenEmpty: z.boolean().default(false).optional(),
    generatePerRouteReport: z.boolean().default(false),
    maxPerRouteReportsPerRun: z.number().int().min(1).max(25).default(5),
    reportTitleTemplate: z.string().trim().min(0).max(120).optional(),
  })
  .superRefine((value, ctx) => {
    const mode = value.mode ?? 'broadcast';
    if (mode === 'broadcast' && (!value.to?.length)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Broadcast notifications require at least one recipient.' });
    }
    if (mode === 'routes' && (!value.routes?.length)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['routes'], message: 'Route notifications require at least one route.' });
    }
    if (mode !== 'routes' && value.generatePerRouteReport) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['generatePerRouteReport'],
        message: 'Per-route report generation requires notify.mode="routes".',
      });
    }
  });

const RecipientProfileFiltersSchema = z
  .object({
    entities: z.array(z.string().trim().min(1)).max(20).optional(),
    tags: z.array(z.string().trim().min(1)).max(20).optional(),
    participants: z.array(z.string().trim().min(1)).max(20).optional(),
    kind: z.array(z.enum(['summary', 'synthesis'])).max(2).optional(),
    riskSeverityMin: z.enum(['low', 'medium', 'high']).optional(),
    includeOpenLoops: z.boolean().default(true).optional(),
    includeRisks: z.boolean().default(true).optional(),
    includeDecisions: z.boolean().default(true).optional(),
    includeActions: z.boolean().default(true).optional(),
  })
  .strict();

const RecipientProfileSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    name: z.string().max(80).optional(),
    to: z.array(z.string().email()).min(1).max(10),
    cc: z.array(z.string().email()).max(10).optional(),
    filters: RecipientProfileFiltersSchema,
  })
  .strict();

const WeekInReviewJobSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('week_in_review'),
    enabled: z.boolean(),
    schedule: ScheduleSchema,
    params: z
      .object({
        includeEvidence: z.boolean().optional(),
        exportReport: z.boolean().optional(),
        saveToTimeline: z.boolean().optional(),
      })
      .strict()
      .optional(),
    notify: NotificationConfigSchema.optional(),
  })
  .strict();

const AlertsJobSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('alerts'),
    enabled: z.boolean(),
    schedule: ScheduleSchema,
    params: z
      .object({
        alertTypes: z
          .array(z.enum(['new_high_risks', 'new_open_loops_due_7d', 'new_decisions']))
          .min(1),
        lookbackDays: z.number().int().min(1).max(30).default(1),
        riskSeverity: z.literal('high').optional(),
        dueInDays: z.number().int().min(1).max(30).default(7),
      })
      .strict(),
    notify: NotificationConfigSchema.optional(),
  })
  .strict();

export const ScheduleConfigSchema = z
  .object({
    version: z.literal(1),
    updatedAtISO: isoDateString,
    recipientProfiles: z.array(RecipientProfileSchema).max(100).optional(),
    jobs: z.array(z.discriminatedUnion('type', [WeekInReviewJobSchema, AlertsJobSchema])),
  })
  .superRefine((value, ctx) => {
    const profiles = new Set((value.recipientProfiles ?? []).map((profile) => profile.id));
    value.jobs.forEach((job, jobIndex) => {
      const notify = job.notify as z.infer<typeof NotificationConfigSchema> | undefined;
      if (!notify || (notify.mode ?? 'broadcast') !== 'routes') return;
      if (!value.recipientProfiles?.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['recipientProfiles'],
          message: 'Route notifications require recipientProfiles.',
        });
        return;
      }
      notify.routes?.forEach((route, routeIndex) => {
        if (!profiles.has(route.profileId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['jobs', jobIndex, 'notify', 'routes', routeIndex, 'profileId'],
            message: `Unknown recipient profile: ${route.profileId}`,
          });
        }
      });
    });
  });

export const ApiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        details: z.unknown().optional(),
      })
      .strict(),
    error_code: z.string(),
  })
  .strict();

export type SourceType = z.infer<typeof SourceType>;
export type SourceMetadata = z.infer<typeof SourceMetadataSchema>;
export type UrlSelection = z.infer<typeof UrlSelectionSchema>;
export type SourceSelection = z.infer<typeof SourceSelectionSchema>;
export type SummaryArtifact = z.infer<typeof SummaryArtifactSchema>;
export type SuggestedAction = z.infer<typeof SuggestedActionSchema>;
export type DriveSummaryEnvelope = z.infer<typeof DriveSummaryEnvelopeSchema>;
export type DriveSummaryJson = z.infer<typeof DriveSummaryJsonSchema>;
export type SelectionSetItem = z.infer<typeof SelectionSetItemSchema>;
export type SelectionSet = z.infer<typeof SelectionSetSchema>;
export type TimelineIndexSummary = z.infer<typeof TimelineIndexSummarySchema>;
export type TimelineIndexSelectionSet = z.infer<typeof TimelineIndexSelectionSetSchema>;
export type TimelineIndexStats = z.infer<typeof TimelineIndexStatsSchema>;
export type TimelineIndex = z.infer<typeof TimelineIndexSchema>;
export type DriveTimelineIndexJson = z.infer<typeof DriveTimelineIndexJsonSchema>;
export type DriveSelectionSetJson = z.infer<typeof DriveSelectionSetJsonSchema>;
export type AdminSettings = z.infer<typeof AdminSettingsSchema>;
export type SummarizeRequest = z.infer<typeof SummarizeRequestSchema>;
export type SummarizeResponse = z.infer<typeof SummarizeResponseSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ArtifactIndexEntry = z.infer<typeof ArtifactIndexEntrySchema>;
export type ArtifactIndex = z.infer<typeof ArtifactIndexSchema>;
export type SynthesisMode = z.infer<typeof SynthesisModeSchema>;
export type SynthesisRequest = z.infer<typeof SynthesisRequestSchema>;
export type SynthesisOutput = z.infer<typeof SynthesisOutputSchema>;
export type SynthesisResponse = z.infer<typeof SynthesisResponseSchema>;
export type SynthesisArtifact = z.infer<typeof SynthesisArtifactSchema>;
export type StructuredQueryRequest = z.infer<typeof StructuredQueryRequestSchema>;
export type StructuredQueryResponse = z.infer<typeof StructuredQueryResponseSchema>;
export type ReportExportRequest = z.infer<typeof ReportExportRequestSchema>;
export type ReportExportResponse = z.infer<typeof ReportExportResponseSchema>;

export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;
