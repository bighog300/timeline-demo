export type DateRangePreset = '7' | '30' | '90' | 'custom';

export type GmailQueryInput = {
  senders: string[];
  daysBack: DateRangePreset;
  customAfter?: string;
  hasAttachment: boolean;
  freeText: string;
};

const collapseWhitespace = (value: string) => value.trim().replace(/\s+/g, ' ');

const formatAfterDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
};

const sanitizeSender = (sender: string) => collapseWhitespace(sender).toLowerCase();

const sanitizeFreeText = (value: string) => {
  const collapsed = collapseWhitespace(value);
  if (!collapsed) {
    return '';
  }

  if (collapsed.includes('"')) {
    return `"${collapsed.replace(/"/g, '\\"')}"`;
  }

  return collapsed;
};

export const buildGmailQuery = ({
  senders,
  daysBack,
  customAfter,
  hasAttachment,
  freeText,
}: GmailQueryInput) => {
  const parts: string[] = [];

  const uniqueSenders = Array.from(new Set(senders.map(sanitizeSender).filter(Boolean)));
  if (uniqueSenders.length === 1) {
    parts.push(`from:${uniqueSenders[0]}`);
  } else if (uniqueSenders.length > 1) {
    parts.push(`from:(${uniqueSenders.join(' OR ')})`);
  }

  if (daysBack === 'custom') {
    const datePart = customAfter ? formatAfterDate(customAfter) : null;
    if (datePart) {
      parts.push(`after:${datePart}`);
    }
  } else {
    parts.push(`newer_than:${daysBack}d`);
  }

  if (hasAttachment) {
    parts.push('has:attachment');
  }

  const textPart = sanitizeFreeText(freeText);
  if (textPart) {
    parts.push(textPart);
  }

  return parts.join(' ').trim();
};

export type ParsedSender = {
  name: string;
  email: string;
};

const EMPTY_SENDER: ParsedSender = {
  name: '',
  email: '',
};

const isValidEmail = (value: string) => /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value);

export const parseSender = (fromHeader: string): ParsedSender => {
  const value = collapseWhitespace(fromHeader);
  if (!value) {
    return EMPTY_SENDER;
  }

  const bracketMatch = value.match(/^(.*)<([^>]+)>$/);
  if (bracketMatch) {
    const name = bracketMatch[1].trim().replace(/^"|"$/g, '');
    const email = bracketMatch[2].trim().toLowerCase();
    if (!isValidEmail(email)) {
      return EMPTY_SENDER;
    }

    return { name: name || email, email };
  }

  const emailMatch = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (!emailMatch) {
    return EMPTY_SENDER;
  }

  const email = emailMatch[0].toLowerCase();
  const name = value.replace(emailMatch[0], '').replace(/[<>"()]/g, '').trim();
  return { name: name || email, email };
};
