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
    suggestedActions: z
      .array(
        z
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
          .strict(),
      )
      .optional(),
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
    title: z.string().optional(),
    contentDateISO: isoDateString.optional(),
    tags: z.array(z.string()).optional(),
    participants: z.array(z.string()).optional(),
    updatedAtISO: isoDateString.optional(),
  })
  .strict();

export const ArtifactIndexSchema = z
  .object({
    version: z.literal(1),
    updatedAtISO: isoDateString,
    artifacts: z.array(ArtifactIndexEntrySchema),
  })
  .strict();

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
