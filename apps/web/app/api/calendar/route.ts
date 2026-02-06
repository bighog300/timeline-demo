type CalendarItem = {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string;
};

const calendarOffsets = [-2, -1, 0, 1, 3, 5, 7];

const calendarTemplates = [
  { title: 'Team standup', location: 'Daily sync room', startHour: 14, durationMinutes: 30 },
  { title: 'Client check-in', location: 'Zoom', startHour: 17, durationMinutes: 45 },
  { title: 'Product demo', location: 'Main conference room', startHour: 19, durationMinutes: 60 },
  { title: 'Design workshop', location: 'Studio B', startHour: 16, durationMinutes: 90 },
  { title: 'Budget review', location: 'Finance HQ', startHour: 20, durationMinutes: 60 },
  { title: 'Marketing sync', location: 'Room 4A', startHour: 15, durationMinutes: 45 },
  { title: 'Ops planning', location: 'War room', startHour: 18, durationMinutes: 60 },
];

const buildIsoDate = (baseDate: Date, offsetDays: number, hourUTC: number) => {
  return new Date(
    Date.UTC(
      baseDate.getUTCFullYear(),
      baseDate.getUTCMonth(),
      baseDate.getUTCDate() + offsetDays,
      hourUTC,
      0,
      0,
    ),
  );
};

const buildCalendarItems = () => {
  const baseDate = new Date();

  return calendarOffsets.map((offset, index) => {
    const template = calendarTemplates[index % calendarTemplates.length];
    const startDate = buildIsoDate(baseDate, offset, template.startHour);
    const endDate = new Date(startDate.getTime() + template.durationMinutes * 60 * 1000);

    return {
      id: `calendar-${index + 1}`,
      title: template.title,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      location: template.location,
    } satisfies CalendarItem;
  });
};

export async function GET() {
  return Response.json({ items: buildCalendarItems() });
}
