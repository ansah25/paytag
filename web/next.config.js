const { securityHeaders } = require('./security-headers');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders(process.env) }];
  },
  // The app doesn't use next/image. Turning the optimizer off removes the
  // /_next/image endpoint that several Next 14 advisories target.
  images: { unoptimized: true },
  webpack: (config) => {
    // Silence optional native/dev deps pulled in transitively by wagmi connectors
    config.externals.push(
      'pino-pretty',
      'lokijs',
      'encoding',
      '@react-native-async-storage/async-storage',
    );
    return config;
  },
};

module.exports = nextConfig;
