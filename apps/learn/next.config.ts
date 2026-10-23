import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

// ELEVATE Learn holds training records, so it is strict by default: no third-party requests, no framing, nothing cached.
// The only cross-site thing it accepts is the one-time sign-in handoff POST from ELEVATE (see docs/learn/02-architecture.md).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // the recap videos are read from this private folder at run time, so they must travel with the route that serves them
  outputFileTracingIncludes: { "/api/recaps/[file]": ["./media/recaps/**/*"], "/api/voice/[file]": ["./media/voice/**/*"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cache-Control", value: "no-store" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
