import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ChatPageClient from './pageClient';

const mockRouterRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: mockRouterRefresh }),
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
    mockRouterRefresh.mockReset();
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


  it('renders selection set and run citations to /saved-searches while keeping summary links', async () => {
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
    expect(setLink.getAttribute('href')).toBe('/saved-searches');
    expect(runLink.getAttribute('href')).toBe('/saved-searches');
  });


  it('renders save button, opens prompt, posts context, and shows success link', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            fileId: 'file-1',
            name: 'Recent 8 (all)',
            webViewLink: 'https://drive.google.com/file-1',
            count: 8,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    vi.stubGlobal('fetch', fetchMock);
    render(<ChatPageClient />);

    const button = screen.getByRole('button', { name: /save as new saved selection/i });
    expect(button).toBeInTheDocument();

    fireEvent.click(button);
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/timeline/selections/create-from-context',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    const postCall = fetchMock.mock.calls[0];
    const payload = JSON.parse(String(postCall?.[1]?.body)) as {
      name: string;
      context: { mode: string; recentCount: number; sourceFilter: string };
    };
    expect(payload).toEqual({
      name: 'Recent 8 (all)',
      context: { mode: 'recent', recentCount: 8, sourceFilter: 'all' },
    });

    expect(await screen.findByText(/saved\. manage in saved selections/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /saved selections/i })).toHaveAttribute(
      'href',
      '/saved-selections',
    );
  });



  it('renders Add to existing..., loads list, posts merge route, and shows success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              { fileId: 'sel-1', name: 'Selection One' },
              { fileId: 'sel-2', name: 'Selection Two' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            fileId: 'sel-2',
            name: 'Selection Two',
            count: 10,
            added: 3,
            skippedDuplicates: 1,
            webViewLink: 'https://drive.google.com/sel-2',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    vi.stubGlobal('fetch', fetchMock);
    render(<ChatPageClient />);

    fireEvent.click(screen.getByRole('button', { name: /add to existing\.\.\./i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/timeline/selections/list');
    });

    const picker = await screen.findByLabelText(/saved selection/i);
    fireEvent.change(picker, { target: { value: 'sel-2' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/timeline/selections/sel-2/add-from-context',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    const postCall = fetchMock.mock.calls[1];
    const payload = JSON.parse(String(postCall?.[1]?.body)) as {
      context: { mode: string; recentCount: number; sourceFilter: string };
    };
    expect(payload).toEqual({
      context: { mode: 'recent', recentCount: 8, sourceFilter: 'all' },
    });

    expect(await screen.findByText(/added 3 items to 'selection two' \(1 duplicates skipped\)\./i)).toBeInTheDocument();
    expect(mockRouterRefresh).toHaveBeenCalledTimes(1);
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

  it('renders selection coverage text in selection_set mode', () => {
    localStorage.setItem('timeline.chat.contextPrefs', JSON.stringify({ mode: 'selection_set', recentCount: 8, sourceFilter: 'all', selectionSetId: 'set-1' }));
    render(
      <ChatPageClient
        initialContext={{ mode: 'selection_set', recentCount: 8, sourceFilter: 'all', selectionSetId: 'set-1' }}
        contextStats={{ selectionTotal: 20, summarizedCount: 12, missingCount: 8 }}
      />,
    );

    expect(screen.getByText(/Selection: 20 items · Summarized: 12 · Missing: 8/i)).toBeInTheDocument();
  });

  it('summarize missing posts to API and refreshes on success', async () => {
    localStorage.setItem('timeline.chat.contextPrefs', JSON.stringify({ mode: 'selection_set', recentCount: 8, sourceFilter: 'gmail', selectionSetId: 'set-1' }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sets: [{ driveFileId: 'set-1', title: 'Set One' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ selectionSetId: 'set-1', summarized: 5 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    vi.stubGlobal('fetch', fetchMock);
    render(
      <ChatPageClient
        initialContext={{ mode: 'selection_set', recentCount: 8, sourceFilter: 'gmail', selectionSetId: 'set-1' }}
        contextStats={{ selectionTotal: 9, summarizedCount: 4, missingCount: 5 }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /summarize missing \(up to 5\)/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/timeline/summarize-missing', expect.objectContaining({
        method: 'POST',
      }));
    });

    const call = fetchMock.mock.calls[1];
    const body = JSON.parse(String(call?.[1]?.body)) as { selectionSetId: string; limit: number; sourceFilter: string };
    expect(body).toEqual({ selectionSetId: 'set-1', limit: 5, sourceFilter: 'gmail' });
    await waitFor(() => {
      expect(mockRouterRefresh).toHaveBeenCalled();
    });
  });

  it('shows summarize missing error message on failure', async () => {
    localStorage.setItem('timeline.chat.contextPrefs', JSON.stringify({ mode: 'selection_set', recentCount: 8, sourceFilter: 'all', selectionSetId: 'set-1' }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sets: [{ driveFileId: 'set-1', title: 'Set One' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Selection set missing.' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    vi.stubGlobal('fetch', fetchMock);
    render(
      <ChatPageClient
        initialContext={{ mode: 'selection_set', recentCount: 8, sourceFilter: 'all', selectionSetId: 'set-1' }}
        contextStats={{ selectionTotal: 2, summarizedCount: 1, missingCount: 1 }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /summarize missing \(up to 5\)/i }));

    expect(await screen.findByText(/Selection set missing\./i)).toBeInTheDocument();
    expect(mockRouterRefresh).not.toHaveBeenCalled();
  });
});
