/**
 * @jest-environment node
 */

/* ONE DOOR. Every request to ServiceM8's REST API goes through sm8-http's
   sm8Request, which counts it against the account's limit. A second fetch
   to the API anywhere else would spend the limit where nothing counts it —
   which is how the sync, the screens and the sender each used to find out
   about the others: with a 429. This reads the source, so a new caller that
   reaches for fetch fails here before it ships. */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..", "..", "..");
const DOOR = join("lib", "integrations", "sm8-http.ts");
const OAUTH = join("lib", "integrations", "sm8.ts");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "__tests__" || name === "node_modules") continue;
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

/** A file that knows where the REST API is. */
const knowsTheApi = (text: string) =>
  /api\.servicem8\.com|SM8_API_BASE|api_1\.0/.test(text) || /from\s+["'][^"']*sm8-http["']/.test(text);

/** A call to fetch itself — not a word that merely ends in "fetch". */
const fetchCalls = (text: string) => text.match(/(?<![\w.$])fetch\s*\(/g) ?? [];

describe("the one door to ServiceM8's API", () => {
  const files = sources(SRC).map((path) => ({ rel: relative(SRC, path), text: readFileSync(path, "utf8") }));

  it("finds the source it is guarding", () => {
    expect(files.some((f) => f.rel === DOOR)).toBe(true);
    expect(files.length).toBeGreaterThan(100);
  });

  it("no file but sm8-http calls fetch where the REST API is known", () => {
    const offenders = files
      .filter((f) => f.rel !== DOOR && f.rel !== OAUTH)
      .filter((f) => knowsTheApi(f.text) && fetchCalls(f.text).length > 0)
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("sm8.ts's only fetch is the OAuth token endpoint, on another host", () => {
    const oauth = files.find((f) => f.rel === OAUTH)!.text;
    expect(fetchCalls(oauth)).toHaveLength(1);
    expect(oauth).toMatch(/(?<![\w.$])fetch\(TOKEN_URL,/);
    expect(oauth).toContain('const TOKEN_URL = "https://go.servicem8.com/oauth/access_token";');
  });

  it("the door itself makes exactly one request", () => {
    expect(fetchCalls(files.find((f) => f.rel === DOOR)!.text)).toHaveLength(1);
  });
});
