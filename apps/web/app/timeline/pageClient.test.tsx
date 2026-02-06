import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import TimelinePageClient from './pageClient';

describe('TimelinePageClient', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows an empty state when no selections exist', () => {
    render(<TimelinePageClient />);

    expect(screen.getByText(/no items selected yet/i)).toBeInTheDocument();
  });
});
