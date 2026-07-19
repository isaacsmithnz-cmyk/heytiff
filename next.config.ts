import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR lets a second dev server (e.g. an agent preview) run
  // alongside the main one — next dev holds an exclusive lock per dist dir.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // the public live link reads pack JSON off disk (packs/server.ts) from a
  // route Vercel's file tracer has no other reason to bundle data/ into
  outputFileTracingIncludes: {
    "/live/[token]": ["./data/packs/**/*"],
  },
};

export default nextConfig;
