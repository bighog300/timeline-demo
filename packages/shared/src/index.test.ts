import { describe, expect, it } from 'vitest';

import { SourceType, SummaryArtifactSchema } from './index.js';

describe('shared schemas', () => {
  it('exposes timeline zod schemas', () => {
    expect(SourceType.options).toEqual(['gmail', 'drive']);
    expect(SummaryArtifactSchema.shape.title).toBeDefined();
  });
});
