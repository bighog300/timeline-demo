import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ChatPageClient from './pageClient';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));


describe('ChatPageClient', () => {
  const storageKey = 'timeline-demo.chat';
  const allowOriginalsKey = 'timeline.chat.allowOriginals';
  const advisorModeKey = 'timeline.chat.advisorMode';
  const synthesisModeKey = 'timeline.chat.synthesisMode';

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
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

  it('stores allow originals, advisor mode, and synthesis mode toggles in sessionStorage and sends flags in payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          reply: 'Done.',
          suggested_actions: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    vi.stubGlobal('fetch', fetchMock);
    render(<ChatPageClient />);

    const toggle = screen.getByRole('checkbox', {
      name: /allow opening originals \(this session\)/i,
    });
    fireEvent.click(toggle);

    expect(sessionStorage.getItem(allowOriginalsKey)).toBe('true');

    const advisorToggle = screen.getByRole('checkbox', {
      name: /advisor mode \(timeline insight\)/i,
    });
    fireEvent.click(advisorToggle);
    expect(sessionStorage.getItem(advisorModeKey)).toBe('false');

    const synthesisToggle = screen.getByRole('checkbox', {
      name: /synthesis mode \(timeline overview\)/i,
    });
    fireEvent.click(synthesisToggle);
    expect(sessionStorage.getItem(synthesisModeKey)).toBe('true');

    const input = screen.getByLabelText(/chat input/i);
    fireEvent.change(input, { target: { value: 'Use originals' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      allowOriginals: boolean;
      advisorMode: boolean;
      synthesisMode: boolean;
    };
    expect(payload.allowOriginals).toBe(true);
    expect(payload.advisorMode).toBe(false);
    expect(payload.synthesisMode).toBe(true);
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


  it('renders selection set and run citations to /selection-sets while keeping summary links', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          reply: 'With citations.',
          citations: [
            { artifactId: 'summary-1', title: 'Launch Plan', kind: 'summary', dateISO: '2024-01-02T00:00:00.000Z' },
            { artifactId: 'set-1', title: 'Saved Search One', kind: 'selection_set', selectionSetId: 'set-1' },
            { artifactId: 'run-1', title: 'Run run-1', kind: 'run', runId: 'run-1' },
          ],
          suggested_actions: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    vi.stubGlobal('fetch', fetchMock);
    render(<ChatPageClient />);

    const input = screen.getByLabelText(/chat input/i);
    fireEvent.change(input, { target: { value: 'show citations' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText(/With citations\./i)).toBeInTheDocument();

    const launchLink = screen.getByRole('link', { name: /Launch Plan/i });
    const setLink = screen.getByRole('link', { name: /Saved Search One/i });
    const runLink = screen.getByRole('link', { name: /Run run-1/i });

    expect(launchLink.getAttribute('href')).toContain('/timeline?artifactId=summary-1');
    expect(setLink.getAttribute('href')).toBe('/selection-sets');
    expect(runLink.getAttribute('href')).toBe('/selection-sets');
  });

  it.each([
    ['not_configured', 'Chat provider isn’t configured. Admin: check provider & model in /admin.'],
    ['invalid_request', 'Chat provider rejected the request (check model/parameters).'],
    ['provider_unauthorized', 'Chat provider credentials are invalid or expired.'],
    ['provider_forbidden', 'Chat provider request was forbidden (check account permissions).'],
    ['rate_limited', 'Chat provider rate limit exceeded. Try again later.'],
    ['upstream_timeout', 'Chat provider timed out. Try again later.'],
    ['upstream_error', 'Chat provider error. Please retry.'],
  ])('shows mapped provider error message for code %s', async (code, expectedMessage) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code, message: 'Raw provider error' },
          requestId: 'req-provider-001',
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    vi.stubGlobal('fetch', fetchMock);
    render(<ChatPageClient />);

    const input = screen.getByLabelText(/chat input/i);
    fireEvent.change(input, { target: { value: 'trigger error' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText(expectedMessage)).toBeInTheDocument();
    expect(screen.getByText(/request id:\s*req-provider-001/i)).toBeInTheDocument();
  });

  it('falls back to generic error for unrecognized code and still shows request ID', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'something_new', message: 'Unknown error code' },
          requestId: 'req-generic-001',
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    vi.stubGlobal('fetch', fetchMock);
    render(<ChatPageClient />);

    const input = screen.getByLabelText(/chat input/i);
    fireEvent.change(input, { target: { value: 'trigger generic error' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('Chat failed (status 500).')).toBeInTheDocument();
    expect(screen.getByText(/request id:\s*req-generic-001/i)).toBeInTheDocument();
  });

  it('shows admin config hint for provider config issue codes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'provider_unauthorized', message: 'bad creds' },
          requestId: 'req-admin-001',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    vi.stubGlobal('fetch', fetchMock);
    render(<ChatPageClient isAdmin />);

    const input = screen.getByLabelText(/chat input/i);
    fireEvent.change(input, { target: { value: 'trigger admin hint' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('Check /admin provider settings.')).toBeInTheDocument();
    expect(screen.queryByText('Contact your administrator.')).not.toBeInTheDocument();
  });

  it('shows non-admin hint for provider config issue codes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'invalid_request', message: 'bad request' },
          requestId: 'req-user-001',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    vi.stubGlobal('fetch', fetchMock);
    render(<ChatPageClient isAdmin={false} />);

    const input = screen.getByLabelText(/chat input/i);
    fireEvent.change(input, { target: { value: 'trigger user hint' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('Contact your administrator.')).toBeInTheDocument();
    expect(screen.queryByText('Check /admin provider settings.')).not.toBeInTheDocument();
  });
});
