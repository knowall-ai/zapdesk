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
 * Strip the client secret out of text that came from Entra ID.
 *
 * Entra ID has never been seen to echo the secret back, and the old comment
 * here said so and left it at that. But this is upstream text we do not
 * control and it leaves the process in an API response, so the guarantee is
 * worth enforcing rather than assuming.
 *
 * The tenant and client IDs are deliberately left alone. They are public
 * identifiers -- a client ID appears in the OAuth URLs a signed-in user can
 * already read -- and where they survive into the result they are what says
 * *which* app registration failed. Masking them would cost that and protect
 * nothing.
 *
 * They only reach the reader for codes KNOWN_CODES does not cover: a
 * recognised code returns a fixed message and the upstream text is discarded
 * entirely, IDs included. This function is about the unrecognised case.
 */
function withoutSecret(text: string, secret: string): string {
  if (!secret || !text.includes(secret)) return text;
  return text.split(secret).join('***');
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

  let description = '';
  try {
    // Not assumed to be strings. A proxy or gateway in front of Entra ID can
    // return JSON whose `error` is an object or a number, and describeAadError
    // splits the value -- which would throw, and turn a bad credential into a
    // 500 from the route that exists to report bad credentials.
    const data = (await response.json()) as Record<string, unknown>;
    // Empty counts as absent, not as an answer. A gateway returning
    // `{error_description: '', error: 'invalid_client'}` would otherwise
    // select the empty string and throw away the only diagnostic in the body.
    const described = [data.error_description, data.error].find(
      (value): value is string => typeof value === 'string' && value.trim() !== ''
    );
    description = described ?? '';
  } catch {
    description = '';
  }

  description = withoutSecret(description, clientSecret);

  if (!description) {
    return {
      ok: false,
      message: `Entra ID returned ${response.status} ${response.statusText}.`,
      hint: 'Check MAIL_TENANT_ID, MAIL_CLIENT_ID and MAIL_CLIENT_SECRET on the deployed app.',
    };
  }

  return describeAadError(description);
}
