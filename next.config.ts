// Load .env so BASE_PATH (and friends) are available when Next reads this config
// at build time. basePath is inlined into the client bundle at build, so it must
// be set before `next build`.
import "dotenv/config";
import type { NextConfig } from "next";

/**
 * Sub-path to serve the app under, e.g. "/schooldatadog" when reverse-proxied
 * by Caddy at https://<host>/schooldatadog. Leave BASE_PATH unset to serve at
 * the root (the default, used in local dev). With basePath set you do NOT strip
 * the prefix in the proxy — Next expects the full path and emits prefixed links
 * and asset URLs (/schooldatadog/_next/...).
 */
function normalizeBasePath(): string | undefined {
  const raw = process.env.BASE_PATH?.trim().replace(/\/+$/, "");
  if (!raw || raw === "/") return undefined;
  return raw.startsWith("/") ? raw : `/${raw}`;
}

const basePath = normalizeBasePath();

const nextConfig: NextConfig = {
  basePath,
  // Exposed to the browser so client-side fetch() to our route handlers can
  // include the basePath prefix (Next only auto-prefixes router/Link URLs).
  env: { NEXT_PUBLIC_BASE_PATH: basePath ?? "" },
};

export default nextConfig;
