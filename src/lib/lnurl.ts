/**
 * LNURL utilities for Lightning Network payments
 * Generates proper LNURL-pay bech32 strings from Lightning Addresses
 */

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function polymod(values: number[]): number {
  const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (let p = 0; p < values.length; ++p) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ values[p];
    for (let i = 0; i < 5; ++i) {
      if ((top >> i) & 1) chk ^= GENERATORS[i];
    }
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (let i = 0; i < hrp.length; ++i) ret.push(hrp.charCodeAt(i) >> 5);
  ret.push(0);
  for (let i = 0; i < hrp.length; ++i) ret.push(hrp.charCodeAt(i) & 31);
  return ret;
}

function createChecksum(hrp: string, data: number[]): number[] {
  const values = hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const mod = polymod(values) ^ 1;
  const ret: number[] = [];
  for (let p = 0; p < 6; ++p) ret.push((mod >> (5 * (5 - p))) & 31);
  return ret;
}

function encodeBech32(hrp: string, data: number[]): string {
  const combined = data.concat(createChecksum(hrp, data));
  let ret = hrp + '1';
  for (let p = 0; p < combined.length; ++p) ret += CHARSET.charAt(combined[p]);
  return ret;
}

function convertBits(data: number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const ret: number[] = [];
  const maxv = (1 << to) - 1;
  for (let p = 0; p < data.length; ++p) {
    acc = (acc << from) | data[p];
    bits += from;
    while (bits >= to) {
      bits -= to;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) ret.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || (acc << (to - bits)) & maxv) {
    return null;
  }
  return ret;
}

/**
 * Convert a Lightning Address (like alice@example.com)
 * into a valid LNURL-pay bech32 string with amount.
 * @param lightningAddress - e.g. 'alice@example.com'
 * @param amountSats - e.g. 1000 sats
 * @returns bech32 LNURL string (starts with 'lnurl1...')
 */
export function lnurlFromLightningAddress(lightningAddress: string, amountSats: number): string {
  if (!lightningAddress || !lightningAddress.includes('@')) {
    throw new Error('Invalid Lightning Address');
  }

  const [name, domain] = lightningAddress.split('@');

  // Convert sats to millisatoshis
  const amountMsat = amountSats * 1000;

  // Construct the LNURL-pay endpoint URL with amount query
  const url = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}?amount=${amountMsat}`;

  // Encode URL as UTF-8 bytes
  const encoder = new TextEncoder();
  const bytes = Array.from(encoder.encode(url.toLowerCase()));

  // Convert bytes (8-bit) to 5-bit words
  const words = convertBits(bytes, 8, 5, true);
  if (!words) throw new Error('convertBits failed');

  // Encode as bech32 with 'lnurl' prefix
  const bech32 = encodeBech32('lnurl', words);
  return bech32.toUpperCase(); // LNURL convention is uppercase
}

/**
 * Generate a Lightning URI for wallet deep links
 * @param lightningAddress - e.g. 'alice@example.com'
 * @returns Lightning URI (e.g. 'lightning:alice@example.com')
 */
export function lightningUri(lightningAddress: string): string {
  return `lightning:${lightningAddress}`;
}
