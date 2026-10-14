import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '../../app/theme/ThemeProvider';
import { THEME_STORAGE_KEY } from '../../lib/theme';
import { ThemeToggle } from './ThemeToggle';

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe('ThemeToggle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts from the theme set by the bootstrap script and toggles + persists it', async () => {
    document.documentElement.dataset.theme = 'light';
    renderToggle();
    const button = screen.getByRole('button', { name: 'Switch to dark theme' });
    await userEvent.click(button);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
  });

  it('still toggles when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    document.documentElement.dataset.theme = 'dark';
    renderToggle();
    await userEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
