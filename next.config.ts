import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR lets a second dev server (e.g. an agent preview) run
  // alongside the main one — next dev holds an exclusive lock per dist dir.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
