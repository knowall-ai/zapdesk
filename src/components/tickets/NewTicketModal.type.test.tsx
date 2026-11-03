// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

/**
 * The type chooser on the Monthly Checkpoint's New Ticket dialog (#7379).
 *
 * This is the dialog the report was about. It offered Bug or Feature, with
 * Feature pre-selected, and then never sent the choice to the server at all --
 * the type went into the ticket's title as a prefix and into a tag, and the
 * server, given no type, substituted Task. So every ticket raised here became
 * a Task in DevOps whatever was picked.
 *
 * The fix is tested through the dialog rather than by reading it: what matters
 * is the request that leaves, and the old version would pass any test that
 * only looked at the controls.
 */

const devOpsGet = vi.fn();
const devOpsPost = vi.fn();

vi.mock('@/hooks', () => ({
  useDevOpsApi: () => ({ get: devOpsGet, post: devOpsPost, hasOrganization: true }),
}));

vi.mock('@/hooks/useClickOutside', () => ({
  useClickOutside: () => ({ current: null }),
}));

import { NewTicketModal } from './NewTicketModal';

const TYPES = [{ name: 'Bug' }, { name: 'Enhancement' }, { name: 'Question' }];

beforeEach(() => {
  vi.clearAllMocks();
  devOpsGet.mockImplementation(async (url: string) => {
    if (url.includes('/workitemtypes')) {
      return { ok: true, json: async () => ({ types: TYPES }) } as Response;
    }
    return { ok: true, json: async () => ({ candidates: [] }) } as Response;
  });
  devOpsPost.mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) } as Response);
});

afterEach(cleanup);

function open(projectName = 'Contoso Ltd') {
  return render(
    <NewTicketModal
      isOpen
      onClose={() => {}}
      projectName={projectName}
      onTicketCreated={() => {}}
    />
  );
}

/** The body of the create request, once one has been made. */
const posted = () => devOpsPost.mock.calls[0]?.[1] as Record<string, unknown> | undefined;

describe('the type chooser', () => {
  it('offers the project own work item types', async () => {
    open();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Enhancement' })).toBeDefined());

    for (const { name } of TYPES) {
      expect(screen.getByRole('option', { name })).toBeDefined();
    }
  });

  // It used to offer these two, which are not the bug / enhancement / question
  // this item asks for -- and Feature is a planning type, not a ticket type.
  it('no longer offers a hardcoded Bug-or-Feature pair', async () => {
    open();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Enhancement' })).toBeDefined());

    expect(screen.queryByRole('option', { name: 'Feature' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Feature' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bug' })).toBeNull();
  });

  it('starts with nothing chosen', async () => {
    open();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Bug' })).toBeDefined());

    expect((screen.getByLabelText(/^type/i) as HTMLSelectElement).value).toBe('');
  });
});

describe('what the dialog sends', () => {
  it('sends the chosen work item type', async () => {
    open();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Bug' })).toBeDefined());

    fireEvent.change(screen.getByLabelText(/^type/i), { target: { value: 'Enhancement' } });
    fireEvent.change(screen.getByPlaceholderText(/ticket subject/i), {
      target: { value: 'Printer jammed' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create ticket/i }));

    await waitFor(() => expect(devOpsPost).toHaveBeenCalled());
    expect(posted()?.workItemType).toBe('Enhancement');
  });

  // The type used to be smuggled into the title because the server was never
  // told it. Now that the work item carries its real type, repeating it in the
  // one field people read most is just noise.
  it('does not put the type in the title', async () => {
    open();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Bug' })).toBeDefined());

    fireEvent.change(screen.getByLabelText(/^type/i), { target: { value: 'Bug' } });
    fireEvent.change(screen.getByPlaceholderText(/ticket subject/i), {
      target: { value: 'Printer jammed' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create ticket/i }));

    await waitFor(() => expect(devOpsPost).toHaveBeenCalled());
    expect(posted()?.title).toBe('Printer jammed');
  });

  it('still tags the ticket with its type', async () => {
    open();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Bug' })).toBeDefined());

    fireEvent.change(screen.getByLabelText(/^type/i), { target: { value: 'Question' } });
    fireEvent.change(screen.getByPlaceholderText(/ticket subject/i), {
      target: { value: 'How do I reset it' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create ticket/i }));

    await waitFor(() => expect(devOpsPost).toHaveBeenCalled());
    expect(posted()?.tags).toEqual(['ticket', 'question']);
  });

  // Never let the server guess: with no type chosen the form does not submit.
  //
  // The select is marked `required`, exactly as the subject input is, so the
  // browser stops the submission before the handler runs. The handler also
  // checks, and sets a message -- a backstop for the case `required` cannot
  // see, as the subject's own whitespace check is. That message is therefore
  // unreachable through the UI, so what is asserted here is the observable
  // thing: nothing is sent.
  it('does not submit with no type chosen', async () => {
    open();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Bug' })).toBeDefined());

    fireEvent.change(screen.getByPlaceholderText(/ticket subject/i), {
      target: { value: 'Printer jammed' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create ticket/i }));

    expect(devOpsPost).not.toHaveBeenCalled();
  });

  it('marks the type as required, which is what stops the submission', async () => {
    open();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Bug' })).toBeDefined());

    expect(screen.getByLabelText(/^type/i)).toHaveProperty('required', true);
  });
});

/**
 * A dialog that cannot read the project's types has nothing to offer in a
 * required control. Saying nothing would leave it unusable with no
 * explanation and no way out.
 */
describe('when the type list cannot be read', () => {
  beforeEach(() => {
    devOpsGet.mockImplementation(async (url: string) => {
      if (url.includes('/workitemtypes')) throw new Error('network down');
      return { ok: true, json: async () => ({ candidates: [] }) } as Response;
    });
  });

  it('says so instead of showing an empty disabled control', async () => {
    open();
    expect(await screen.findByText(/could not be loaded/i)).toBeDefined();
  });

  it('offers another go, and succeeds when the next read works', async () => {
    open();
    const retry = await screen.findByRole('button', { name: /try again/i });

    devOpsGet.mockImplementation(async (url: string) => {
      if (url.includes('/workitemtypes')) {
        return { ok: true, json: async () => ({ types: TYPES }) } as Response;
      }
      return { ok: true, json: async () => ({ candidates: [] }) } as Response;
    });
    fireEvent.click(retry);

    expect(await screen.findByRole('option', { name: 'Enhancement' })).toBeDefined();
    expect(screen.queryByText(/could not be loaded/i)).toBeNull();
  });

  // The read is bounded, so a response that never arrives cannot leave the
  // dialog spinning for as long as the runtime would allow.
  it('bounds the read with a signal', async () => {
    open();
    await screen.findByText(/could not be loaded/i);

    const call = devOpsGet.mock.calls.find(([url]) => String(url).includes('/workitemtypes'));
    expect((call?.[1] as RequestInit | undefined)?.signal).toBeInstanceOf(AbortSignal);
  });
});

/**
 * A 200 with an empty list is not the same as a failure, and it used to be
 * treated as neither: the control was simply disabled with nothing in it and
 * nothing said, which is the dead end the failure path was fixed for.
 */
describe('when the project offers no types', () => {
  beforeEach(() => {
    devOpsGet.mockImplementation(async (url: string) => {
      if (url.includes('/workitemtypes')) {
        return { ok: true, json: async () => ({ types: [] }) } as Response;
      }
      return { ok: true, json: async () => ({ candidates: [] }) } as Response;
    });
  });

  it('says so rather than showing an empty control', async () => {
    open();
    expect(await screen.findByText(/no ticket types/i)).toBeDefined();
    expect(screen.queryByLabelText(/^type/i)).toBeNull();
  });

  // Distinct wording, because the two situations call for different things:
  // one is worth retrying, the other means somebody must configure the project.
  it('does not blame it on a failed load', async () => {
    open();
    await screen.findByText(/no ticket types/i);
    expect(screen.queryByText(/could not be loaded/i)).toBeNull();
  });

  it('still offers another go, in case a type is added', async () => {
    open();
    await screen.findByText(/no ticket types/i);
    const retry = await screen.findByRole('button', { name: /try again/i });

    devOpsGet.mockImplementation(async (url: string) => {
      if (url.includes('/workitemtypes')) {
        return { ok: true, json: async () => ({ types: TYPES }) } as Response;
      }
      return { ok: true, json: async () => ({ candidates: [] }) } as Response;
    });
    fireEvent.click(retry);

    expect(await screen.findByRole('option', { name: 'Bug' })).toBeDefined();
  });
});

describe('across dialog sessions', () => {
  // Pick a type, close, reopen: the next ticket must not inherit the choice
  // merely because the fetched list still contains it (#7379 is about the type
  // being chosen deliberately).
  it('starts again with nothing chosen after a close', async () => {
    const { rerender } = open();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Bug' })).toBeDefined());
    fireEvent.change(screen.getByLabelText(/^type/i), { target: { value: 'Bug' } });
    expect((screen.getByLabelText(/^type/i) as HTMLSelectElement).value).toBe('Bug');

    rerender(
      <NewTicketModal
        isOpen={false}
        onClose={() => {}}
        projectName="Contoso Ltd"
        onTicketCreated={() => {}}
      />
    );
    rerender(
      <NewTicketModal
        isOpen
        onClose={() => {}}
        projectName="Contoso Ltd"
        onTicketCreated={() => {}}
      />
    );

    await waitFor(() => expect(screen.getByRole('option', { name: 'Bug' })).toBeDefined());
    expect((screen.getByLabelText(/^type/i) as HTMLSelectElement).value).toBe('');
  });

  it('clears the choice when the project changes', async () => {
    const { rerender } = open('Contoso Ltd');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Bug' })).toBeDefined());
    fireEvent.change(screen.getByLabelText(/^type/i), { target: { value: 'Bug' } });

    rerender(
      <NewTicketModal isOpen onClose={() => {}} projectName="ABC Inc" onTicketCreated={() => {}} />
    );

    await waitFor(() => expect(screen.getByRole('option', { name: 'Bug' })).toBeDefined());
    expect((screen.getByLabelText(/^type/i) as HTMLSelectElement).value).toBe('');
  });
});
