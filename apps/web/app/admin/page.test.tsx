import { describe, expect, it, vi } from 'vitest';

const redirectMock = vi.fn();

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

describe('AdminPage', () => {
  it('redirects to /admin/settings', async () => {
    const { default: AdminPage } = await import('./page');
    AdminPage();
    expect(redirectMock).toHaveBeenCalledWith('/admin/settings');
  });
});
