import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ChatPageClient from './pageClient';

describe('ChatPageClient', () => {
  it('renders suggestions after a message and populates input on click', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          reply: 'Here is a tailored suggestion.',
          suggested_actions: ['Show me events', 'Help me plan a week'],
          related_events: [{ id: 'event-1', title: 'Launch party' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    vi.stubGlobal('fetch', fetchMock);

    render(<ChatPageClient />);

    const input = screen.getByLabelText(/chat input/i);
    fireEvent.change(input, { target: { value: 'Hello there' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    const suggestion = await screen.findByRole('button', { name: /show me events/i });
    fireEvent.click(suggestion);

    await waitFor(() => {
      expect((input as HTMLInputElement).value).toBe('Show me events');
    });

    vi.unstubAllGlobals();
  });
});
