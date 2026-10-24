// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PullRequestChart } from './PullRequestChart';

// The Live Dashboard's pull request chart: what it says while loading and
// when the period is quiet. The bars themselves are Recharts' business and
// need a measured container, which jsdom does not give.

afterEach(cleanup);

describe('PullRequestChart', () => {
  it('says it is loading before the first response', () => {
    render(<PullRequestChart data={[]} loading />);
    expect(screen.getByText('Loading pull requests…')).toBeTruthy();
  });

  it('says so when every bucket is empty, rather than drawing a blank axis', () => {
    render(
      <PullRequestChart
        data={[
          { key: '2026-10-20', label: '20 Oct', opened: 0, merged: 0 },
          { key: '2026-10-21', label: '21 Oct', opened: 0, merged: 0 },
        ]}
      />
    );
    expect(screen.getByText('No pull requests in this period')).toBeTruthy();
  });

  it('draws the chart once there is something to show', () => {
    const { container } = render(
      <PullRequestChart data={[{ key: '2026-10-20', label: '20 Oct', opened: 2, merged: 1 }]} />
    );
    expect(screen.queryByText('No pull requests in this period')).toBeNull();
    expect(container.querySelector('.recharts-responsive-container')).not.toBeNull();
  });
});
