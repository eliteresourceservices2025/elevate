import type { NextConfig } from "next";

// Who may show the public careers pages inside a frame: this site itself and the sites listed in CAREERS_EMBED_ORIGINS (the company's
// WordPress site, if it embeds the careers page instead of using the job feed). Everything else is refused (a page that cannot be framed
// cannot be used for click-jacking the apply form). Written out here, not imported, because this file runs before the app is built.
const embedOrigins = (process.env.CAREERS_EMBED_ORIGINS ?? "")
  .split(",")
  .map((part) => part.trim())
  .filter((part) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(part) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(part));

const nextConfig: NextConfig = {
  // The Help center reads its articles, pictures and videos from content/help at run time, so the host must ship those files.
  outputFileTracingIncludes: {
    "/help/**": ["./content/help/**/*"],
    "/api/help/**": ["./content/help/**/*"],
  },
  async headers() {
    return [{ source: "/careers/:path*", headers: [{ key: "Content-Security-Policy", value: `frame-ancestors 'self' ${embedOrigins.join(" ")}`.trim() }] }];
  },
};

export default nextConfig;
