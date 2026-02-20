import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TimelineChatPageClient from './pageClient';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe('Timeline chat grounding UI', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows grounding banner and deduped citation chips for grounded responses', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          answer: 'Grounded answer.',
          citations: [
            { artifactId: 'a1', excerpt: 'First excerpt', title: 'Artifact One', contentDateISO: '2024-01-02T00:00:00.000Z' },
            { artifactId: 'a1', excerpt: 'Duplicate excerpt', title: 'Artifact One', contentDateISO: '2024-01-02T00:00:00.000Z' },
            { artifactId: 'a2', excerpt: 'Second excerpt', title: 'Artifact Two', contentDateISO: '2024-01-03T00:00:00.000Z' },
          ],
          usedArtifactIds: ['a1', 'a2'],
        }),
      ),
    );

    render(<TimelineChatPageClient />);
    fireEvent.change(screen.getByPlaceholderText(/ask a question/i), { target: { value: 'What happened?' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText(/Grounded in 2 timeline artifacts/i)).toBeInTheDocument();
    const chips = screen.getByLabelText(/citation chips/i).querySelectorAll('button');
    expect(chips).toHaveLength(2);
  });

  it('navigates to timeline artifact when a citation chip is clicked', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          answer: 'Grounded answer.',
          citations: [{ artifactId: 'artifact-123', excerpt: 'Example excerpt', title: 'Artifact Name' }],
          usedArtifactIds: ['artifact-123'],
        }),
      ),
    );

    render(<TimelineChatPageClient />);
    fireEvent.change(screen.getByPlaceholderText(/ask a question/i), { target: { value: 'Find source' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    const chip = await screen.findByRole('button', { name: /Artifact Name/i });
    fireEvent.click(chip);

    expect(mockPush).toHaveBeenCalledWith('/timeline?artifactId=artifact-123');
  });

  it('collapses duplicate citations into one chip', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          answer: 'Answer',
          citations: [
            { artifactId: 'dup-1', excerpt: 'Excerpt one', title: 'One' },
            { artifactId: 'dup-1', excerpt: 'Excerpt two', title: 'One' },
          ],
          usedArtifactIds: ['dup-1'],
        }),
      ),
    );

    render(<TimelineChatPageClient />);
    fireEvent.change(screen.getByPlaceholderText(/ask a question/i), { target: { value: 'duplicates' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText(/Grounded in 1 timeline artifacts/i)).toBeInTheDocument();
    const chips = screen.getByLabelText(/citation chips/i).querySelectorAll('button');
    expect(chips).toHaveLength(1);
  });

  it('does not show grounding banner and shows no-sources panel when no citations exist', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          answer: 'No sources could be found.',
          citations: [],
          usedArtifactIds: [],
        }),
      ),
    );

    render(<TimelineChatPageClient />);
    fireEvent.change(screen.getByPlaceholderText(/ask a question/i), { target: { value: 'unknown' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText(/No timeline artifacts available./i)).toBeInTheDocument();
    expect(screen.queryByText(/Grounded in/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /connect drive sources/i })).toHaveAttribute('href', '/select/drive');
  });
});
