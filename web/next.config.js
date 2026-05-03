/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
