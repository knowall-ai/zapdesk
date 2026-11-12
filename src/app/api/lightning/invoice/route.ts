import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { fetchLnurlInvoice, LnurlError } from '@/lib/lnurl-server';

/** The only fields the body may carry. */
const BODY_KEYS = new Set(['lightningAddress', 'amountSats', 'ticketId']);

/**
 * POST /api/lightning/invoice - Fetch a BOLT11 invoice for a Lightning address
 *
 * Body: `{ lightningAddress: string, amountSats: number, ticketId?: number }`.
 * Returns `{ invoice }` (the bare BOLT11 string) or `{ error }`.
 *
 * Done here rather than in the Zap dialog because the CSP's
 * `connect-src 'self'` blocks the browser from calling the recipient's LNURL
 * service (#627). See `src/lib/lnurl-server.ts` for the SSRF guards.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Approved organisations only (src/lib/tenant-approval.ts)
  if (session.tenantApproved === false) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const unknownKey = Object.keys(body).find((key) => !BODY_KEYS.has(key));
  if (unknownKey) {
    return NextResponse.json({ error: `Unknown field: ${unknownKey}` }, { status: 400 });
  }
  const { lightningAddress, amountSats, ticketId } = body as Record<string, unknown>;

  if (typeof lightningAddress !== 'string' || !lightningAddress.trim()) {
    return NextResponse.json({ error: 'Lightning address is required' }, { status: 400 });
  }
  if (typeof amountSats !== 'number') {
    return NextResponse.json({ error: 'Amount is required' }, { status: 400 });
  }
  if (
    ticketId !== undefined &&
    (typeof ticketId !== 'number' || !Number.isInteger(ticketId) || ticketId <= 0)
  ) {
    return NextResponse.json({ error: 'Invalid ticket ID' }, { status: 400 });
  }

  try {
    const invoice = await fetchLnurlInvoice({
      lightningAddress,
      amountSats,
      comment: ticketId ? `ZapDesk Ticket #${ticketId}` : undefined,
    });
    return NextResponse.json({ invoice });
  } catch (err) {
    if (err instanceof LnurlError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[lightning/invoice] Invoice fetch failed:', err);
    return NextResponse.json({ error: "Couldn't fetch a Lightning invoice" }, { status: 502 });
  }
}
