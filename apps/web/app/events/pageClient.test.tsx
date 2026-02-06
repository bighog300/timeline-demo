import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import EventsPageClient from './pageClient';

describe('EventsPageClient', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  const eventsResponse = [
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
    {
      id: 'event-2',
      title: 'Developer summit',
      start: '2025-03-05T10:00:00Z',
      end: '2025-03-05T12:00:00Z',
      venue: 'Downtown Hub',
      city: 'Denver',
      category: 'Engineering',
      price_range: '$',
      url: 'https://example.com/events/dev-summit',
      tags: ['frontend', 'community'],
    },
  ];

  const mockFetch = () =>
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(eventsResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

  it('renders the heading and shows events after fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([eventsResponse[0]]),
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

  });

  it('filters events by search input', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);

    render(<EventsPageClient />);

    expect(await screen.findByText(/Design showcase/i)).toBeInTheDocument();

    const searchInput = screen.getByLabelText(/search events/i);
    fireEvent.change(searchInput, { target: { value: 'Denver' } });

    await waitFor(() => {
      expect(screen.queryByText(/Design showcase/i)).not.toBeInTheDocument();
      expect(screen.getByText(/Developer summit/i)).toBeInTheDocument();
    });

  });

  it('filters events by category and tag selections', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);

    render(<EventsPageClient />);

    expect(await screen.findByText(/Design showcase/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/category/i), {
      target: { value: 'Engineering' },
    });

    await waitFor(() => {
      expect(screen.queryByText(/Design showcase/i)).not.toBeInTheDocument();
      expect(screen.getByText(/Developer summit/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/tag/i), {
      target: { value: 'community' },
    });

    expect(screen.getByText(/Developer summit/i)).toBeInTheDocument();

  });

  it('clears filters and restores the full list', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);

    render(<EventsPageClient />);

    expect(await screen.findByText(/Design showcase/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/search events/i), {
      target: { value: 'Developer' },
    });

    await waitFor(() => {
      expect(screen.queryByText(/Design showcase/i)).not.toBeInTheDocument();
      expect(screen.getByText(/Developer summit/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /clear filters/i }));

    await waitFor(() => {
      expect(screen.getByText(/Design showcase/i)).toBeInTheDocument();
      expect(screen.getByText(/Developer summit/i)).toBeInTheDocument();
    });

  });
});
