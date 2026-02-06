/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const apiServerOrigin = process.env.API_SERVER_ORIGIN;

    if (!apiServerOrigin) {
      return [];
    }

    return [
      {
        source: "/api/:path*",
        destination: `${apiServerOrigin}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
