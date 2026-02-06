import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import EventsPageClient from './pageClient';

describe('EventsPageClient', () => {
  it('renders the heading and shows events after fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 'event-1',
            title: 'Design showcase',
            start: '2025-02-01T10:00:00Z',
            end: '2025-02-01T12:00:00Z',
            venue: 'Main Hall',
            city: 'Austin',
            category: 'Design',
            price_range: '$$',
            url: 'https://example.com/events/design-showcase',
            tags: ['creative', 'community'],
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    vi.stubGlobal('fetch', fetchMock);

    render(<EventsPageClient />);

    expect(
      screen.getByRole('heading', { name: /upcoming experiences/i }),
    ).toBeInTheDocument();

    expect(await screen.findByText(/Design showcase/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/events', expect.any(Object));

    vi.unstubAllGlobals();
  });
});
