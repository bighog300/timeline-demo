import { describe, expect, it, vi } from 'vitest';

const redirectMock = vi.fn();

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

describe('LegacySelectionSetsPage', () => {
  it('redirects to /saved-searches', async () => {
    const { default: LegacySelectionSetsPage } = await import('./page');
    LegacySelectionSetsPage();
    expect(redirectMock).toHaveBeenCalledWith('/saved-searches');
  });
});
