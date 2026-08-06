import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/* Where Turbopack treats the project as rooted.

   It infers this by walking up for a lockfile, and warns on every boot when
   the walk is ambiguous. Ours is: git worktrees live at
   `.claude/worktrees/<name>/` INSIDE the main checkout, so the walk finds two
   `package-lock.json` files and has to pick one.

   The root CANNOT simply be this directory. A worktree's `node_modules` is a
   symlink to the main checkout's, and Turbopack refuses a symlink pointing
   outside the root — "Symlink [project]/node_modules is invalid, it points
   out of the filesystem root" — which fails the dev server outright rather
   than merely warning. Tried; it doesn't start.

   So the root is the directory holding the REAL node_modules: itself for a
   normal checkout, the main checkout for a worktree. That is what Turbopack
   was inferring anyway — stating it removes the guess without changing the
   answer. */
const here = path.dirname(fileURLToPath(import.meta.url));
const modules = path.join(here, "node_modules");
const projectRoot = fs.existsSync(modules) ? path.dirname(fs.realpathSync(modules)) : here;

const nextConfig: NextConfig = {
  turbopack: { root: projectRoot },
  /* pdfjs stays OUT of the server bundle.

     The knowledge base extracts PDF text in Node by importing
     `pdfjs-dist/legacy/build/pdf.mjs` — native ESM, no `exports` map, which is
     exactly why the bare subpath resolves at all. Bundling it rewrites that
     import, and the legacy build's runtime feature detection stops matching
     what it is actually running in. Listing it here makes the server `require`
     the real file, which is the path the fixture test proves in a child Node
     process (src/lib/tiff/__tests__/extract.test.ts). */
  serverExternalPackages: ["pdfjs-dist"],
  // NEXT_DIST_DIR lets a second dev server (e.g. an agent preview) run
  // alongside the main one — next dev holds an exclusive lock per dist dir.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  outputFileTracingIncludes: {
    // the public live link reads pack JSON off disk (packs/server.ts) from a
    // route Vercel's file tracer has no other reason to bundle data/ into
    "/live/[token]": ["./data/packs/**/*"],
    /* pdfjs reaches for its worker with a DYNAMIC import, which is invisible
       to static file tracing: `pdf.mjs` gets bundled, `pdf.worker.mjs` does
       not, and the first document to be read dies on "Setting up fake worker
       failed". Even in Node — where there is no worker thread and pdfjs runs
       a "fake worker" on the main one — the module still has to be THERE to
       be imported. Naming the whole build directory covers the cmaps and
       standard-font lookups that follow the same dynamic pattern. */
    "/api/tiff/ingest": ["./node_modules/pdfjs-dist/legacy/build/**/*"],
  },
};

export default nextConfig;
