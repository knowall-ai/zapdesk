'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { X, Copy, Check, Zap, ExternalLink, Loader2, AlertTriangle } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { User } from '@/types';
import { DEFAULT_ZAP_PRESETS } from '@/types';
import { defaultZapMessage, zapCommentHtml, zapCommentToPost } from '@/lib/zap-message';
import Avatar from '../common/Avatar';
import { lightningUri } from '@/lib/lnurl';

/** Bounds for a custom zap amount, in whole sats. */
const MIN_ZAP_SATS = 1;

/**
 * How long to wait for the ticket comment before calling the write failed.
 *
 * A write that never settles would otherwise leave the dialog saying it is
 * recording for as long as the page is open, with the sender's message behind
 * a state there is no way out of. Failing is the outcome that keeps the
 * message reachable.
 */
const RECORD_TIMEOUT_MS = 15_000;

/** `promise`, rejecting if it has not settled within `ms`. */
function withinTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Timed out recording the zap')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
const MAX_ZAP_SATS = 1_000_000;

/**
 * Parse the free-text custom amount.
 *
 * The input carries min/max, but the browser only enforces those on form
 * submission and this dialog never submits one — so "1.5" reached
 * `parseInt` and became 1, and a value above the cap went through as typed.
 * Whole sats within the advertised range only; anything else is 0, which
 * every caller already treats as "nothing to send".
 */
function parseZapAmount(raw: string): number {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return 0;
  const value = Number(trimmed);
  return value >= MIN_ZAP_SATS && value <= MAX_ZAP_SATS ? value : 0;
}

interface ZapDialogProps {
  isOpen: boolean;
  onClose: () => void;
  agent: User;
  ticketId: number;
  onZapSent?: (amount: number, message: string) => void | Promise<void>;
}

interface ZapDialogContentProps {
  onClose: () => void;
  agent: User;
  ticketId: number;
  lightningAddress: string | null;
  isLoadingAddress: boolean;
  onZapSent?: (amount: number, message: string) => void | Promise<void>;
}

function ZapDialogContent({
  onClose,
  agent,
  ticketId,
  lightningAddress,
  isLoadingAddress,
  onZapSent,
}: ZapDialogContentProps) {
  const [selectedAmount, setSelectedAmount] = useState<number>(DEFAULT_ZAP_PRESETS[1]);
  /**
   * The note that goes on the ticket, offered rather than imposed (#330).
   *
   * Only what the sender typed is held in state. While they have typed
   * nothing, the note is *derived* from the amount actually in force, so the
   * two can never disagree.
   *
   * Pushing it on each control's handler was wrong, and wrong in a way that
   * could post a false statement: focusing the custom field again after
   * choosing a preset switches the amount back to the custom one without any
   * change event, so the note went on naming the preset while the zap sent the
   * custom amount. Derivation has no such gap.
   */
  const [editedMessage, setEditedMessage] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [isCustom, setIsCustom] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedInvoice, setCopiedInvoice] = useState(false);
  const [zapConfirmed, setZapConfirmed] = useState(false);
  /**
   * The zap went through but recording it on the ticket did not, so the
   * dialog stays open with the message still on screen. Before #330 the note
   * was the app's own wording and could always be written again; now it may
   * be the sender's, and closing on the failure would take it with us.
   */
  const [recordFailed, setRecordFailed] = useState(false);
  /**
   * The write is in flight. `zapConfirmed` turns true the moment the sender
   * confirms, which is before the comment has been posted -- so without this
   * the card said "Zap recorded!" over a pending request, and a sender who
   * closed the dialog in that window lost an edited message to a failure that
   * had not happened yet.
   */
  const [recording, setRecording] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState(false);

  // Invoice fetching state
  const [invoice, setInvoice] = useState<string | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  /** Bumped by "Try again", so a retry runs through the effect and can be aborted. */
  const [invoiceAttempt, setInvoiceAttempt] = useState(0);

  const actualAmount = isCustom ? parseZapAmount(customAmount) : selectedAmount;
  /** What the sender typed, or the note offered for the amount in force. */
  const message = editedMessage ?? defaultZapMessage(agent.displayName, actualAmount);
  /**
   * What is actually posted, as text. Cleared the field, the sender still gets
   * a record of the zap rather than an empty comment -- so an empty field is
   * not what to show them, or copy for them, when the write fails.
   */
  const recorded = zapCommentToPost(message, agent.displayName, actualAmount);

  // Fetch a BOLT11 invoice for the amount. Our own API does the LNURL-pay
  // round trip: the CSP (`connect-src 'self'`) blocks the browser from
  // calling the recipient's Lightning provider directly (#627).
  const fetchInvoice = useCallback(
    async (signal: AbortSignal) => {
      setInvoiceError(null);
      // An aborted request skips its own `finally`, so the early returns must
      // clear loading themselves or the spinner stays on.
      if (!lightningAddress || actualAmount <= 0) {
        setInvoice(null);
        setInvoiceLoading(false);
        return;
      }

      // If it's already an LNURL or invoice, use it directly. A Lightning
      // address can start with "ln" too (lnfan@example.com), so not one with @.
      if (!lightningAddress.includes('@') && lightningAddress.toLowerCase().startsWith('ln')) {
        setInvoice(lightningAddress);
        setInvoiceLoading(false);
        return;
      }

      setInvoice(null);
      setInvoiceLoading(true);

      try {
        const res = await fetch('/api/lightning/invoice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lightningAddress, amountSats: actualAmount, ticketId }),
          signal,
        });
        const data: { invoice?: unknown; error?: unknown } = await res.json().catch(() => ({}));
        if (!res.ok || typeof data.invoice !== 'string') {
          throw new Error(
            typeof data.error === 'string' && data.error
              ? data.error
              : `Couldn't fetch a Lightning invoice (${res.status})`
          );
        }
        if (signal.aborted) return;
        setInvoice(`lightning:${data.invoice}`);
      } catch (err) {
        if (signal.aborted) return;
        console.error('[ZapDialog] Invoice fetch failed:', err);
        setInvoiceError(
          err instanceof Error && err.message ? err.message : "Couldn't fetch a Lightning invoice"
        );
        setInvoice(null);
      } finally {
        if (!signal.aborted) setInvoiceLoading(false);
      }
    },
    [lightningAddress, actualAmount, ticketId]
  );

  // Fetch invoice when address or amount changes, or on "Try again". Each run
  // aborts the request in flight, so a slow reply can't show the wrong QR.
  useEffect(() => {
    const controller = new AbortController();
    fetchInvoice(controller.signal);
    return () => controller.abort();
  }, [fetchInvoice, invoiceAttempt]);

  // QR code value is the fetched invoice
  const qrValue = invoice || '';

  // Generate Lightning URI for wallet deep links (Open in Wallet button)
  const walletUri = useMemo(() => {
    if (!lightningAddress) return '';

    // If we have an invoice, use it for the wallet link too
    if (invoice) return invoice;

    // Fallback to lightning: URI
    return lightningUri(lightningAddress);
  }, [lightningAddress, invoice]);

  const copyAddressToClipboard = async () => {
    if (!lightningAddress) return;
    try {
      await navigator.clipboard.writeText(lightningAddress);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  const copyInvoiceToClipboard = async () => {
    if (!invoice) return;
    // Copy just the invoice part (without lightning: prefix)
    const invoiceStr = invoice.startsWith('lightning:') ? invoice.slice(10) : invoice;
    try {
      await navigator.clipboard.writeText(invoiceStr);
      setCopiedInvoice(true);
      setTimeout(() => setCopiedInvoice(false), 2000);
    } catch (err) {
      console.error('Failed to copy invoice:', err);
    }
  };

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(recorded);
      setCopiedMessage(true);
      setTimeout(() => setCopiedMessage(false), 2000);
    } catch (err) {
      console.error('Failed to copy message:', err);
    }
  };

  const handleConfirmZap = async () => {
    if (!actualAmount || actualAmount <= 0) return;

    setZapConfirmed(true);

    // Persistent confirmation — the in-dialog success card disappears when
    // the dialog auto-closes; a toast survives so the user has a clear
    // signal that the zap landed even after the dialog is gone.
    toast.success(`⚡ Sent ${actualAmount.toLocaleString()} sats to ${agent.displayName}`);

    // Post a comment on the ticket so the zap is recorded in the activity log.
    // If that fails, the payment itself still went through from the wallet's
    // perspective — but surface the comment failure so the user knows it
    // wasn't logged on the ticket and can retry / add it manually.
    if (onZapSent) {
      setRecording(true);
      try {
        await withinTimeout(
          Promise.resolve(
            onZapSent(actualAmount, zapCommentHtml(message, agent.displayName, actualAmount))
          ),
          RECORD_TIMEOUT_MS
        );
      } catch (err) {
        console.error('[ZapDialog] Failed to post zap comment:', err);
        // Said in the dialog rather than in a toast: the dialog is staying
        // open to hold the message, so there is somewhere better to say it,
        // and the caller has already reported the failure of its own write.
        setRecording(false);
        setRecordFailed(true);
        return;
      }
      setRecording(false);
    }

    // Close dialog after brief delay
    setTimeout(() => {
      onClose();
    }, 1500);
  };

  return (
    <div className="p-6">
      {/* Agent info */}
      <div className="mb-6 flex items-center gap-3">
        <Avatar name={agent.displayName} size="md" />
        <div>
          <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
            {agent.displayName}
          </p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Ticket #{ticketId}
          </p>
        </div>
      </div>

      {isLoadingAddress ? (
        <div className="rounded-lg p-6 text-center" style={{ backgroundColor: 'var(--surface)' }}>
          <Loader2
            size={32}
            className="mx-auto mb-2 animate-spin"
            style={{ color: 'var(--text-muted)' }}
          />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Loading Lightning address...
          </p>
        </div>
      ) : !lightningAddress ? (
        <div className="rounded-lg p-4 text-center" style={{ backgroundColor: 'var(--surface)' }}>
          <Zap size={32} className="mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            This agent hasn&apos;t configured a Lightning address yet.
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            Ask them to add one in their profile settings.
          </p>
        </div>
      ) : zapConfirmed ? (
        <div className="rounded-lg p-6 text-center" style={{ backgroundColor: 'var(--surface)' }}>
          {recording ? (
            <>
              <div
                className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full"
                style={{ backgroundColor: 'var(--surface-hover)' }}
              >
                <Loader2
                  size={32}
                  className="animate-spin"
                  style={{ color: 'var(--text-muted)' }}
                />
              </div>
              <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                Recording on the ticket…
              </p>
              <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                {actualAmount.toLocaleString()} sats sent to {agent.displayName}. Leaving now may
                lose your message, so give this a moment.
              </p>
            </>
          ) : recordFailed ? (
            <>
              <div
                className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full"
                style={{ backgroundColor: 'var(--warning-bg)' }}
              >
                <AlertTriangle size={32} style={{ color: 'var(--warning)' }} />
              </div>
              <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                Zap sent, but not recorded
              </p>
              <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                {actualAmount.toLocaleString()} sats went to {agent.displayName}. Adding the comment
                to this ticket failed, so the message is still here — copy it and post it yourself.
              </p>
              <p
                className="mt-3 rounded p-3 text-left text-sm whitespace-pre-wrap"
                style={{ backgroundColor: 'var(--background)', color: 'var(--text-secondary)' }}
              >
                {recorded}
              </p>
              <button
                onClick={handleCopyMessage}
                className="mt-3 inline-flex items-center gap-1.5 text-xs underline"
                style={{ color: 'var(--text-secondary)' }}
              >
                {copiedMessage ? <Check size={12} /> : <Copy size={12} />}
                {copiedMessage ? 'Copied' : 'Copy message'}
              </button>
            </>
          ) : (
            <>
              <div className="bg-success/20 mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full">
                <Check size={32} className="text-success" />
              </div>
              <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                Zap recorded!
              </p>
              <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                {actualAmount.toLocaleString()} sats sent to {agent.displayName}
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Amount selection */}
          <div className="mb-6">
            <label className="mb-2 block text-xs uppercase" style={{ color: 'var(--text-muted)' }}>
              Amount (sats)
            </label>
            <div className="mb-3 grid grid-cols-4 gap-2">
              {DEFAULT_ZAP_PRESETS.map((amount) => (
                <button
                  key={amount}
                  onClick={() => {
                    setSelectedAmount(amount);
                    setIsCustom(false);
                  }}
                  className="zap-amount-btn"
                  style={{
                    backgroundColor:
                      !isCustom && selectedAmount === amount
                        ? 'rgba(247, 147, 26, 0.2)'
                        : 'var(--surface)',
                    borderColor:
                      !isCustom && selectedAmount === amount ? '#f7931a' : 'var(--border)',
                    color:
                      !isCustom && selectedAmount === amount ? '#f7931a' : 'var(--text-primary)',
                  }}
                >
                  {amount.toLocaleString()}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="Custom amount"
                value={customAmount}
                onChange={(e) => {
                  setCustomAmount(e.target.value);
                  setIsCustom(true);
                }}
                onFocus={() => setIsCustom(true)}
                className="input flex-1"
                min={MIN_ZAP_SATS}
                max={MAX_ZAP_SATS}
              />
              <span
                className="flex items-center px-3 text-sm"
                style={{ color: 'var(--text-muted)' }}
              >
                sats
              </span>
            </div>
          </div>

          {/* The note that goes on the ticket (#330).

              Offered, not imposed: the app used to write it and post it unasked,
              in the third person and about the recipient rather than to them.
              While the sender has typed nothing it is derived from the amount in
              force, so the two cannot disagree. Cleared, the zap is still
              recorded -- the comment is its only trace in the activity log.

              Only offered where there is somewhere to post it: the list and
              Kanban views open this dialog without onZapSent and record no
              comment, so a message field there would invite somebody to write
              one and then discard it. */}
          {onZapSent && (
            <div className="mb-6">
              <label
                htmlFor="zap-message"
                className="mb-2 block text-xs uppercase"
                style={{ color: 'var(--text-muted)' }}
              >
                Message on the ticket
              </label>
              <textarea
                id="zap-message"
                value={message}
                onChange={(e) => setEditedMessage(e.target.value)}
                rows={2}
                className="input w-full"
                placeholder="Leave empty to record the zap without a note"
              />
            </div>
          )}

          {/* QR Code */}
          <div
            className="mb-6 flex flex-col items-center rounded-lg p-4"
            style={{ backgroundColor: 'var(--surface)' }}
          >
            {invoiceLoading ? (
              <div className="flex h-[160px] w-[160px] items-center justify-center">
                <Loader2
                  size={32}
                  className="animate-spin"
                  style={{ color: 'var(--text-muted)' }}
                />
              </div>
            ) : invoiceError ? (
              <div
                className="flex min-h-[160px] w-[200px] flex-col items-center justify-center rounded-lg p-4 text-center"
                style={{ backgroundColor: 'var(--surface-hover)' }}
                role="alert"
              >
                <AlertTriangle
                  size={20}
                  className="mb-2 shrink-0"
                  style={{ color: 'var(--text-muted)' }}
                />
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {invoiceError}
                </p>
                <button
                  type="button"
                  onClick={() => setInvoiceAttempt((n) => n + 1)}
                  className="mt-2 text-xs underline"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Try again
                </button>
              </div>
            ) : qrValue ? (
              <div className="mb-3 rounded-lg bg-white p-3">
                <QRCodeSVG value={qrValue} size={160} level="M" />
              </div>
            ) : (
              <div className="flex h-[160px] w-[160px] items-center justify-center">
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Select an amount
                </p>
              </div>
            )}

            <p className="mb-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Scan with a Lightning wallet
            </p>

            {/* Lightning Address */}
            <div className="mb-2 flex w-full items-center gap-2">
              <code
                className="flex-1 truncate rounded px-2 py-1 text-xs"
                style={{ backgroundColor: 'var(--surface-hover)', color: 'var(--text-muted)' }}
              >
                {lightningAddress}
              </code>
              <button
                onClick={copyAddressToClipboard}
                className="shrink-0 rounded p-1.5 transition-colors hover:bg-[var(--surface-hover)]"
                style={{ color: copiedAddress ? 'var(--color-brand)' : 'var(--text-muted)' }}
                title="Copy address"
              >
                {copiedAddress ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>

            {/* Invoice String */}
            {invoice && (
              <div className="flex w-full items-center gap-2">
                <code
                  className="flex-1 truncate rounded px-2 py-1 text-xs"
                  style={{ backgroundColor: 'var(--surface-hover)', color: 'var(--text-muted)' }}
                  title={invoice}
                >
                  {invoice.startsWith('lightning:') ? invoice.slice(10) : invoice}
                </code>
                <button
                  onClick={copyInvoiceToClipboard}
                  className="shrink-0 rounded p-1.5 transition-colors hover:bg-[var(--surface-hover)]"
                  style={{ color: copiedInvoice ? 'var(--color-brand)' : 'var(--text-muted)' }}
                  title="Copy invoice"
                >
                  {copiedInvoice ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <button
              onClick={handleConfirmZap}
              disabled={actualAmount <= 0}
              className="zap-confirm-btn w-full"
              style={{
                opacity: actualAmount <= 0 ? 0.5 : 1,
                cursor: actualAmount <= 0 ? 'not-allowed' : 'pointer',
              }}
            >
              <Zap size={18} />
              Let {agent.displayName.split(' ')[0]} know you&apos;ve sent{' '}
              {actualAmount > 0 ? actualAmount.toLocaleString() : '...'} sats
            </button>
            <a
              href={walletUri}
              className="btn-secondary flex w-full items-center justify-center gap-2"
            >
              <ExternalLink size={16} />
              Open in Wallet
            </a>
          </div>

          <p className="mt-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
            Pay with any Lightning wallet. Your tip will be recorded on the ticket.
          </p>
        </>
      )}
    </div>
  );
}

export default function ZapDialog({ isOpen, onClose, agent, ticketId, onZapSent }: ZapDialogProps) {
  const [lightningAddress, setLightningAddress] = useState<string | null>(null);
  const [isLoadingAddress, setIsLoadingAddress] = useState(false);

  // Fetch agent's lightning address from API when dialog opens
  useEffect(() => {
    if (!isOpen || !agent.email) return;

    const fetchLightningAddress = async () => {
      setIsLoadingAddress(true);
      setLightningAddress(null);
      try {
        // Use email as the user identifier for Microsoft Graph lookup
        const response = await fetch(`/api/lightning/user/${encodeURIComponent(agent.email)}`);
        if (response.ok) {
          const data = await response.json();
          setLightningAddress(data.lightningAddress);
        }
      } catch (error) {
        console.error('Failed to fetch lightning address:', error);
      } finally {
        setIsLoadingAddress(false);
      }
    };

    fetchLightningAddress();
  }, [isOpen, agent.email]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div
        // Bounded and scrollable: the message field made the dialog tall enough
        // to push the confirmation controls off a short phone, where they could
        // not be reached at all. A dialog whose own buttons are unreachable is
        // worse than one that scrolls.
        className="relative z-10 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg"
        style={{ backgroundColor: 'var(--background)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b p-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <Zap size={20} style={{ color: '#f7931a' }} />
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              Send a Zap
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 transition-colors hover:bg-[var(--surface-hover)]"
            style={{ color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Use key to reset content state when dialog opens */}
        <ZapDialogContent
          key={isOpen ? 'open' : 'closed'}
          onClose={onClose}
          agent={agent}
          ticketId={ticketId}
          lightningAddress={lightningAddress}
          isLoadingAddress={isLoadingAddress}
          onZapSent={onZapSent}
        />
      </div>
    </div>
  );
}
