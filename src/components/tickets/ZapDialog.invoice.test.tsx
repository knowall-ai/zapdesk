// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

/**
 * Where the Zap dialog gets its invoice from (#627).
 *
 * The production CSP only allows `connect-src 'self'`, so the dialog must ask
 * our own API for the invoice, never the recipient's LNURL provider. And when
 * that fails it must say so, rather than leave an empty QR area.
 */

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <svg data-testid="qr" data-value={value} />,
}));

import ZapDialog from './ZapDialog';

const agent = {
  id: 'u1',
  displayName: 'Alex Morgan',
  email: 'alex@example.test',
  uniqueName: 'alex@example.test',
};

let invoiceResponse: { ok: boolean; status: number; json: () => Promise<unknown> };
const fetchMock = vi.fn(async (...[url]: [string, RequestInit?]) => {
  if (String(url).includes('/api/lightning/user/')) {
    return { ok: true, json: async () => ({ lightningAddress: 'alex@example.test' }) };
  }
  return invoiceResponse;
});

beforeEach(() => {
  fetchMock.mockClear();
  invoiceResponse = {
    ok: true,
    status: 200,
    json: async () => ({ invoice: 'lnbc500n1testinvoice' }),
  };
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = () => render(<ZapDialog isOpen onClose={vi.fn()} agent={agent} ticketId={42} />);

describe('ZapDialog invoice', () => {
  it('asks our own API for the invoice, and never the LNURL provider', async () => {
    open();

    const qr = await screen.findByTestId('qr');
    expect(qr.getAttribute('data-value')).toBe('lightning:lnbc500n1testinvoice');

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes('/.well-known/lnurlp/'))).toBe(false);
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/lightning/invoice');
    expect(call).toBeDefined();
    expect(JSON.parse(String(call![1]!.body))).toEqual({
      lightningAddress: 'alex@example.test',
      amountSats: 500,
      ticketId: 42,
    });
  });

  it('shows the error instead of an empty QR, and can try again', async () => {
    invoiceResponse = {
      ok: false,
      status: 502,
      json: async () => ({ error: "Couldn't reach example.test" }),
    };
    open();

    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't reach example.test");
    expect(screen.queryByTestId('qr')).toBeNull();

    invoiceResponse = {
      ok: true,
      status: 200,
      json: async () => ({ invoice: 'lnbc500n1testinvoice' }),
    };
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(screen.getByTestId('qr')).toBeDefined());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
