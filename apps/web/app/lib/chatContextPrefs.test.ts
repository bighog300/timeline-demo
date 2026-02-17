import { describe, expect, it, beforeEach } from 'vitest';

import { loadChatContextPrefs, saveChatContextPrefs } from './chatContextPrefs';

describe('chatContextPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns defaults when localStorage is empty', () => {
    expect(loadChatContextPrefs()).toEqual({
      mode: 'recent',
      recentCount: 8,
      sourceFilter: 'all',
    });
  });

  it('saves and loads preferences', () => {
    saveChatContextPrefs({
      mode: 'selection_set',
      recentCount: 20,
      sourceFilter: 'gmail',
      selectionSetId: 'set-1',
    });

    expect(loadChatContextPrefs()).toEqual({
      mode: 'selection_set',
      recentCount: 20,
      sourceFilter: 'gmail',
      selectionSetId: 'set-1',
    });
  });
});
