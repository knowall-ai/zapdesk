// NextAuth Configuration for Microsoft Azure AD
import type { NextAuthOptions } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import AzureADProvider from 'next-auth/providers/azure-ad';
import { isTenantApproved } from '@/lib/tenant-approval';

const isDev = process.env.NODE_ENV === 'development';

// Redact sensitive data from objects before logging
function redactSensitive(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj;

  const sensitiveKeys = [
    'accesstoken',
    'refreshtoken',
    'access_token',
    'refresh_token',
    'secret',
    'password',
    'client_secret',
  ];
  const redacted = { ...obj } as Record<string, unknown>;

  for (const key of Object.keys(redacted)) {
    if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
      redacted[key] = '[REDACTED]';
    } else if (typeof redacted[key] === 'object' && redacted[key] !== null) {
      redacted[key] = redactSensitive(redacted[key]);
    }
  }
  return redacted;
}

// Extend the built-in session types
declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    refreshToken?: string;
    error?: string;
    /** The Entra tenant the user signed in from (the `tid` claim). */
    tenantId?: string;
    /**
     * False when that tenant is not an approved organisation: the session then
     * has no access token, and the person only sees `/not-approved`.
     */
    tenantApproved?: boolean;
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    error?: string;
    id?: string;
    picture?: string;
    tenantId?: string;
  }
}

// Azure AD scopes needed for DevOps access
const AZURE_DEVOPS_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  '499b84ac-1321-427f-aa17-267ca6975798/.default', // Azure DevOps
];

// Note: Graph API uses client credentials flow (application permissions)
// because .default scope can't be combined with resource-specific scopes

/**
 * Where users sign in (#457).
 *
 * With `AZURE_AD_MULTI_TENANT=true` anyone from a work or school tenant whose
 * admin has installed ZapDesk can sign in (`organizations`); the app
 * registration must then be multi-tenant. Otherwise sign-in is limited to
 * `AZURE_AD_TENANT_ID`, as before.
 */
export function signInAuthority(): string {
  if (process.env.AZURE_AD_MULTI_TENANT === 'true') return 'organizations';
  return process.env.AZURE_AD_TENANT_ID || 'common';
}

export function isMultiTenant(): boolean {
  return process.env.AZURE_AD_MULTI_TENANT === 'true';
}

export const authOptions: NextAuthOptions = {
  debug: process.env.NODE_ENV === 'development',
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: signInAuthority(),
      authorization: {
        params: {
          scope: AZURE_DEVOPS_SCOPES.join(' '),
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, user, profile }) {
      try {
        // Initial sign in
        if (account && user) {
          return {
            ...token,
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
            accessTokenExpires: account.expires_at ? account.expires_at * 1000 : undefined,
            id: user.id,
            picture: user.image ?? undefined,
            tenantId: (profile as { tid?: string } | undefined)?.tid,
          } as JWT;
        }

        // Return previous token if the access token has not expired
        if (token.accessTokenExpires && Date.now() < token.accessTokenExpires) {
          return token;
        }

        // Access token expired, try to refresh
        return await refreshAccessToken(token);
      } catch (error) {
        console.error('JWT callback error:', error);
        throw error;
      }
    },
    async session({ session, token }) {
      // Approved organisations only. The tokens stay out of an unapproved
      // session, so no route can call Azure DevOps on its behalf; the proxy
      // (src/proxy.ts) also answers its API calls with 403. Checked on every
      // request, so approving a tenant or removing one applies at once.
      session.tenantApproved = isTenantApproved(token.tenantId);
      if (session.tenantApproved) {
        session.accessToken = token.accessToken;
        session.refreshToken = token.refreshToken;
      }
      session.error = token.error;
      if (token.id) {
        session.user.id = token.id;
      }
      if (token.picture) {
        session.user.image = token.picture;
      }
      if (token.tenantId) {
        session.tenantId = token.tenantId;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60, // 24 hours
  },
  // Event logging - only in development to avoid production log noise
  // Note: Basic auth functionality already works in main; these events help debug OAuth issues
  events: {
    async signIn(message) {
      if (isDev) {
        console.log('NextAuth signIn event:', redactSensitive(message));
      }
    },
    async signOut(message) {
      if (isDev) {
        console.log('NextAuth signOut event:', redactSensitive(message));
      }
    },
    async linkAccount(message) {
      if (isDev) {
        console.log('NextAuth linkAccount event:', redactSensitive(message));
      }
    },
    // Removed: createUser (not used with OAuth) and session (too noisy - fires on every request)
  },
  // Custom logger with sensitive data redaction
  // Errors always logged (needed for production debugging), debug/warn only in dev
  logger: {
    error(code, metadata) {
      console.error('NextAuth error:', code, redactSensitive(metadata));
    },
    warn(code) {
      if (isDev) {
        console.warn('NextAuth warning:', code);
      }
    },
    debug(code, metadata) {
      if (isDev) {
        console.log('NextAuth debug:', code, redactSensitive(metadata));
      }
    },
  },
};

async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    // Refresh against the user's own tenant: with multi-tenant sign-in the
    // authority is `organizations`, which a refresh does not need.
    const url = `https://login.microsoftonline.com/${token.tenantId || signInAuthority()}/oauth2/v2.0/token`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.AZURE_AD_CLIENT_ID!,
        client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken!,
        scope: AZURE_DEVOPS_SCOPES.join(' '),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw data;
    }

    return {
      ...token,
      accessToken: data.access_token,
      accessTokenExpires: Date.now() + data.expires_in * 1000,
      refreshToken: data.refresh_token ?? token.refreshToken,
    };
  } catch (error) {
    console.error('Error refreshing access token:', error);
    return {
      ...token,
      error: 'RefreshAccessTokenError',
    };
  }
}

const graphTokenCache = new Map<string, { token: string; expires: number }>();

/** For tests: forget cached Graph tokens. */
export function clearGraphTokenCache(): void {
  graphTokenCache.clear();
}

/**
 * Get a Microsoft Graph access token using client credentials flow
 * Uses application permissions (not delegated) to read/write user extensions
 *
 * `tenantId` is the signed-in user's tenant (`session.tenantId`). The token
 * must come from that tenant: profile extensions live there, and with
 * multi-tenant sign-in a home-tenant token cannot read another tenant's users
 * (#457). It works once that tenant's admin has installed ZapDesk. Without a
 * tenant, `AZURE_AD_TENANT_ID` is used, as before.
 */
export async function getGraphToken(tenantId?: string | null): Promise<string | null> {
  const tenant = tenantId || process.env.AZURE_AD_TENANT_ID;
  if (!tenant || tenant === 'common' || tenant === 'organizations') {
    console.error('No tenant to get a Graph token for; set AZURE_AD_TENANT_ID');
    return null;
  }

  const cached = graphTokenCache.get(tenant);
  if (cached && Date.now() < cached.expires) return cached.token;

  try {
    const url = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.AZURE_AD_CLIENT_ID!,
        client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
        grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default',
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Failed to get Graph token:', data);
      return null;
    }

    // Reuse until a minute before it expires
    const lifetimeMs = (Number(data.expires_in) || 0) * 1000;
    if (lifetimeMs > 60_000) {
      graphTokenCache.set(tenant, {
        token: data.access_token,
        expires: Date.now() + lifetimeMs - 60_000,
      });
    }

    return data.access_token;
  } catch (error) {
    console.error('Error getting Graph token:', error);
    return null;
  }
}

export default authOptions;
