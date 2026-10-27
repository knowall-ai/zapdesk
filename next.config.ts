import type { NextConfig } from 'next';
import packageJson from './package.json';
import { API_CSP, BASELINE_SECURITY_HEADERS } from './src/lib/security-headers';

const nextConfig: NextConfig = {
  // Don't advertise the framework (Pennie's pen test finding).
  poweredByHeader: false,

  // Baseline security headers on every response, static assets included.
  // Pages also get a nonce-based CSP from src/proxy.ts.
  async headers() {
    return [
      { source: '/:path*', headers: BASELINE_SECURITY_HEADERS },
      { source: '/api/:path*', headers: [{ key: 'Content-Security-Policy', value: API_CSP }] },
    ];
  },

  // Expose app version at build time (from package.json)
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
  },

  // Standalone output for Azure App Service deployment
  // Creates a self-contained build with all dependencies bundled
  output: 'standalone',

  // Allow images from Azure DevOps for user avatars
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'dev.azure.com',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
