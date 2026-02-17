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
