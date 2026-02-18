const SUFFIXES = [
  'ltd',
  'limited',
  'inc',
  'llc',
  'plc',
  'corp',
  'corporation',
  'co',
  'company',
  'gmbh',
  's.a.',
  'srl',
] as const;

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const stripTrailingPunctuation = (value: string) => value.replace(/[\s.,;:!?)]+$/g, '').trim();

export const normalizeEntityName = (name: string): string => {
  let current = stripTrailingPunctuation(name.trim().toLowerCase().replace(/\s+/g, ' '));

  let changed = true;
  while (changed && current) {
    changed = false;
    for (const suffix of SUFFIXES) {
      const pattern = new RegExp(`(?:,\\s*|\\s+)${escapeRegex(suffix)}$`, 'i');
      if (pattern.test(current)) {
        current = stripTrailingPunctuation(current.replace(pattern, ''));
        changed = true;
      }
    }
  }

  return current;
};
