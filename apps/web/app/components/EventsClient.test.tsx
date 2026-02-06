import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import EventsClient from './EventsClient';

describe('EventsClient', () => {
  it('renders upcoming events after loading', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: 'event-1',
              title: 'Planning session',
              start: '2025-01-01T10:00:00Z',
              end: '2025-01-01T11:00:00Z',
              venue: 'Remote',
              city: 'Denver',
              category: 'Music',
              price_range: '$$',
              url: 'https://example.com/events/planning-session',
              tags: ['live', 'community'],
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'calendar-1',
                title: 'Kickoff sync',
                start: '2025-01-02T12:00:00Z',
                end: '2025-01-02T12:30:00Z',
                location: 'Zoom',
              },
              {
                id: 'calendar-2',
                title: 'Demo review',
                start: '2025-01-03T12:00:00Z',
                end: '2025-01-03T12:30:00Z',
                location: 'HQ',
              },
            ],
          }),
          {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
        ),
      );

    vi.stubGlobal('fetch', fetchMock);

    render(<EventsClient />);

    expect(await screen.findByText('Planning session')).toBeInTheDocument();
    expect(screen.getByText('Music')).toBeInTheDocument();
    expect(screen.getByText(/Tags: live, community/)).toBeInTheDocument();
    expect(screen.getByText('2 items')).toBeInTheDocument();
    expect(screen.getByText('Kickoff sync')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/events');
    expect(fetchMock).toHaveBeenCalledWith('/api/calendar');

    vi.unstubAllGlobals();
  });
});
