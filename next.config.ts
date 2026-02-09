import type { NextConfig } from 'next';
import packageJson from './package.json';

const nextConfig: NextConfig = {
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
