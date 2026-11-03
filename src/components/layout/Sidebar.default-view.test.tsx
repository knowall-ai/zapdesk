// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import Sidebar from './Sidebar';
import { STORAGE_KEY } from '@/lib/default-view';

// The star that makes a view the default (#7729). It shipped hidden behind
// `opacity-0 group-hover:opacity-100`, and the report it came back with was
// "can't find where I can star it" -- so what is tested here is that it can
// be found, not only that it works.

vi.mock('next/navigation', () => ({
  usePathname: () => '/tickets',
  useSearchParams: () => new URLSearchParams(''),
}));

describe('Sidebar: choosing the view that opens by default (#7729)', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  const star = (view: string) => screen.getByRole('button', { name: `Open "${view}" by default` });

  it('offers a star on every view that can be the default, without being hovered', () => {
    render(<Sidebar />);
    for (const view of [
      'Your active tickets',
      'Unassigned tickets',
      'All active tickets',
      'Recently updated tickets',
      'Created today',
      'Pending tickets',
      'Recently solved tickets',
    ]) {
      expect(star(view)).toBeTruthy();
    }
  });

  // jsdom applies no Tailwind, so `toBeVisible()` cannot see an opacity class:
  // the control would read as visible either way. This asserts the one thing
  // jsdom can check -- that the hover gate is not back -- because that gate is
  // the whole defect, and nothing else here would catch its return.
  it('does not hide the star behind a hover state', () => {
    render(<Sidebar />);
    const className = star('Your active tickets').className;
    expect(className).not.toContain('opacity-0');
    expect(className).not.toContain('group-hover');
  });

  it('saves the view, and says so through the control rather than only in storage', () => {
    render(<Sidebar />);

    const button = star('Your active tickets');
    expect(button.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(button);

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('your-active');
    const pressed = screen.getByRole('button', {
      name: 'Stop opening "Your active tickets" by default',
    });
    expect(pressed.getAttribute('aria-pressed')).toBe('true');
  });

  it('lets the same control take the default away again', () => {
    render(<Sidebar />);
    fireEvent.click(star('Your active tickets'));
    fireEvent.click(
      screen.getByRole('button', { name: 'Stop opening "Your active tickets" by default' })
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  // Two buttons sat beside the Views heading since the first commit with no
  // handler and no accessible name. They did nothing, and a plus sign is
  // exactly what someone hunting for view options reaches for first.
  //
  // Asserts there is no button at all rather than that each one is named: a
  // named button that still does nothing would pass that, and doing nothing
  // is the half that sent the reporter looking in the wrong place.
  it('puts no button beside the Views heading', () => {
    const { container } = render(<Sidebar />);
    const heading = within(container).getByText('Views');
    const header = heading.parentElement as HTMLElement;
    expect(header.querySelectorAll('button')).toHaveLength(0);
  });
});
