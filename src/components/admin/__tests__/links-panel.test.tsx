/* The pack's models against their order codes (Isaac, 2026-10-05: "most
   matches are a slight variant in model code… should it just group similar
   units?"): near units wait in groups by what differs, each one decision
   whatever its revisions, a group confirmed in one press. */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { LinksPanel } from "../links-panel";
import type { PricedLink } from "@/lib/quotes/links-server";

const offer = (supplierName: string, code: string, netCents: number) => ({ supplierKey: supplierName.toLowerCase(), supplierName, code, name: code, netCents, pricedOn: null });
const link = (model: string, label: string, proposals: PricedLink["proposals"], codes: string[] = []): PricedLink => ({
  model,
  section: "Outdoor",
  label,
  codes,
  proposed: proposals.flatMap((p) => p.codes),
  proposals,
  offers: [],
  cheapest: null,
  savesCents: null,
  features: [],
});

const links: PricedLink[] = [
  link("PUMY-P200YKMD2-A", "PUMY-P-YKMD2-A, 22.4 kW", [{ codes: ["PUMY-P200YKM3-A"], kind: "build", words: "YKMD2 → YKM3, a newer build", offers: [offer("Mitsubishi", "PUMY-P200YKM3-A", 473824)] }], ["PUMY-P200YKMD2-A"]),
  link("PUMY-SP80VKMD2-A", "PUMY-SP-VKMD2-A, 9 kW", [{ codes: ["PUMY-SP80VKMD3-A"], kind: "build", words: "VKMD2 → VKMD3, a newer build", offers: [] }]),
  link("MFZ-KW25VG", "floor-console, 2.5 kW", [
    { codes: ["MFZ-KW25VGK-A2", "MFZ-KW25VGK-A1"], kind: "wifi", words: "VG → VGK, adds Wi-Fi built in (K)", offers: [offer("Mitsubishi", "MFZ-KW25VGK-A2", 95000), offer("AAD", "MFZ-KW25VGK-A1", 99000)] },
  ]),
  link("MSZ-GS25VFD", "wall, 2.5 kW", []),
];

function serve() {
  const posts: unknown[] = [];
  let answer = links;
  global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      answer = links.slice(2);
      return { json: async () => ({ ok: true }) } as Response;
    }
    return { json: async () => ({ ok: true, links: answer }) } as Response;
  }) as unknown as typeof fetch;
  return posts;
}

it("groups near units by what differs, one row a unit however many revisions it has", async () => {
  serve();
  render(<LinksPanel />);
  expect(await screen.findByText("1 of 4 pack models linked to an order code, 3 units to confirm, 1 with no price in any price list.")).toBeInTheDocument();
  const builds = screen.getByRole("table", { name: "A newer or older build of the same unit" });
  expect(within(builds).getAllByRole("row")).toHaveLength(3);
  expect(within(builds).getByText("YKMD2 → YKM3, a newer build")).toBeInTheDocument();
  const wifi = screen.getByRole("table", { name: "The order code adds Wi-Fi built in (K)" });
  /* the A2 and A1 are one unit: one row, both suppliers' prices */
  expect(within(wifi).getAllByRole("row")).toHaveLength(2);
  expect(within(wifi).getByText("MFZ-KW25VGK-A2, MFZ-KW25VGK-A1")).toBeInTheDocument();
  expect(within(wifi).getByText("$950.00")).toBeInTheDocument();
  expect(within(wifi).getByText("$990.00")).toBeInTheDocument();
});

it("confirms a group in one press, leaving out a unit that's unticked", async () => {
  const posts = serve();
  render(<LinksPanel />);
  await screen.findByRole("table", { name: "A newer or older build of the same unit" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Include PUMY-SP80VKMD2-A" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Confirm 1 unit: A newer or older build of the same unit" }));
  });
  expect(posts).toEqual([{ decisions: [{ model: "PUMY-P200YKMD2-A", code: "PUMY-P200YKM3-A", decision: "confirmed" }] }]);
  expect(await screen.findByText("1 unit linked.")).toBeInTheDocument();
});

it("says a unit isn't the same, for every code it's sold under", async () => {
  const posts = serve();
  render(<LinksPanel />);
  const wifi = await screen.findByRole("table", { name: "The order code adds Wi-Fi built in (K)" });
  await act(async () => {
    fireEvent.click(within(wifi).getByRole("button", { name: "Not the same" }));
  });
  expect(posts).toEqual([
    {
      decisions: [
        { model: "MFZ-KW25VG", code: "MFZ-KW25VGK-A2", decision: "rejected" },
        { model: "MFZ-KW25VG", code: "MFZ-KW25VGK-A1", decision: "rejected" },
      ],
    },
  ]);
});
