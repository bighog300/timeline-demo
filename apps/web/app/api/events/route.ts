const mockEvents = [
  {
    id: 'evt-1',
    title: 'Project Kickoff',
    start: '2025-02-01T09:00:00Z',
    end: '2025-02-01T10:00:00Z',
    location: 'Zoom',
  },
  {
    id: 'evt-2',
    title: 'Design Review',
    start: '2025-02-03T16:00:00Z',
    end: '2025-02-03T17:00:00Z',
    location: 'Room 3B',
  },
  {
    id: 'evt-3',
    title: 'Launch Retrospective',
    start: '2025-02-05T14:00:00Z',
    end: '2025-02-05T15:00:00Z',
    location: 'Main Auditorium',
  },
];

export async function GET() {
  return Response.json(mockEvents);
}
