import type { NextConfig } from "next";

/**
 * The Postgres driver is optional.
 *
 * src/lib/db/index.ts imports both storage backends so it can choose one
 * at runtime. Without the two settings below, the bundler would insist on
 * resolving `pg` even for someone running on the JSON file who never
 * touches a database — and a missing `pg` would fail the whole build.
 *
 *   serverExternalPackages  keeps it out of the bundle, so it is only
 *                           require()d if the Postgres backend is used
 *   ignoreWarnings          silences the "can't resolve" notice that
 *                           follows, which is expected and harmless here
 *
 * If DATABASE_URL is set and `pg` really is missing, the store says so
 * in plain language rather than failing at build time.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  serverExternalPackages: ["pg"],

  webpack: (config) => {
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { message: /Can't resolve 'pg'/ },
    ];
    return config;
  },
};

export default nextConfig;
