import { z } from 'zod';

export const SourceType = z.enum(['gmail', 'drive']);

export const SourceMetadataSchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    subject: z.string().optional(),
    dateISO: z.string().optional(),
    threadId: z.string().optional(),
    labels: z.array(z.string()).optional(),
    mimeType: z.string().optional(),
    driveName: z.string().optional(),
    driveModifiedTime: z.string().optional(),
    driveWebViewLink: z.string().optional(),
  })
  .strict();

export const SummaryArtifactSchema = z
  .object({
    artifactId: z.string(),
    source: SourceType,
    sourceId: z.string(),
    title: z.string(),
    createdAtISO: z.string(),
    summary: z.string(),
    highlights: z.array(z.string()),
    sourceMetadata: SourceMetadataSchema.optional(),
    sourcePreview: z.string().optional(),
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
    updatedAtISO: z.string(),
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

export const SelectionSetItemSchema = z
  .object({
    source: SourceType,
    id: z.string(),
    title: z.string().optional(),
    dateISO: z.string().optional(),
  })
  .strict();

export const SelectionSetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    createdAtISO: z.string(),
    updatedAtISO: z.string(),
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
    createdAtISO: z.string().optional(),
    updatedAtISO: z.string().optional(),
    webViewLink: z.string().optional(),
  })
  .strict();

export const TimelineIndexSelectionSetSchema = z
  .object({
    driveFileId: z.string().min(1),
    name: z.string(),
    updatedAtISO: z.string().optional(),
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
    updatedAtISO: z.string(),
    driveFolderId: z.string(),
    indexFileId: z.string(),
    summaries: z.array(TimelineIndexSummarySchema),
    selectionSets: z.array(TimelineIndexSelectionSetSchema),
    stats: TimelineIndexStatsSchema.optional(),
  })
  .strict();

export const AdminSettingsSchema = z
  .object({
    type: z.literal('admin_settings'),
    version: z.literal(1),
    provider: z.enum(['stub', 'openai', 'gemini']),
    model: z.string(),
    systemPrompt: z.string(),
    maxContextItems: z.number(),
    temperature: z.number(),
    updatedAtISO: z.string(),
  })
  .strict();

export const SummarizeRequestSchema = z
  .object({
    items: z.array(
      z
        .object({
          source: SourceType,
          id: z.string(),
        })
        .strict(),
    ),
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
export type SummaryArtifact = z.infer<typeof SummaryArtifactSchema>;
export type DriveSummaryEnvelope = z.infer<typeof DriveSummaryEnvelopeSchema>;
export type DriveSummaryJson = z.infer<typeof DriveSummaryJsonSchema>;
export type SelectionSetItem = z.infer<typeof SelectionSetItemSchema>;
export type SelectionSet = z.infer<typeof SelectionSetSchema>;
export type TimelineIndexSummary = z.infer<typeof TimelineIndexSummarySchema>;
export type TimelineIndexSelectionSet = z.infer<typeof TimelineIndexSelectionSetSchema>;
export type TimelineIndexStats = z.infer<typeof TimelineIndexStatsSchema>;
export type TimelineIndex = z.infer<typeof TimelineIndexSchema>;
export type AdminSettings = z.infer<typeof AdminSettingsSchema>;
export type SummarizeRequest = z.infer<typeof SummarizeRequestSchema>;
export type SummarizeResponse = z.infer<typeof SummarizeResponseSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
