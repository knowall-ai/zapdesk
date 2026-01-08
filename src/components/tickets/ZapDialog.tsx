'use client';

import { useState, useMemo } from 'react';
import { X, Copy, Check, Zap, ExternalLink } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { User } from '@/types';
import { DEFAULT_ZAP_PRESETS } from '@/types';
import Avatar from '../common/Avatar';

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
  onZapSent?: (amount: number) => void;
}

function ZapDialogContent({
  onClose,
  agent,
  ticketId,
  lightningAddress,
  onZapSent,
}: ZapDialogContentProps) {
  const [selectedAmount, setSelectedAmount] = useState<number>(DEFAULT_ZAP_PRESETS[1]);
  const [customAmount, setCustomAmount] = useState<string>('');
  const [isCustom, setIsCustom] = useState(false);
  const [copied, setCopied] = useState(false);
  const [zapConfirmed, setZapConfirmed] = useState(false);

  const actualAmount = isCustom ? parseInt(customAmount) || 0 : selectedAmount;

  // Generate Lightning payment URI
  const paymentUri = useMemo(() => {
    if (!lightningAddress) return '';

    // If it's an LNURL, use it directly
    if (lightningAddress.toLowerCase().startsWith('lnurl')) {
      return lightningAddress;
    }

    // For Lightning addresses (user@domain.com format), create a lightning: URI
    return `lightning:${lightningAddress}`;
  }, [lightningAddress]);

  const copyToClipboard = async () => {
    if (!lightningAddress) return;
    try {
      await navigator.clipboard.writeText(lightningAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleConfirmZap = async () => {
    if (!actualAmount || actualAmount <= 0) return;

    setZapConfirmed(true);

    // Call the callback to post a comment
    if (onZapSent) {
      await onZapSent(actualAmount);
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

      {!lightningAddress ? (
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
            <div className="mb-3 rounded-lg bg-white p-3">
              <QRCodeSVG value={paymentUri} size={160} level="M" />
            </div>
            <p className="mb-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Scan with a Lightning wallet
            </p>
            <div className="flex items-center gap-2">
              <code
                className="max-w-[200px] truncate rounded px-2 py-1 text-xs"
                style={{ backgroundColor: 'var(--surface-hover)', color: 'var(--text-muted)' }}
              >
                {lightningAddress}
              </code>
              <button
                onClick={copyToClipboard}
                className="rounded p-1.5 transition-colors hover:bg-[var(--surface-hover)]"
                style={{ color: copied ? 'var(--primary)' : 'var(--text-muted)' }}
                title="Copy address"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
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
              I&apos;ve sent {actualAmount > 0 ? actualAmount.toLocaleString() : '...'} sats
            </button>
            <a
              href={`lightning:${lightningAddress}`}
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
  // Load the agent's lightning address synchronously from localStorage
  const lightningAddress = useMemo(() => {
    if (typeof window === 'undefined' || !agent.email) return null;
    return localStorage.getItem(`devdesk_lightning_${agent.email}`);
  }, [agent.email]);

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
          onZapSent={onZapSent}
        />
      </div>
    </div>
  );
}
