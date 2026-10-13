/**
 * @jest-environment node
 *
 * The HQ data pages against EVERY pack actually shipped in data/packs — not a
 * fixture — because the bugs this guards were single-brand assumptions left
 * from when Mitsubishi Electric was the only pack: the first brand row taken
 * as the brand, and "VRF (City Multi)" printed over every brand's VRF. VRF is
 * the type for every brand; "VRV" is Daikin's own name and "City Multi"
 * Mitsubishi Electric's, and each comes from its own pack's brands.json.
 * The guard, the database and the actions are stubbed; the packs are real.
 */

import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

jest.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  useRouter: () => ({ refresh: () => {} }),
}));
jest.mock("@/lib/hq/guard", () => ({
  requireHqPage: jest.fn(async () => ({ email: "hq@heytiff.com", userId: "auth0|hq" })),
}));
jest.mock("@/lib/studio/packs/overrides-server", () => ({ fetchOverrides: jest.fn(async () => []) }));
jest.mock("@/app/actions/hq-overrides", () => ({ saveOverride: jest.fn(), clearOverride: jest.fn() }));
jest.mock("@/app/actions/hq-watchlist", () => ({ addWatchItem: jest.fn(), resolveWatchItem: jest.fn() }));

/* the change log's rows, one per brand id; the watch-list query reads none */
let logRows: Record<string, unknown>[] = [];
jest.mock("@/lib/supabase-server", () => {
  const chain = (rows: () => unknown[]) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "order", "limit"]) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(ok);
    return q;
  };
  return {
    supabaseAdmin: {
      from: (table: string) => chain(() => (table === "pack_override_log" ? logRows : [])),
    },
  };
});

import HqDataPage from "../data/page";
import HqBrandPage from "../data/[brand]/page";
import HqChangesPage from "../changes/page";
import { latestPackRefs } from "@/lib/hq/packs";
import { loadInstalledPack } from "@/lib/studio/packs/server";

/** the markup's text, tags dropped and entities the page uses decoded */
const text = (el: ReactElement) =>
  renderToStaticMarkup(el)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&rsquo;/g, "’")
    .replace(/\s+/g, " ");

async function shipped() {
  const out: { id: string; name: string; vrfOwn: string | null }[] = [];
  for (const r of await latestPackRefs()) {
    const { pack } = await loadInstalledPack(r.brand, r.version);
    const row = pack.brands.find((b) => b.id === r.brand)!;
    out.push({ id: r.brand, name: row.name, vrfOwn: row.system_names?.vrf ?? null });
  }
  return out;
}

describe("/hq/data with every shipped pack", () => {
  it("shows one card per brand, each under its own name and linking to its own page", async () => {
    const brands = await shipped();
    expect(brands.length).toBeGreaterThan(1);
    const html = renderToStaticMarkup(await HqDataPage());
    for (const b of brands) {
      expect(html).toContain(`href="/hq/data/${b.id}"`);
      expect(html).toContain(`<span class="hq-brandcard-name">${b.name}</span>`);
    }
    expect(html.match(/class="hq-brandcard"/g)).toHaveLength(brands.length);
  });
});

describe("/hq/data/[brand] for every shipped pack", () => {
  it("titles each brand by its own row and names its VRF its own way, or plain VRF", async () => {
    for (const b of await shipped()) {
      const page = text(await HqBrandPage({ params: Promise.resolve({ brand: b.id }) }));
      expect({ brand: b.id, title: page.includes(` ${b.name} `) }).toEqual({ brand: b.id, title: true });

      // the third tab: the generic type, with the brand's own name only if it has one
      const vrfTab = !b.vrfOwn ? "VRF" : /\bVRF\b/i.test(b.vrfOwn) ? b.vrfOwn : `VRF (${b.vrfOwn})`;
      expect({ brand: b.id, tab: page.includes(` ${vrfTab} `) }).toEqual({ brand: b.id, tab: true });
      expect(page).not.toContain("VRF / VRV");
    }
  });

  it("never prints one brand's trademark on another brand's page", async () => {
    for (const b of await shipped()) {
      const page = text(await HqBrandPage({ params: Promise.resolve({ brand: b.id }) }));
      if (b.id !== "daikin") expect({ brand: b.id, vrv: /\bVRV\b/.test(page) }).toEqual({ brand: b.id, vrv: false });
      if (b.id !== "mitsubishi-electric")
        expect({ brand: b.id, cityMulti: /City Multi/i.test(page) }).toEqual({ brand: b.id, cityMulti: false });
    }
  });

  it("reads Daikin's VRV and Mitsubishi Electric's City Multi from their packs", async () => {
    const daikin = text(await HqBrandPage({ params: Promise.resolve({ brand: "daikin" }) }));
    expect(daikin).toContain(" VRF (VRV) ");
    const me = text(await HqBrandPage({ params: Promise.resolve({ brand: "mitsubishi-electric" }) }));
    expect(me).toContain(" VRF (City Multi) ");
  });

  it("404s a brand that isn't installed", async () => {
    await expect(HqBrandPage({ params: Promise.resolve({ brand: "nobody" }) })).rejects.toThrow("notFound");
  });
});

describe("/hq/changes across brands", () => {
  it("names the brand on every change, since a model code alone doesn't say whose book it is", async () => {
    const at = "2026-10-13T01:00:00Z";
    const row = (id: string, brand: string, key: string) => ({
      id,
      brand,
      section: "indoor_units",
      row_key: key,
      field: "airflow_ls",
      action: "set",
      old_value: null,
      new_value: 210,
      entered_by: "hq@heytiff.com",
      entered_at: at,
    });
    logRows = [row("1", "daikin", "FXFQ25AVM"), row("2", "mitsubishi-electric", "PEFY-P20VMA-E"), row("3", "gone-brand", "X-1")];
    const page = text(await HqChangesPage());
    expect(page).toContain(" Daikin FXFQ25AVM ");
    expect(page).toContain(" Mitsubishi Electric PEFY-P20VMA-E ");
    // a brand with no pack installed any more keeps its id
    expect(page).toContain(" gone-brand X-1 ");
  });
});
