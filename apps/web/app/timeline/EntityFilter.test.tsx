import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import EntityFilter from './EntityFilter';

const replaceMock = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => mockSearchParams,
}));

describe('EntityFilter', () => {
  beforeEach(() => {
    replaceMock.mockReset();
    mockSearchParams = new URLSearchParams();
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });


  it('renders entity list with counts', () => {
    render(
      <EntityFilter
        entities={['Acme Corp', 'Alice Johnson']}
        counts={{ 'Acme Corp': 3, 'Alice Johnson': 1 }}
        value={null}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('selecting entity updates router.replace with entity param', () => {
    const onChange = vi.fn();
    render(
      <EntityFilter
        entities={['Acme Corp']}
        counts={{ 'Acme Corp': 2 }}
        value={null}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /acme corp/i }));

    expect(onChange).toHaveBeenCalledWith('Acme Corp');
    expect(replaceMock).toHaveBeenCalledWith('/timeline?entity=Acme+Corp');
  });

  it('clear resets param and calls onChange(null)', () => {
    const onChange = vi.fn();
    mockSearchParams = new URLSearchParams('entity=Acme+Corp&from=select');

    render(
      <EntityFilter
        entities={['Acme Corp']}
        counts={{ 'Acme Corp': 2 }}
        value="Acme Corp"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /clear entity filter/i }));

    expect(onChange).toHaveBeenCalledWith(null);
    expect(replaceMock).toHaveBeenCalledWith('/timeline?from=select');
  });
});
