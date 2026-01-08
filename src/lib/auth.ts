// NextAuth Configuration for Microsoft Azure AD
import type { NextAuthOptions } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import AzureADProvider from 'next-auth/providers/azure-ad';

// Extend the built-in session types
declare module 'next-auth' {
  interface Session {
    accessToken?: string;
    refreshToken?: string;
    error?: string;
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

export const authOptions: NextAuthOptions = {
  debug: process.env.NODE_ENV === 'development',
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID || 'common',
      authorization: {
        params: {
          scope: AZURE_DEVOPS_SCOPES.join(' '),
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, user }) {
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
      session.accessToken = token.accessToken;
      session.refreshToken = token.refreshToken;
      session.error = token.error;
      if (token.id) {
        session.user.id = token.id;
      }
      if (token.picture) {
        session.user.image = token.picture;
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
  events: {
    async signIn(message) {
      console.log('NextAuth signIn event:', message);
    },
    async signOut(message) {
      console.log('NextAuth signOut event:', message);
    },
    async createUser(message) {
      console.log('NextAuth createUser event:', message);
    },
    async linkAccount(message) {
      console.log('NextAuth linkAccount event:', message);
    },
    async session(message) {
      console.log('NextAuth session event:', message);
    },
  },
  logger: {
    error(code, metadata) {
      console.error('NextAuth error:', code, metadata);
    },
    warn(code) {
      console.warn('NextAuth warning:', code);
    },
    debug(code, metadata) {
      console.log('NextAuth debug:', code, metadata);
    },
  },
};

async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    const url = `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID || 'common'}/oauth2/v2.0/token`;

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

/**
 * Get a Microsoft Graph access token using client credentials flow
 * Uses application permissions (not delegated) to read/write user extensions
 */
export async function getGraphToken(): Promise<string | null> {
  try {
    const url = `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`;

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

    return data.access_token;
  } catch (error) {
    console.error('Error getting Graph token:', error);
    return null;
  }
}

export default authOptions;
