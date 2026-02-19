import { describe, expect, it } from 'vitest';

import {
  AdminSettingsSchema,
  SelectionSetSchema,
  SourceType,
  SummaryArtifactSchema,
  SynthesisArtifactSchema,
  SynthesisRequestSchema,
  SynthesisResponseSchema,
  StructuredQueryRequestSchema,
  StructuredQueryResponseSchema,
  ReportExportRequestSchema,
  ReportExportResponseSchema,
  ScheduleConfigSchema,
} from './index.js';

describe('shared schemas', () => {
  it('exposes timeline zod schemas', () => {
    expect(SourceType.options).toEqual(['gmail', 'drive']);
    expect(SummaryArtifactSchema.shape.title).toBeDefined();
  });

  it('rejects invalid ISO strings for summary artifact timestamps', () => {
    const result = SummaryArtifactSchema.safeParse({
      artifactId: 'artifact-1',
      source: 'gmail',
      sourceId: 'source-1',
      title: 'A title',
      createdAtISO: 'not-a-date',
      summary: 'Summary text',
      highlights: ['One'],
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
      model: 'test-model',
      version: 1,
    });

    expect(result.success).toBe(false);
  });


  it('accepts contentDateISO when valid', () => {
    const result = SummaryArtifactSchema.safeParse({
      artifactId: 'artifact-1',
      source: 'gmail',
      sourceId: 'source-1',
      title: 'A title',
      createdAtISO: '2026-01-01T12:00:00Z',
      contentDateISO: '2025-12-31T00:00:00Z',
      summary: 'Summary text',
      highlights: ['One'],
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
      model: 'test-model',
      version: 1,
    });

    expect(result.success).toBe(true);
  });

  it('rejects invalid contentDateISO when present', () => {
    const result = SummaryArtifactSchema.safeParse({
      artifactId: 'artifact-1',
      source: 'gmail',
      sourceId: 'source-1',
      title: 'A title',
      createdAtISO: '2026-01-01T12:00:00Z',
      contentDateISO: 'not-an-iso-date',
      summary: 'Summary text',
      highlights: ['One'],
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
      model: 'test-model',
      version: 1,
    });

    expect(result.success).toBe(false);
  });

  it('accepts optional evidence and valid dateConfidence', () => {
    const result = SummaryArtifactSchema.safeParse({
      artifactId: 'artifact-1',
      source: 'gmail',
      sourceId: 'source-1',
      title: 'A title',
      createdAtISO: '2026-01-01T12:00:00Z',
      summary: 'Summary text',
      highlights: ['One'],
      evidence: [
        {
          sourceId: 'source-1',
          excerpt: 'Relevant quoted evidence',
        },
      ],
      dateConfidence: 0.8,
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
      model: 'test-model',
      version: 1,
    });

    expect(result.success).toBe(true);
  });

  it('rejects dateConfidence outside 0..1', () => {
    const result = SummaryArtifactSchema.safeParse({
      artifactId: 'artifact-1',
      source: 'gmail',
      sourceId: 'source-1',
      title: 'A title',
      createdAtISO: '2026-01-01T12:00:00Z',
      summary: 'Summary text',
      highlights: ['One'],
      dateConfidence: 1.2,
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
      model: 'test-model',
      version: 1,
    });

    expect(result.success).toBe(false);
  });



  it('accepts open loops with lifecycle fields', () => {
    const result = SummaryArtifactSchema.safeParse({
      artifactId: 'artifact-1',
      source: 'gmail',
      sourceId: 'source-1',
      title: 'A title',
      createdAtISO: '2026-01-01T12:00:00Z',
      summary: 'Summary text',
      highlights: ['One'],
      openLoops: [
        {
          text: 'Confirm owner',
          status: 'closed',
          closedAtISO: '2026-01-03T00:00:00Z',
          closedReason: 'Completed by legal',
          sourceActionId: 'act-1',
        },
      ],
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
      model: 'test-model',
      version: 1,
    });

    expect(result.success).toBe(true);
  });

  it('enforces closedReason bounds for open loops', () => {
    const result = SummaryArtifactSchema.safeParse({
      artifactId: 'artifact-1',
      source: 'gmail',
      sourceId: 'source-1',
      title: 'A title',
      createdAtISO: '2026-01-01T12:00:00Z',
      summary: 'Summary text',
      highlights: ['One'],
      openLoops: [
        {
          text: 'Confirm owner',
          status: 'closed',
          closedReason: 'x'.repeat(241),
        },
      ],
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
      model: 'test-model',
      version: 1,
    });

    expect(result.success).toBe(false);
  });

  it('remains backward compatible for open loops without lifecycle fields', () => {
    const result = SummaryArtifactSchema.safeParse({
      artifactId: 'artifact-1',
      source: 'gmail',
      sourceId: 'source-1',
      title: 'A title',
      createdAtISO: '2026-01-01T12:00:00Z',
      summary: 'Summary text',
      highlights: ['One'],
      openLoops: [{ text: 'Confirm owner', status: 'open' }],
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
      model: 'test-model',
      version: 1,
    });

    expect(result.success).toBe(true);
  });
  it('accepts suggested actions on summary artifacts', () => {
    const result = SummaryArtifactSchema.safeParse({
      artifactId: 'artifact-1',
      source: 'gmail',
      sourceId: 'source-1',
      title: 'A title',
      createdAtISO: '2026-01-01T12:00:00Z',
      summary: 'Summary text',
      highlights: ['One'],
      suggestedActions: [
        {
          id: 'act-1',
          type: 'reminder',
          text: 'Follow up with finance team',
          dueDateISO: null,
          confidence: 0.5,
          status: 'proposed',
        },
      ],
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
      model: 'test-model',
      version: 1,
    });

    expect(result.success).toBe(true);
  });

  it('rejects invalid suggested action type', () => {
    const result = SummaryArtifactSchema.safeParse({
      artifactId: 'artifact-1',
      source: 'gmail',
      sourceId: 'source-1',
      title: 'A title',
      createdAtISO: '2026-01-01T12:00:00Z',
      summary: 'Summary text',
      highlights: ['One'],
      suggestedActions: [{ type: 'note', text: 'Invalid action type' }],
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
      model: 'test-model',
      version: 1,
    });

    expect(result.success).toBe(false);
  });

  it('rejects suggested action confidence outside 0..1', () => {
    const result = SummaryArtifactSchema.safeParse({
      artifactId: 'artifact-1',
      source: 'gmail',
      sourceId: 'source-1',
      title: 'A title',
      createdAtISO: '2026-01-01T12:00:00Z',
      summary: 'Summary text',
      highlights: ['One'],
      suggestedActions: [{ type: 'task', text: 'Prepare notes', confidence: 1.2 }],
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
      model: 'test-model',
      version: 1,
    });

    expect(result.success).toBe(false);
  });

  it('rejects suggested action text outside allowed bounds', () => {
    const tooLong = 'a'.repeat(241);
    const tooShortResult = SummaryArtifactSchema.safeParse({
      artifactId: 'artifact-1',
      source: 'gmail',
      sourceId: 'source-1',
      title: 'A title',
      createdAtISO: '2026-01-01T12:00:00Z',
      summary: 'Summary text',
      highlights: ['One'],
      suggestedActions: [{ type: 'task', text: '  ' }],
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
      model: 'test-model',
      version: 1,
    });

    const tooLongResult = SummaryArtifactSchema.safeParse({
      artifactId: 'artifact-1',
      source: 'gmail',
      sourceId: 'source-1',
      title: 'A title',
      createdAtISO: '2026-01-01T12:00:00Z',
      summary: 'Summary text',
      highlights: ['One'],
      suggestedActions: [{ type: 'task', text: tooLong }],
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
      model: 'test-model',
      version: 1,
    });

    expect(tooShortResult.success).toBe(false);
    expect(tooLongResult.success).toBe(false);
  });

  it('accepts null and undefined dueDateISO for suggested actions', () => {
    const withNull = SummaryArtifactSchema.safeParse({
      artifactId: 'artifact-1',
      source: 'gmail',
      sourceId: 'source-1',
      title: 'A title',
      createdAtISO: '2026-01-01T12:00:00Z',
      summary: 'Summary text',
      highlights: ['One'],
      suggestedActions: [
        { type: 'calendar', text: 'Schedule planning session', dueDateISO: null },
        { type: 'reminder', text: 'Review deck tomorrow' },
      ],
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
      model: 'test-model',
      version: 1,
    });

    expect(withNull.success).toBe(true);
  });

  it('accepts suggested action calendarEvent metadata when valid', () => {
    const result = SummaryArtifactSchema.safeParse({
      artifactId: 'artifact-1',
      source: 'gmail',
      sourceId: 'source-1',
      title: 'A title',
      createdAtISO: '2026-01-01T12:00:00Z',
      summary: 'Summary text',
      highlights: ['One'],
      suggestedActions: [
        {
          id: 'act-calendar',
          type: 'calendar',
          text: 'Schedule planning session',
          dueDateISO: '2026-01-04T10:00:00Z',
          status: 'accepted',
          calendarEvent: {
            id: 'event-1',
            htmlLink: 'https://calendar.google.com/calendar/event?eid=abc',
            startISO: '2026-01-04T10:00:00Z',
            endISO: '2026-01-04T11:00:00Z',
            createdAtISO: '2026-01-01T12:01:00Z',
          },
        },
      ],
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
      model: 'test-model',
      version: 1,
    });

    expect(result.success).toBe(true);
  });

  it('rejects malformed suggested action calendarEvent metadata', () => {
    const result = SummaryArtifactSchema.safeParse({
      artifactId: 'artifact-1',
      source: 'gmail',
      sourceId: 'source-1',
      title: 'A title',
      createdAtISO: '2026-01-01T12:00:00Z',
      summary: 'Summary text',
      highlights: ['One'],
      suggestedActions: [
        {
          id: 'act-calendar',
          type: 'calendar',
          text: 'Schedule planning session',
          status: 'accepted',
          calendarEvent: {
            id: '',
            htmlLink: 'not-a-link',
            startISO: 'invalid-date',
            endISO: '2026-01-04T11:00:00Z',
            createdAtISO: '2026-01-01T12:01:00Z',
          },
        },
      ],
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
      model: 'test-model',
      version: 1,
    });

    expect(result.success).toBe(false);
  });

  it('remains backward compatible when calendarEvent is omitted', () => {
    const result = SummaryArtifactSchema.safeParse({
      artifactId: 'artifact-1',
      source: 'gmail',
      sourceId: 'source-1',
      title: 'A title',
      createdAtISO: '2026-01-01T12:00:00Z',
      summary: 'Summary text',
      highlights: ['One'],
      suggestedActions: [
        {
          id: 'act-task',
          type: 'task',
          text: 'Prepare next steps',
          status: 'proposed',
        },
      ],
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
      model: 'test-model',
      version: 1,
    });

    expect(result.success).toBe(true);
  });

  it('accepts admin settings without optional prompt fields', () => {
    const result = AdminSettingsSchema.safeParse({
      type: 'admin_settings',
      version: 1,
      provider: 'stub',
      model: 'gpt-4o-mini',
      systemPrompt: '',
      maxContextItems: 8,
      temperature: 0.2,
      updatedAtISO: '2026-01-01T12:34:56Z',
    });

    expect(result.success).toBe(true);
  });

  it('accepts admin settings with optional prompt fields', () => {
    const result = AdminSettingsSchema.safeParse({
      type: 'admin_settings',
      version: 1,
      provider: 'openai',
      model: 'gpt-4.1-mini',
      systemPrompt: 'System instruction',
      summaryPromptTemplate: 'Summarize {{title}}',
      highlightsPromptTemplate: 'Highlights for {{title}}',
      maxOutputTokens: 256,
      maxContextItems: 8,
      temperature: 0.1,
      updatedAtISO: '2026-01-01T12:34:56Z',
    });

    expect(result.success).toBe(true);
  });

  it('accepts valid ISO strings for selection set timestamps', () => {
    const result = SelectionSetSchema.safeParse({
      id: 'selection-1',
      name: 'Selection Name',
      createdAtISO: '2026-01-01T11:22:33Z',
      updatedAtISO: '2026-01-01T12:34:56Z',
      items: [],
      version: 1,
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
    });

    expect(result.success).toBe(true);
  });

  it('accepts valid synthesis request and defaults', () => {
    const result = SynthesisRequestSchema.safeParse({
      mode: 'briefing',
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.includeEvidence).toBe(false);
    expect(result.success && result.data.saveToTimeline).toBe(true);
    expect(result.success && result.data.limit).toBe(15);
  });

  it('rejects invalid synthesis request bounds', () => {
    const result = SynthesisRequestSchema.safeParse({
      mode: 'open_loops',
      title: 'x',
      artifactIds: Array.from({ length: 51 }).map((_, i) => `a${i}`),
      limit: 31,
    });

    expect(result.success).toBe(false);
  });

  it('accepts synthesis response payload', () => {
    const result = SynthesisResponseSchema.safeParse({
      ok: true,
      synthesis: {
        synthesisId: 'syn-1',
        mode: 'status_report',
        title: 'Weekly status',
        createdAtISO: '2026-01-01T00:00:00Z',
        content: 'Overall status summary',
        keyPoints: ['Point 1'],
      },
      citations: [{ artifactId: 'a1', excerpt: 'Evidence excerpt' }],
      usedArtifactIds: ['a1'],
      savedArtifactId: 'syn-1',
    });

    expect(result.success).toBe(true);
  });

  it('accepts synthesis artifact schema for persisted entries', () => {
    const result = SynthesisArtifactSchema.safeParse({
      kind: 'synthesis',
      id: 'syn-1',
      title: 'Decision synthesis',
      mode: 'decision_log',
      createdAtISO: '2026-01-01T00:00:00Z',
      contentDateISO: '2026-01-01T00:00:00Z',
      sourceArtifactIds: ['a1', 'a2'],
      content: 'Consolidated decision notes',
      citations: [{ artifactId: 'a1', excerpt: 'A cited excerpt' }],
    });

    expect(result.success).toBe(true);
  });

  it('accepts synthesis artifact schema with suggested actions', () => {
    const result = SynthesisArtifactSchema.safeParse({
      kind: 'synthesis',
      id: 'syn-2',
      title: 'Actionable synthesis',
      mode: 'briefing',
      createdAtISO: '2026-01-01T00:00:00Z',
      sourceArtifactIds: ['a1'],
      content: 'Consolidated notes',
      citations: [{ artifactId: 'a1', excerpt: 'A cited excerpt' }],
      suggestedActions: [
        {
          type: 'task',
          text: 'Share status update with stakeholders',
          confidence: 0.7,
          dueDateISO: null,
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('applies suggested action constraints on synthesis artifacts', () => {
    const badType = SynthesisArtifactSchema.safeParse({
      kind: 'synthesis',
      id: 'syn-2',
      title: 'Bad type synthesis',
      mode: 'briefing',
      createdAtISO: '2026-01-01T00:00:00Z',
      sourceArtifactIds: ['a1'],
      content: 'Consolidated notes',
      citations: [{ artifactId: 'a1', excerpt: 'A cited excerpt' }],
      suggestedActions: [{ type: 'note', text: 'Invalid type' }],
    });

    const badConfidence = SynthesisArtifactSchema.safeParse({
      kind: 'synthesis',
      id: 'syn-3',
      title: 'Bad confidence synthesis',
      mode: 'briefing',
      createdAtISO: '2026-01-01T00:00:00Z',
      sourceArtifactIds: ['a1'],
      content: 'Consolidated notes',
      citations: [{ artifactId: 'a1', excerpt: 'A cited excerpt' }],
      suggestedActions: [{ type: 'task', text: 'Valid action text', confidence: 1.5 }],
    });

    expect(badType.success).toBe(false);
    expect(badConfidence.success).toBe(false);
  });

  it('keeps synthesis artifact backward compatible without suggested actions', () => {
    const result = SynthesisArtifactSchema.safeParse({
      kind: 'synthesis',
      id: 'syn-4',
      title: 'No actions synthesis',
      mode: 'briefing',
      createdAtISO: '2026-01-01T00:00:00Z',
      sourceArtifactIds: ['a1'],
      content: 'Consolidated notes',
      citations: [{ artifactId: 'a1', excerpt: 'A cited excerpt' }],
    });

    expect(result.success).toBe(true);
  });
});

describe('structured intelligence schemas', () => {
  it('accepts structured fields on summary artifact', () => {
    const result = SummaryArtifactSchema.safeParse({
      artifactId: 'artifact-structured',
      source: 'drive',
      sourceId: 'source-1',
      title: 'Structured title',
      createdAtISO: '2026-01-01T12:00:00Z',
      summary: 'Summary text',
      highlights: ['One'],
      entities: [{ name: 'Alice', type: 'person' }],
      decisions: [{ text: 'Proceed with launch', confidence: 0.8 }],
      openLoops: [{ text: 'Confirm owner', status: 'open', confidence: 0.6 }],
      risks: [{ text: 'Supplier delay risk', severity: 'high', confidence: 0.7 }],
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
      model: 'test-model',
      version: 1,
    });

    expect(result.success).toBe(true);
  });

  it('rejects invalid structured confidence and short text', () => {
    const badConfidence = SummaryArtifactSchema.safeParse({
      artifactId: 'artifact-structured',
      source: 'drive',
      sourceId: 'source-1',
      title: 'Structured title',
      createdAtISO: '2026-01-01T12:00:00Z',
      summary: 'Summary text',
      highlights: ['One'],
      decisions: [{ text: 'Proceed with launch', confidence: 1.8 }],
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
      model: 'test-model',
      version: 1,
    });

    const badText = SummaryArtifactSchema.safeParse({
      artifactId: 'artifact-structured',
      source: 'drive',
      sourceId: 'source-1',
      title: 'Structured title',
      createdAtISO: '2026-01-01T12:00:00Z',
      summary: 'Summary text',
      highlights: ['One'],
      decisions: [{ text: 'no', confidence: 0.5 }],
      driveFolderId: 'folder-1',
      driveFileId: 'file-1',
      model: 'test-model',
      version: 1,
    });

    expect(badConfidence.success).toBe(false);
    expect(badText.success).toBe(false);
  });

  it('accepts artifact index entries with and without structured rollups', async () => {
    const { ArtifactIndexEntrySchema } = await import('./index.js');
    const legacy = ArtifactIndexEntrySchema.safeParse({
      id: 'a1',
      driveFileId: 'f1',
    });
    const structured = ArtifactIndexEntrySchema.safeParse({
      id: 'a2',
      driveFileId: 'f2',
      entities: [{ name: 'Project Atlas', type: 'project' }],
      decisionsCount: 2,
      openLoopsCount: 3,
      risksCount: 1,
    });

    expect(legacy.success).toBe(true);
    expect(structured.success).toBe(true);
  });
});

describe('phase 5 schemas', () => {
  it('applies defaults for structured query limits', () => {
    const parsed = StructuredQueryRequestSchema.parse({ entity: 'acme' });
    expect(parsed.limitArtifacts).toBe(30);
    expect(parsed.limitItemsPerArtifact).toBe(10);
  });

  it('validates structured query response shape', () => {
    const result = StructuredQueryResponseSchema.safeParse({
      ok: true,
      query: { limitArtifacts: 5, limitItemsPerArtifact: 3 },
      totals: { artifactsMatched: 1, openLoopsMatched: 2, risksMatched: 1, decisionsMatched: 0 },
      results: [{ artifactId: 'a1', matches: { openLoops: [{ text: 'Follow up' }] } }],
    });
    expect(result.success).toBe(true);
  });

  it('validates report export request/response', () => {
    const request = ReportExportRequestSchema.safeParse({
      title: 'Week in review',
      format: 'markdown',
      weekInReview: { dateFromISO: '2026-01-01T00:00:00Z', dateToISO: '2026-01-08T00:00:00Z' },
    });
    const response = ReportExportResponseSchema.safeParse({
      ok: true,
      report: {
        reportId: 'r1',
        title: 'Week in review',
        createdAtISO: '2026-01-08T00:00:00Z',
      },
    });

    expect(request.success).toBe(true);
    expect(response.success).toBe(true);
  });

  it('accepts valid schedule config payload', () => {
    const result = ScheduleConfigSchema.safeParse({
      version: 1,
      updatedAtISO: '2026-01-01T00:00:00Z',
      jobs: [
        {
          id: 'weekly',
          type: 'week_in_review',
          enabled: true,
          schedule: { cron: '0 9 * * MON', timezone: 'Europe/London' },
          params: { includeEvidence: true, exportReport: true, saveToTimeline: false },
          notify: {
            enabled: true,
            to: ['owner@example.com'],
            cc: ['ops@example.com'],
            subjectPrefix: '[Timeline]',
          },
        },
        {
          id: 'alerts',
          type: 'alerts',
          enabled: true,
          schedule: { cron: '*/5 * * * *', timezone: 'UTC' },
          params: { alertTypes: ['new_high_risks'], lookbackDays: 2, dueInDays: 7, riskSeverity: 'high' },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('rejects alert schedule config with out-of-range lookback days', () => {
    const result = ScheduleConfigSchema.safeParse({
      version: 1,
      updatedAtISO: '2026-01-01T00:00:00Z',
      jobs: [
        {
          id: 'alerts',
          type: 'alerts',
          enabled: true,
          schedule: { cron: '*/5 * * * *', timezone: 'UTC' },
          params: { alertTypes: ['new_decisions'], lookbackDays: 60 },
        },
      ],
    });

    expect(result.success).toBe(false);
  });


  it('accepts valid routes notify config with profile references', () => {
    const result = ScheduleConfigSchema.safeParse({
      version: 1,
      updatedAtISO: '2026-01-01T00:00:00Z',
      recipientProfiles: [
        { id: 'p1', to: ['p1@example.com'], filters: { entities: ['acme'] } },
      ],
      jobs: [
        {
          id: 'weekly',
          type: 'week_in_review',
          enabled: true,
          schedule: { cron: '0 9 * * MON', timezone: 'UTC' },
          notify: { enabled: true, mode: 'routes', routes: [{ profileId: 'p1' }] },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('rejects routes config with invalid profile reference', () => {
    const result = ScheduleConfigSchema.safeParse({
      version: 1,
      updatedAtISO: '2026-01-01T00:00:00Z',
      recipientProfiles: [{ id: 'p1', to: ['p1@example.com'], filters: {} }],
      jobs: [{
        id: 'weekly',
        type: 'week_in_review',
        enabled: true,
        schedule: { cron: '0 9 * * MON', timezone: 'UTC' },
        notify: { enabled: true, mode: 'routes', routes: [{ profileId: 'missing' }] },
      }],
    });

    expect(result.success).toBe(false);
  });

  it('parses per-route report generation config with defaults', () => {
    const result = ScheduleConfigSchema.safeParse({
      version: 1,
      updatedAtISO: '2026-01-01T00:00:00Z',
      recipientProfiles: [{ id: 'p1', to: ['p1@example.com'], filters: {} }],
      jobs: [{
        id: 'weekly',
        type: 'week_in_review',
        enabled: true,
        schedule: { cron: '0 9 * * MON', timezone: 'UTC' },
        notify: {
          enabled: true,
          mode: 'routes',
          routes: [{ profileId: 'p1' }],
          generatePerRouteReport: true,
        },
      }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.jobs[0].notify?.generatePerRouteReport).toBe(true);
      expect(result.data.jobs[0].notify?.maxPerRouteReportsPerRun).toBe(5);
    }
  });

  it('rejects per-route report max above bounds', () => {
    const result = ScheduleConfigSchema.safeParse({
      version: 1,
      updatedAtISO: '2026-01-01T00:00:00Z',
      recipientProfiles: [{ id: 'p1', to: ['p1@example.com'], filters: {} }],
      jobs: [{
        id: 'weekly',
        type: 'week_in_review',
        enabled: true,
        schedule: { cron: '0 9 * * MON', timezone: 'UTC' },
        notify: {
          enabled: true,
          mode: 'routes',
          routes: [{ profileId: 'p1' }],
          generatePerRouteReport: true,
          maxPerRouteReportsPerRun: 26,
        },
      }],
    });

    expect(result.success).toBe(false);
  });


  it('rejects notify config with invalid recipient email', () => {
    const result = ScheduleConfigSchema.safeParse({
      version: 1,
      updatedAtISO: '2026-01-01T00:00:00Z',
      jobs: [
        {
          id: 'weekly',
          type: 'week_in_review',
          enabled: true,
          schedule: { cron: '0 9 * * MON', timezone: 'UTC' },
          notify: { enabled: true, to: ['not-an-email'] },
        },
      ],
    });

    expect(result.success).toBe(false);
  });

});
