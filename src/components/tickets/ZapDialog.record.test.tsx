// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

/**
 * What happens to the sender's message when recording the zap fails (#330,
 * #615 review).
 *
 * Before this work the note was the app's own wording: if the comment failed
 * to post, nothing was lost that could not be written again. Now the note may
 * be the sender's own words, and three things conspired to throw them away --
 * the bridge did not await the callback, the parent swallowed the rejection,
 * and the dialog closed itself 1.5 seconds later regardless. The only signal
 * was a generic toast.
 *
 * So these tests are about the failure path, through the dialog rather than by
 * reading it: the message must still be on screen, and the dialog must still
 * be open to hold it.
 */

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('qrcode.react', () => ({ QRCodeSVG: () => <svg data-testid="qr" /> }));

import ZapDialog from './ZapDialog';

const agent = {
  id: 'u1',
  displayName: 'Alex Morgan',
  email: 'alex@example.test',
  uniqueName: 'alex@example.test',
};

const onClose = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const at = String(url);
      if (at.includes('/api/lightning/user/')) {
        return { ok: true, json: async () => ({ lightningAddress: 'alex@example.test' }) };
      }
      if (at.includes('/.well-known/lnurlp/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ callback: 'https://example.test/lnurl/callback' }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ pr: 'lnbc500n1testinvoice' }) };
    })
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function open(onZapSent?: (amount: number, message: string) => void | Promise<void>) {
  return render(
    <ZapDialog
      isOpen
      onClose={onClose}
      agent={agent}
      ticketId={42}
      {...(onZapSent ? { onZapSent } : {})}
    />
  );
}

/** Wait for the Lightning address, then confirm the zap. */
async function confirm() {
  const button = await screen.findByRole('button', { name: /know you/i });
  fireEvent.click(button);
}

describe('when recording the zap on the ticket fails', () => {
  it('keeps the dialog open rather than closing on a write that never happened', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    open(async () => {
      throw new Error('comment POST failed');
    });

    await confirm();
    await waitFor(() => expect(screen.getByText(/not recorded/i)).toBeDefined());
    await vi.advanceTimersByTimeAsync(3000);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('still shows the message, so the sender can post it themselves', async () => {
    open(async () => {
      throw new Error('comment POST failed');
    });

    await confirm();

    // The wording the dialog offered for 500 sats, still on screen.
    expect(await screen.findByText(/I zapped you 500 sats/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /copy message/i })).toBeDefined();
  });

  it('does not claim the zap was recorded', async () => {
    open(async () => {
      throw new Error('comment POST failed');
    });

    await confirm();

    await screen.findByText(/not recorded/i);
    expect(screen.queryByText('Zap recorded!')).toBeNull();
  });

  it('keeps the sender own words, not the wording it offered', async () => {
    open(async () => {
      throw new Error('comment POST failed');
    });

    const field = await screen.findByLabelText(/message on the ticket/i);
    fireEvent.change(field, { target: { value: 'Thanks for staying late on this.' } });
    await confirm();

    expect(await screen.findByText('Thanks for staying late on this.')).toBeDefined();
  });
});

describe('when recording the zap succeeds', () => {
  it('says so and closes itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    open(async () => {});

    await confirm();
    await waitFor(() => expect(screen.getByText('Zap recorded!')).toBeDefined());
    await vi.advanceTimersByTimeAsync(1600);

    expect(onClose).toHaveBeenCalled();
  });

  // The close timer must not start while the write is still in flight: that is
  // what let the old version close over a pending POST.
  it('waits for the write before starting the close timer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    open(() => pending);

    await confirm();
    await vi.advanceTimersByTimeAsync(3000);
    expect(onClose).not.toHaveBeenCalled();

    release?.();
    await vi.advanceTimersByTimeAsync(1600);
    expect(onClose).toHaveBeenCalled();
  });
});

/**
 * The list and Kanban views open the dialog with no callback: there is
 * nowhere to post a message, so none is offered and none can be lost.
 */
describe('without a comment callback', () => {
  it('offers no message field and closes as before', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    open();

    await screen.findByRole('button', { name: /know you/i });
    expect(screen.queryByLabelText(/message on the ticket/i)).toBeNull();

    await confirm();
    await vi.advanceTimersByTimeAsync(1600);
    expect(onClose).toHaveBeenCalled();
  });
});
