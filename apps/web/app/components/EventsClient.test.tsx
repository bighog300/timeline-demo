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
              start: '2025-01-01',
              end: '2025-01-01',
              location: 'Remote',
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ id: 'calendar-1' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    vi.stubGlobal('fetch', fetchMock);

    render(<EventsClient />);

    expect(await screen.findByText('Planning session')).toBeInTheDocument();
    expect(screen.getByText('1 items')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/events');
    expect(fetchMock).toHaveBeenCalledWith('/api/calendar');

    vi.unstubAllGlobals();
  });
});
