import { z } from 'zod';

const DateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const GoogleCalendarEventResponseSchema = z
  .object({
    id: z.string().min(1),
    htmlLink: z.string().url(),
    start: z
      .object({
        dateTime: z.string().optional(),
        date: z.string().optional(),
      })
      .passthrough(),
    end: z
      .object({
        dateTime: z.string().optional(),
        date: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const CreateCalendarEventInputSchema = z
  .object({
    accessToken: z.string().min(1),
    summary: z.string().trim().min(1),
    description: z.string().optional(),
    startISO: z.string().min(1),
    endISO: z.string().optional(),
  })
  .strict();

const CreateCalendarEventResultSchema = z
  .object({
    id: z.string().min(1),
    htmlLink: z.string().url(),
    startISO: z.string().min(1),
    endISO: z.string().min(1),
  })
  .strict();

export class GoogleCalendarApiError extends Error {
  status: number;

  code: string;

  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'GoogleCalendarApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const addDays = (date: string, days: number) => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

const addHours = (dateTime: string, hours: number) => {
  const parsed = new Date(dateTime);
  parsed.setTime(parsed.getTime() + hours * 60 * 60 * 1000);
  return parsed.toISOString();
};

const resolveStartEnd = (startISO: string, endISO?: string) => {
  const isDateOnly = DateOnlySchema.safeParse(startISO).success;

  if (isDateOnly) {
    const resolvedEnd = endISO && DateOnlySchema.safeParse(endISO).success ? endISO : addDays(startISO, 1);
    return {
      isDateOnly,
      start: { date: startISO },
      end: { date: resolvedEnd },
    };
  }

  const parsedStart = new Date(startISO);
  if (Number.isNaN(parsedStart.getTime())) {
    throw new GoogleCalendarApiError(400, 'invalid_request', 'Invalid event start timestamp.', { startISO });
  }

  let resolvedEnd = endISO;
  if (resolvedEnd) {
    const parsedEnd = new Date(resolvedEnd);
    if (Number.isNaN(parsedEnd.getTime())) {
      throw new GoogleCalendarApiError(400, 'invalid_request', 'Invalid event end timestamp.', { endISO });
    }
  } else {
    resolvedEnd = addHours(startISO, 1);
  }

  return {
    isDateOnly,
    start: { dateTime: startISO },
    end: { dateTime: resolvedEnd },
  };
};

export const createCalendarEvent = async (input: z.input<typeof CreateCalendarEventInputSchema>) => {
  const parsedInput = CreateCalendarEventInputSchema.parse(input);
  const { isDateOnly, start, end } = resolveStartEnd(parsedInput.startISO, parsedInput.endISO);

  const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${parsedInput.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      summary: parsedInput.summary,
      ...(parsedInput.description ? { description: parsedInput.description } : {}),
      start,
      end,
    }),
  });

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    const errorPayload = payload && typeof payload === 'object' ? (payload as { error?: Record<string, unknown> }).error : null;
    const message = typeof errorPayload?.message === 'string' ? errorPayload.message : 'Calendar event creation failed.';
    const code = typeof errorPayload?.status === 'string' ? errorPayload.status : 'calendar_event_failed';
    throw new GoogleCalendarApiError(response.status, code, message, payload);
  }

  const parsedResponse = GoogleCalendarEventResponseSchema.safeParse(payload);
  if (!parsedResponse.success) {
    throw new GoogleCalendarApiError(502, 'calendar_event_failed', 'Calendar API returned malformed response.', {
      issues: parsedResponse.error.issues,
    });
  }

  const startISO = isDateOnly ? parsedResponse.data.start.date : parsedResponse.data.start.dateTime;
  const endISO = isDateOnly ? parsedResponse.data.end.date : parsedResponse.data.end.dateTime;

  if (!startISO || !endISO) {
    throw new GoogleCalendarApiError(502, 'calendar_event_failed', 'Calendar API response missing event times.', payload);
  }

  return CreateCalendarEventResultSchema.parse({
    id: parsedResponse.data.id,
    htmlLink: parsedResponse.data.htmlLink,
    startISO,
    endISO,
  });
};
