import { SummarizeRequestSchema } from '@timeline/shared';

const parsed = SummarizeRequestSchema.parse({
  items: [{ source: 'gmail', id: 'message-id' }],
});

export const sharedSchemaImportWorks: number = parsed.items.length;
