import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TimelinePageClient from './pageClient';

const setSelections = () => {
  window.localStorage.setItem(
    'timeline.gmailSelections',
    JSON.stringify([
      {
        id: 'msg-1',
        threadId: 'thread-1',
        subject: 'Hello',
        from: 'alice@example.com',
        date: '2024-01-01T00:00:00Z',
        snippet: 'Snippet',
      },
    ]),
  );
};

describe('TimelinePageClient', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows an empty state when no selections exist', () => {
    render(<TimelinePageClient />);

    expect(screen.getByText(/no items selected yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /generate summaries/i })).toBeDisabled();
  });

  it('shows reconnect CTA when summarize returns 401', async () => {
    setSelections();
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'reconnect_required' }), { status: 401 }),
    );

    render(<TimelinePageClient />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /generate summaries/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /generate summaries/i }));

    await waitFor(() => {
      expect(screen.getByText(/reconnect required/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /connect your google account/i })).toBeInTheDocument();
    });
  });

  it('shows provision CTA when summarize returns drive_not_provisioned', async () => {
    setSelections();
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'drive_not_provisioned' }), { status: 400 }),
    );

    render(<TimelinePageClient />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /generate summaries/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /generate summaries/i }));

    await waitFor(() => {
      expect(screen.getByText(/provision a drive folder/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /\/connect/i })).toBeInTheDocument();
    });
  });
});
