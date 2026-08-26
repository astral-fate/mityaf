/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // React 18+ dev double-invoke creates two MapLibre instances
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
};

export default nextConfig;
