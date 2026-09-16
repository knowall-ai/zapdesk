/**
 * Live verification of the Graph mail credentials.
 *
 * `isEmailConfigured()` only asks whether the settings are *present*. That is
 * not the same question as whether they *work*, and the gap between the two is
 * how inbound email stayed broken for four months: the admin view reported
 * everything configured while every Graph call came back 401, because the app
 * registration's client secret had quietly expired (#421).
 *
 * This asks Entra ID directly and reports what it says.
 */

/** Azure AD error codes worth explaining, rather than passing through raw. */
const KNOWN_CODES: Record<string, { message: string; hint: string }> = {
  AADSTS7000222: {
    message: 'The client secret has expired.',
    hint: 'Create a new secret on the mail app registration (Certificates & secrets), then update MAIL_CLIENT_SECRET.',
  },
  AADSTS7000215: {
    message: 'The client secret is wrong.',
    hint: 'Check MAIL_CLIENT_SECRET is the secret *value*, not the secret ID — the portal shows the value only once, at creation.',
  },
  AADSTS700016: {
    message: 'No application with this client ID exists in the tenant.',
    hint: 'Check MAIL_CLIENT_ID, and that MAIL_TENANT_ID names the tenant the app registration lives in.',
  },
  AADSTS900023: {
    message: 'The tenant could not be found.',
    hint: 'Check MAIL_TENANT_ID is the tenant GUID or domain.',
  },
  AADSTS90002: {
    message: 'The tenant could not be found.',
    hint: 'Check MAIL_TENANT_ID is the tenant GUID or domain.',
  },
};

export interface MailCredentialCheck {
  /** True when Entra ID issued a token. */
  ok: boolean;
  /** Azure AD error code, e.g. `AADSTS7000222`, when one was returned. */
  code?: string;
  /** What is wrong, in a sentence. */
  message?: string;
  /** What to do about it. */
  hint?: string;
}

export interface MailCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

/**
 * Pull the `AADSTSnnnnn` code out of an Entra ID error response.
 *
 * The code is the stable part; the surrounding prose carries trace and
 * correlation IDs that change on every call and are noise in a status view.
 */
export function extractAadCode(errorDescription: string): string | undefined {
  return /\b(AADSTS\d+)\b/.exec(errorDescription)?.[1];
}

/**
 * Turn an Entra ID token error into something an operator can act on.
 *
 * Unrecognised codes pass through with the first sentence of Microsoft's own
 * description, which is the useful part — the rest is trace IDs.
 */
export function describeAadError(errorDescription: string): MailCredentialCheck {
  const code = extractAadCode(errorDescription);
  const known = code ? KNOWN_CODES[code] : undefined;
  if (known) return { ok: false, code, ...known };

  const firstSentence = errorDescription
    .split(/\r?\n/)[0]
    .split(/(?<=\.)\s/)[0]
    .trim();
  return {
    ok: false,
    code,
    message: firstSentence || 'Entra ID rejected the mail credentials.',
    hint: 'Check MAIL_TENANT_ID, MAIL_CLIENT_ID and MAIL_CLIENT_SECRET on the deployed app.',
  };
}

/**
 * Ask Entra ID for a token with the configured mail credentials.
 *
 * Deliberately bypasses the token cache in `email.ts`. A cached token outlives
 * the secret that produced it by up to an hour, so checking through the cache
 * would report a healthy mailbox for an hour after the credentials died —
 * exactly the blind spot this exists to close.
 *
 * Never returns the token or the secret, only whether it worked.
 */
export async function verifyMailCredentials(
  credentials: MailCredentials,
  fetchImpl: typeof fetch = fetch
): Promise<MailCredentialCheck> {
  const { tenantId, clientId, clientSecret } = credentials;

  if (!tenantId || !clientId || !clientSecret) {
    return {
      ok: false,
      message: 'Mail credentials are not configured.',
      hint: 'Set MAIL_TENANT_ID, MAIL_CLIENT_ID and MAIL_CLIENT_SECRET on the deployed app.',
    };
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'client_credentials',
          scope: 'https://graph.microsoft.com/.default',
        }),
        signal: AbortSignal.timeout(10_000),
      }
    );
  } catch (error) {
    return {
      ok: false,
      message: `Could not reach Entra ID: ${error instanceof Error ? error.message : 'unknown error'}`,
      hint: 'Check outbound network access from the app.',
    };
  }

  if (response.ok) return { ok: true };

  // The body is Entra ID's own error, which never echoes the secret back.
  let description = '';
  try {
    const data = (await response.json()) as { error_description?: string; error?: string };
    description = data.error_description || data.error || '';
  } catch {
    description = '';
  }

  if (!description) {
    return {
      ok: false,
      message: `Entra ID returned ${response.status} ${response.statusText}.`,
      hint: 'Check MAIL_TENANT_ID, MAIL_CLIENT_ID and MAIL_CLIENT_SECRET on the deployed app.',
    };
  }

  return describeAadError(description);
}
