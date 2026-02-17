import { describe, expect, it } from 'vitest';

import { renderTemplate } from './promptTemplate';

describe('renderTemplate', () => {
  it('replaces supported prompt variables', () => {
    const rendered = renderTemplate('Title={title}\nText={text}\nSource={source}\nMetadata={metadata}', {
      title: 'Doc title',
      text: 'Body text',
      source: 'gmail',
      metadata: '{"foo":"bar"}',
    });

    expect(rendered).toBe('Title=Doc title\nText=Body text\nSource=gmail\nMetadata={"foo":"bar"}');
  });

  it('leaves unknown tokens unchanged', () => {
    const rendered = renderTemplate('Known {title} Unknown {unknown_token}', { title: 'T' });

    expect(rendered).toBe('Known T Unknown {unknown_token}');
  });

  it('behaves safely for empty template and missing vars', () => {
    expect(renderTemplate('', {})).toBe('');
    expect(renderTemplate('Missing {text}', { title: 'Only title' })).toBe('Missing {text}');
  });
});
