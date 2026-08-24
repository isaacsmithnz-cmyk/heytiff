import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonalCard } from "../personal-card";
import { jordan } from "./fixtures/staff";

/* Address, on the staff card.

   A staff member's address is ONE LINE — it's read off a card, never queried —
   so the whole formatted address goes in the same box, and there is no
   onResolve because there are no sibling fields to fill. What this pins is
   that the swap from TextInput to AddressField changed nothing about the
   card's contract: the same label, the same key in the same allowlist, and a
   typed address that still saves when there is no key configured at all.

   Its own file rather than lines inside profile-screen.test.tsx: that suite is
   about which sections render and that a save doesn't move you. */

const fetchMock = jest.fn();
const realFetch = global.fetch;
global.fetch = fetchMock as unknown as typeof fetch;

const SUGGESTION = { placeId: "PLACE_1", text: "12 Trade St, Ringwood VIC 3134, Australia" };
const FORMATTED = "12 Trade St, Ringwood VIC 3134, Australia";

const jsonOk = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

function setup(addressLookup = false) {
  const onSave = jest.fn().mockResolvedValue({ ok: true });
  const view = render(
    <PersonalCard
      profile={{ ...jordan, address: null }}
      mode="self"
      email="jordan@heytiff.co"
      addressLookup={addressLookup}
      onSave={onSave}
    />
  );
  return { ...view, onSave };
}

const edit = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /^Edit$/ }));

const address = () => screen.getByLabelText("Address") as HTMLInputElement;

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockImplementation((_url: string, init: { body: string }) => {
    const { op } = JSON.parse(init.body);
    if (op === "suggest")
      return Promise.resolve(jsonOk({ enabled: true, suggestions: [SUGGESTION] }));
    return Promise.resolve(
      jsonOk({
        enabled: true,
        formatted: FORMATTED,
        parts: { address: "12 Trade St", suburb: "Ringwood", state: "VIC", postcode: "3134" },
      })
    );
  });
});

afterAll(() => {
  global.fetch = realFetch;
});

describe("with no key configured", () => {
  it("is the plain box it has always been, and saves what was typed", async () => {
    const user = userEvent.setup();
    const { onSave } = setup(false);

    await edit(user);
    await user.type(address(), "Lot 4 Sawmill Track, Yackandandah VIC 3749");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Save\b/ }));
    expect(onSave).toHaveBeenCalledWith(
      "personal",
      expect.objectContaining({ address: "Lot 4 Sawmill Track, Yackandandah VIC 3749" })
    );
  });
});

describe("with the lookup on", () => {
  it("still keeps the label tied to the field", async () => {
    const user = userEvent.setup();
    setup(true);
    await edit(user);

    expect(address()).toBeInTheDocument();
    expect(address()).toHaveAttribute("id", "address");
  });

  it("picks an address and saves it as one line", async () => {
    const user = userEvent.setup();
    const { onSave } = setup(true);

    await edit(user);
    await user.type(address(), "12 Trade");
    await screen.findByRole("listbox");
    await user.click(screen.getByText(SUGGESTION.text));

    await waitFor(() => expect(address()).toHaveValue(FORMATTED));

    await user.click(screen.getByRole("button", { name: /^Save\b/ }));
    expect(onSave).toHaveBeenCalledWith(
      "personal",
      expect.objectContaining({ address: FORMATTED })
    );
  });

  it("changes nothing about which keys the section submits", async () => {
    const user = userEvent.setup();
    const { onSave } = setup(true);

    await edit(user);
    await user.click(screen.getByRole("button", { name: /^Save\b/ }));

    const [section, fields] = onSave.mock.calls[0];
    expect(section).toBe("personal");
    expect(Object.keys(fields).sort()).toEqual([
      "address",
      "birthday",
      // the uniform sizes ride the personal section — same save, same
      // allowlist, no extra round trip. `boot_scale` is the picked half of the
      // boot size, saved with it. See lib/staff/uniform.ts.
      "boot_scale",
      "boot_size",
      "employment_type",
      "first_name",
      "jacket_size",
      "last_name",
      "phone",
      "preferred_name",
      "shirt_size",
      "start_date",
      "status",
      "trousers_size",
    ]);
  });

  it("saves an address the lookup never offered", async () => {
    const user = userEvent.setup();
    const { onSave } = setup(true);

    await edit(user);
    await user.type(address(), "12 Trade");
    // the dropdown is open, offering something else entirely — and ignored
    await screen.findByRole("listbox");
    await user.type(address(), " Track, Nowhere");
    await user.click(screen.getByRole("button", { name: /^Save\b/ }));

    expect(onSave).toHaveBeenCalledWith(
      "personal",
      expect.objectContaining({ address: "12 Trade Track, Nowhere" })
    );
  });
});
