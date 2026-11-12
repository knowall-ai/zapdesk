// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import TimezoneSelect from './TimezoneSelect';

afterEach(cleanup);

const optionValues = () =>
  Array.from(screen.getByRole('combobox').querySelectorAll('option')).map((o) => o.value);

describe('TimezoneSelect', () => {
  it('offers the full IANA list', () => {
    render(<TimezoneSelect value="UTC" onChange={() => {}} />);
    expect(optionValues().length).toBeGreaterThan(300);
  });

  it('selects the IANA zone for a saved Windows name', () => {
    render(<TimezoneSelect value="GMT Standard Time" onChange={() => {}} />);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('Europe/London');
  });

  it('narrows the list by search but keeps the saved zone', () => {
    render(<TimezoneSelect value="Europe/London" onChange={() => {}} />);
    fireEvent.change(screen.getByLabelText('Search time zones'), {
      target: { value: 'kolkata' },
    });
    expect(optionValues().sort()).toEqual(['Asia/Kolkata', 'Europe/London']);
  });

  it('reports the chosen IANA id', () => {
    const onChange = vi.fn();
    render(<TimezoneSelect value="UTC" onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Asia/Tokyo' } });
    expect(onChange).toHaveBeenCalledWith('Asia/Tokyo');
  });
});
