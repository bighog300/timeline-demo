import { describe, expect, it } from 'vitest';

import {
  AdminSettingsSchema,
  SelectionSetSchema,
  SourceType,
  SummaryArtifactSchema,
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
});
