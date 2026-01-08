import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
