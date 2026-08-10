import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow images from Google profile pictures
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "googleusercontent.com" },
    ],
  },
  // Allow Render backend during dev
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
