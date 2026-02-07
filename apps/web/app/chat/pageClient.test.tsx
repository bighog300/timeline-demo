import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ChatPageClient from './pageClient';

describe('ChatPageClient', () => {
  const storageKey = 'timeline-demo.chat';

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders suggestions after a message and populates input on click', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          reply: 'Here is a tailored suggestion.',
          suggested_actions: ['Show priorities', 'Help me plan a week'],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    vi.stubGlobal('fetch', fetchMock);

    render(<ChatPageClient />);

    const input = screen.getByLabelText(/chat input/i);
    fireEvent.change(input, { target: { value: 'Hello there' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    const suggestion = await screen.findByRole('button', { name: /show priorities/i });
    fireEvent.click(suggestion);

    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('Show priorities');
    });

  });

  it('persists chat messages to localStorage and restores them on reload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          reply: 'Saved response.',
          suggested_actions: ['Next steps'],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = render(<ChatPageClient />);

    const input = screen.getByLabelText(/chat input/i);
    fireEvent.change(input, { target: { value: 'Save this message' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText(/Saved response/i)).toBeInTheDocument();

    const stored = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as {
      messages?: Array<{ content: string }>;
    };
    expect(stored.messages?.length).toBeGreaterThan(0);

    unmount();

    render(<ChatPageClient />);

    expect(await screen.findByText(/Saved response/i)).toBeInTheDocument();

  });

  it('clears chat history and localStorage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          reply: 'Temporary response.',
          suggested_actions: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    vi.stubGlobal('fetch', fetchMock);

    render(<ChatPageClient />);

    const input = screen.getByLabelText(/chat input/i);
    fireEvent.change(input, { target: { value: 'Clear this' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText(/Temporary response/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /clear chat/i }));

    await waitFor(() => {
      expect(screen.queryByText(/Temporary response/i)).not.toBeInTheDocument();
    });
    expect(localStorage.getItem(storageKey)).toBeNull();

  });
});
