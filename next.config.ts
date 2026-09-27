import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // sharp is used server-side for crops/compositing; keep it out of bundles.
  serverExternalPackages: ["sharp"],
  experimental: {
    // Notes on regenerate prompts and DNA edits are small JSON payloads; photo
    // uploads go straight from the browser to Supabase Storage (never through
    // Server Actions), so the default 1 MB limit only needs a little headroom.
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default withNextIntl(nextConfig);
