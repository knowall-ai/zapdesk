'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { X, Copy, Check, Zap, ExternalLink, Loader2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { User } from '@/types';
import { DEFAULT_ZAP_PRESETS } from '@/types';
import Avatar from '../common/Avatar';
import { lightningUri } from '@/lib/lnurl';

interface ZapDialogProps {
  isOpen: boolean;
  onClose: () => void;
  agent: User;
  ticketId: number;
  onZapSent?: (amount: number) => void;
}

interface ZapDialogContentProps {
  onClose: () => void;
  agent: User;
  ticketId: number;
  lightningAddress: string | null;
  isLoadingAddress: boolean;
  onZapSent?: (amount: number) => void;
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
  const [customAmount, setCustomAmount] = useState<string>('');
  const [isCustom, setIsCustom] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedInvoice, setCopiedInvoice] = useState(false);
  const [zapConfirmed, setZapConfirmed] = useState(false);

  // Invoice fetching state
  const [invoice, setInvoice] = useState<string | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

  const actualAmount = isCustom ? parseInt(customAmount) || 0 : selectedAmount;

  // Fetch actual BOLT11 invoice from LNURL-pay endpoint
  const fetchInvoice = useCallback(async () => {
    if (!lightningAddress || actualAmount <= 0) {
      setInvoice(null);
      return;
    }

    // If it's already an LNURL or invoice, use it directly
    if (
      lightningAddress.toLowerCase().startsWith('lnurl') ||
      lightningAddress.toLowerCase().startsWith('ln')
    ) {
      setInvoice(lightningAddress);
      return;
    }

    if (!lightningAddress.includes('@')) {
      setInvoiceError('Invalid Lightning Address');
      return;
    }

    setInvoiceLoading(true);
    setInvoiceError(null);

    try {
      const [name, domain] = lightningAddress.split('@');
      const lnurlpUrl = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`;

      console.log('[ZapDialog] Fetching LNURL-pay metadata from:', lnurlpUrl);
      const metaRes = await fetch(lnurlpUrl);

      if (!metaRes.ok) {
        throw new Error(`LNURL endpoint returned ${metaRes.status}`);
      }

      const meta = await metaRes.json();
      console.log('[ZapDialog] LNURL-pay metadata:', meta);

      if (!meta.callback) {
        throw new Error('No LNURL callback found in response');
      }

      // Convert sats to millisats
      const amountMsat = actualAmount * 1000;

      // Build callback URL with amount
      // Use & if callback already has query params, otherwise use ?
      const separator = meta.callback.includes('?') ? '&' : '?';
      let callbackUrl = `${meta.callback}${separator}amount=${amountMsat}`;

      // Add comment if the service supports it (shows in recipient's wallet)
      if (meta.commentAllowed && meta.commentAllowed > 0) {
        const comment = `DevDesk Ticket #${ticketId}`;
        // Truncate if needed (commentAllowed is max length)
        const truncatedComment = comment.slice(0, meta.commentAllowed);
        callbackUrl += `&comment=${encodeURIComponent(truncatedComment)}`;
        console.log('[ZapDialog] Adding comment to invoice:', truncatedComment);
      }

      console.log('[ZapDialog] Fetching invoice from:', callbackUrl);

      const invRes = await fetch(callbackUrl);
      if (!invRes.ok) {
        throw new Error(`Invoice callback returned ${invRes.status}`);
      }

      const invData = await invRes.json();
      console.log('[ZapDialog] Invoice response:', invData);

      if (!invData.pr) {
        throw new Error('No invoice (pr) received from server');
      }

      const invoiceUri = `lightning:${invData.pr}`;
      console.log('[ZapDialog] Generated invoice URI:', invoiceUri);
      setInvoice(invoiceUri);
    } catch (err) {
      console.error('[ZapDialog] Invoice fetch failed:', err);
      setInvoiceError(err instanceof Error ? err.message : 'Failed to fetch invoice');
      setInvoice(null);
    } finally {
      setInvoiceLoading(false);
    }
  }, [lightningAddress, actualAmount, ticketId]);

  // Fetch invoice when address or amount changes
  useEffect(() => {
    fetchInvoice();
  }, [fetchInvoice]);

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

  const handleConfirmZap = async () => {
    if (!actualAmount || actualAmount <= 0) return;

    setZapConfirmed(true);

    // Call the callback to post a comment on the ticket
    if (onZapSent) {
      console.log('[ZapDialog] Posting zap comment to ticket:', actualAmount, 'sats');
      try {
        await onZapSent(actualAmount);
        console.log('[ZapDialog] Zap comment posted successfully');
      } catch (err) {
        console.error('[ZapDialog] Failed to post zap comment:', err);
      }
    } else {
      console.warn('[ZapDialog] onZapSent callback not provided');
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
          <div
            className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full"
            style={{ backgroundColor: 'rgba(34, 197, 94, 0.2)' }}
          >
            <Check size={32} style={{ color: 'var(--primary)' }} />
          </div>
          <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
            Zap recorded!
          </p>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            {actualAmount.toLocaleString()} sats sent to {agent.displayName}
          </p>
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
                min="1"
              />
              <span
                className="flex items-center px-3 text-sm"
                style={{ color: 'var(--text-muted)' }}
              >
                sats
              </span>
            </div>
          </div>

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
                className="flex h-[160px] w-[160px] flex-col items-center justify-center rounded-lg p-4 text-center"
                style={{ backgroundColor: 'var(--surface-hover)' }}
              >
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {invoiceError}
                </p>
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
                style={{ color: copiedAddress ? 'var(--primary)' : 'var(--text-muted)' }}
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
                  style={{ color: copiedInvoice ? 'var(--primary)' : 'var(--text-muted)' }}
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
        className="relative z-10 w-full max-w-md overflow-hidden rounded-lg"
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
