import type { ChatContextMode, ChatRecentCount, ChatSourceFilter } from './chatContextLoader';

export type ChatContextPrefs = {
  mode: ChatContextMode;
  recentCount: ChatRecentCount;
  sourceFilter: ChatSourceFilter;
  selectionSetId?: string;
};

const STORAGE_KEY = 'timeline.chat.contextPrefs';
const DEFAULT_PREFS: ChatContextPrefs = {
  mode: 'recent',
  recentCount: 8,
  sourceFilter: 'all',
};

export const loadChatContextPrefs = (): ChatContextPrefs => {
  if (typeof window === 'undefined') {
    return DEFAULT_PREFS;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return DEFAULT_PREFS;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ChatContextPrefs>;
    const mode = parsed.mode === 'selection_set' ? 'selection_set' : 'recent';
    const recentCount = parsed.recentCount === 20 || parsed.recentCount === 50 ? parsed.recentCount : 8;
    const sourceFilter =
      parsed.sourceFilter === 'gmail' || parsed.sourceFilter === 'drive' ? parsed.sourceFilter : 'all';
    const selectionSetId = typeof parsed.selectionSetId === 'string' ? parsed.selectionSetId : undefined;
    return {
      mode,
      recentCount,
      sourceFilter,
      ...(selectionSetId ? { selectionSetId } : {}),
    };
  } catch {
    return DEFAULT_PREFS;
  }
};

export const saveChatContextPrefs = (prefs: ChatContextPrefs): void => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
};
