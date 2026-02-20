import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { resetNextNavigationMocks } from '../../test/nextNavigationMock';
import type { PotentialConflict } from '../lib/timeline/conflicts';
import PotentialConflicts from './PotentialConflicts';

afterEach(() => {
  resetNextNavigationMocks();
  cleanup();
});

const conflict: PotentialConflict = {
  conflictId: 'abc123',
  type: 'date',
  severity: 'high',
  summary: 'These records may conflict on when this event occurred; review sources.',
  artifacts: [
    {
      artifactId: 'art-1',
      title: 'Source one',
      contentDateISO: '2026-01-02T00:00:00.000Z',
      evidenceSnippet: 'contentDateISO: 2026-01-02T00:00:00.000Z',
    },
    {
      artifactId: 'art-2',
      title: 'Source two',
      contentDateISO: '2026-01-08T00:00:00.000Z',
      evidenceSnippet: 'contentDateISO: 2026-01-08T00:00:00.000Z',
    },
  ],
  details: {
    leftValue: '2026-01-02T00:00:00.000Z',
    rightValue: '2026-01-08T00:00:00.000Z',
  },
};

describe('PotentialConflicts', () => {
  it('renders empty state with no conflicts', () => {
    render(<PotentialConflicts conflicts={[]} />);

    expect(screen.getByText(/No potential conflicts detected in the current set./i)).toBeInTheDocument();
  });

  it('renders a conflict with two source links', () => {
    render(<PotentialConflicts conflicts={[conflict]} />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/timeline?artifactId=art-1');
    expect(links[1]).toHaveAttribute('href', '/timeline?artifactId=art-2');
  });

  it('expands details to show values and snippets', () => {
    render(<PotentialConflicts conflicts={[conflict]} />);

    fireEvent.click(screen.getByText(/show details/i));

    expect(screen.getByText('2026-01-02T00:00:00.000Z')).toBeInTheDocument();
    expect(screen.getByText('2026-01-08T00:00:00.000Z')).toBeInTheDocument();
    expect(screen.getByText(/contentDateISO: 2026-01-02/i)).toBeInTheDocument();
  });
});
