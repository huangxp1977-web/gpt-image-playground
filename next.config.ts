import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stop `next dev` from writing AGENTS.md / CLAUDE.md into the repo root.
  agentRules: false,
  output: "standalone",
  poweredByHeader: false,
};

export default nextConfig;
