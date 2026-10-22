// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import SourceLegend from './SourceLegend';
import { SOURCE_LABELS } from '@/lib/source-colors';

/**
 * A legend that shows a swatch without its meaning explains nothing, so the
 * names are the part worth asserting (#465).
 */
afterEach(cleanup);

describe('SourceLegend', () => {
  it('names both sources when the board shows both', () => {
    render(<SourceLegend sources={['devops', 'github']} />);
    expect(screen.getByText(SOURCE_LABELS.devops)).toBeDefined();
    expect(screen.getByText(SOURCE_LABELS.github)).toBeDefined();
  });

  it('renders nothing when only one source is on the board', () => {
    // With one source there is no distinction to explain.
    const { container } = render(<SourceLegend sources={['devops']} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the board is empty', () => {
    const { container } = render(<SourceLegend sources={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('puts the two in a fixed order, whichever order it is given them in', () => {
    // Otherwise the legend reshuffles as cards arrive, which reads as a change
    // of meaning.
    render(<SourceLegend sources={['github', 'devops']} />);
    const names = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(names).toEqual([SOURCE_LABELS.devops, SOURCE_LABELS.github]);
  });

  it('gives every swatch a name beside it', () => {
    render(<SourceLegend sources={['devops', 'github']} />);
    for (const item of screen.getAllByRole('listitem')) {
      // One decorative swatch, and text that is not empty.
      expect(item.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
      expect(item.textContent?.trim()).toBeTruthy();
    }
  });
});
