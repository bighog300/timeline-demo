import type { SelectionSetItem } from './types';

export const selectionItemKey = (item: SelectionSetItem) => `${item.source}:${item.id}`;

export const mergeSelectionItems = (
  existing: SelectionSetItem[],
  incoming: SelectionSetItem[],
): SelectionSetItem[] => {
  const next = new Map<string, SelectionSetItem>();

  existing.forEach((item) => {
    next.set(selectionItemKey(item), item);
  });

  incoming.forEach((item) => {
    const key = selectionItemKey(item);
    if (!next.has(key)) {
      next.set(key, item);
      return;
    }

    const current = next.get(key);
    if (!current) {
      next.set(key, item);
      return;
    }

    next.set(key, {
      ...current,
      title: current.title || item.title,
      dateISO: current.dateISO || item.dateISO,
    });
  });

  return Array.from(next.values());
};
