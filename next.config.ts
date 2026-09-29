import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // There is a lockfile in the parent directory too, and without this Next picks that as
  // the workspace root and traces files from outside this project.
  outputFileTracingRoot: import.meta.dirname,
  // `@openrouter/sdk` and `server-only` must stay on the server. Next already keeps them
  // out of the client bundle because they are only imported from a route handler, but
  // marking the SDK external stops the bundler from trying to trace it at all.
  serverExternalPackages: ["@openrouter/sdk"],
};

export default nextConfig;
