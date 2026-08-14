import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OrgCredential } from "@/lib/org/credentials";
import type { OrgSettings } from "@/lib/org/settings";

/* The uploader's helper is stubbed: it exists to reach a signed slot and PUT
   bytes at real storage, and pulling it in for real would drag the server
   action (and Auth0) into a DOM test. What matters here is what the screen does
   with the document id that comes back. */
const uploadFile = jest.fn();
jest.mock("@/lib/documents/upload-client", () => ({
  uploadFile: (...a: unknown[]) => uploadFile(...a),
}));

import { OrgScreen } from "../org-screen";

/* The Organisation screen, on the staff card's machinery.

   Three things this file is really pinning:

     THE HINTS ARE GONE. "Shown across HeyTiff — including under the logo" and
     "Checked against the ATO checksum on save" described the software to
     itself. A test asserts their ABSENCE, because a helpful-sounding sentence
     is exactly the kind of thing that gets re-added.

     A BAD ABN NEVER LEAVES THE BROWSER. The card runs the same checksum the
     action runs, so the action is not called at all and the ABN box is the one
     that gets marked.

     THE MODAL IS NOT THERE UNTIL IT IS. It portals to <body>, so "no dialog in
     the document" is the only honest way to say it's closed. */

const TODAY = "2026-07-24";

const ORG: OrgSettings = {
  id: "org-1",
  trading_name: "Smith Air Conditioning",
  legal_name: "Smith Air Pty Ltd",
  abn: "51824753556",
  acn: "123456789",
  gst_registered: true,
  email: "office@smithair.com.au",
  phone: "(03) 9000 0000",
  website: "smithair.com.au",
  address: "12 Trade Street",
  suburb: "Ringwood",
  state: "VIC",
  postcode: "3134",
  logo_url: null,
};

const CREDENTIALS: OrgCredential[] = [
  {
    id: "C1",
    kind: "licence",
    name: "ARC refrigerant trading authorisation",
    number: "AU12345",
    issuer: "Australian Refrigeration Council",
    expiryDate: "2026-08-07",
    color: null,
  },
  {
    id: "C2",
    kind: "insurance",
    name: "Public liability",
    number: "PL-9",
    issuer: "QBE",
    expiryDate: null,
    color: null,
  },
];

function setup(
  over: {
    org?: Partial<OrgSettings>;
    credentials?: OrgCredential[];
    logoUrl?: string;
    addressLookup?: boolean;
  } = {}
) {
  const actions = {
    onSave: jest.fn().mockResolvedValue({ ok: true }),
    onAddCredential: jest.fn().mockResolvedValue({ ok: true }),
    onUpdateCredential: jest.fn().mockResolvedValue({ ok: true }),
    onRemoveCredential: jest.fn().mockResolvedValue({ ok: true }),
    onSetLogo: jest.fn().mockResolvedValue({ ok: true }),
    onClearLogo: jest.fn().mockResolvedValue({ ok: true }),
  };
  const view = render(
    <OrgScreen
      org={{ ...ORG, ...(over.org ?? {}) }}
      credentials={over.credentials ?? CREDENTIALS}
      logoUrl={over.logoUrl ?? null}
      today={TODAY}
      addressLookup={over.addressLookup ?? false}
      actions={actions}
    />
  );
  return { ...view, actions };
}

describe("the company card", () => {
  it("reads as a card, not a form — name, ABN and GST on the plastic", () => {
    const { container } = setup();
    expect(screen.getByRole("heading", { name: "Organisation" })).toBeInTheDocument();

    const card = container.querySelector(".idc.light")!;
    expect(card).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText("Smith Air Conditioning")).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText("Smith Air Pty Ltd")).toBeInTheDocument();
    // grouped the way it is printed on an invoice
    expect(within(card as HTMLElement).getByText("51 824 753 556")).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText("123 456 789")).toBeInTheDocument();
    expect(within(card as HTMLElement).getByText("Registered")).toBeInTheDocument();
  });

  /* The sub-line under the name is the LEGAL name, and its empty state used to
     name the TRADING one. Every fixture in this file sets both, so the card
     spent its whole life printing the trading name in the heading and
     "Trading name not set" underneath it — contradicting itself about the only
     field it was showing — and no test ever rendered the state that says so.
     Diamond Air Solutions, which has a trading name and no legal one, looked
     exactly like that in prod. */
  it("names the LEGAL name in its empty state, not the trading one it is showing", () => {
    const { container } = setup({ org: { legal_name: null } });
    const card = container.querySelector(".idc.light") as HTMLElement;

    expect(within(card).getByText("Smith Air Conditioning")).toBeInTheDocument();
    expect(within(card).queryByText("Trading name not set")).not.toBeInTheDocument();
    expect(within(card).getByText("Legal name not set")).toBeInTheDocument();
  });

  it("falls back to initials when there is no logo, and shows the logo when there is", () => {
    const { container, rerender } = setup();
    expect(container.querySelector(".idc-photo .inn")).toHaveTextContent("SA");

    rerender(
      <OrgScreen
        org={ORG}
        credentials={CREDENTIALS}
        logoUrl="https://signed.example/logo.png"
        today={TODAY}
        actions={{
          onSave: jest.fn(),
          onAddCredential: jest.fn(),
          onUpdateCredential: jest.fn(),
          onRemoveCredential: jest.fn(),
          onSetLogo: jest.fn(),
          onClearLogo: jest.fn(),
        }}
      />
    );
    expect(container.querySelector(".idc-photo img")).toHaveAttribute(
      "src",
      "https://signed.example/logo.png"
    );
  });

  /* The hints the redesign deleted. They explained the software to itself; the
     ABN one is now an ERROR on the field, which is what it was really promising. */
  it("carries none of the old explanatory hints", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getAllByRole("button", { name: /Edit/ })[0]);

    expect(screen.queryByText(/Shown across HeyTiff/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ATO checksum/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Coming soon/)).not.toBeInTheDocument();
  });

  it("keeps the one help line that says something the label doesn't", async () => {
    const user = userEvent.setup();
    setup();
    // the second card is Contact & address
    await user.click(screen.getAllByRole("button", { name: /Edit/ })[1]);
    expect(screen.getByText("Also sets your public-holiday calendar")).toBeInTheDocument();
  });
});

describe("saving identity", () => {
  it("sends the identity section when the fields are clean", async () => {
    const user = userEvent.setup();
    const { actions } = setup();

    await user.click(screen.getAllByRole("button", { name: /Edit/ })[0]);
    await user.clear(screen.getByLabelText(/Trading name/));
    await user.type(screen.getByLabelText(/Trading name/), "Smith Air Co");
    await user.click(screen.getAllByRole("button", { name: /Save/ })[0]);

    expect(actions.onSave).toHaveBeenCalledWith(
      "identity",
      expect.objectContaining({ trading_name: "Smith Air Co" })
    );
  });

  it("blocks a bad ABN on the field, and never calls the action", async () => {
    const user = userEvent.setup();
    const { actions } = setup();

    await user.click(screen.getAllByRole("button", { name: /Edit/ })[0]);
    const abn = screen.getByLabelText("ABN");
    await user.clear(abn);
    await user.type(abn, "51824753557"); // one digit out
    await user.click(screen.getAllByRole("button", { name: /Save/ })[0]);

    expect(await screen.findByText("That ABN doesn't check out")).toBeInTheDocument();
    expect(abn).toHaveAttribute("aria-invalid", "true");
    expect(actions.onSave).not.toHaveBeenCalled();
  });
});

describe("the credential grid", () => {
  it("renders each row with its badge, number, issuer and status", () => {
    const { container } = setup();
    const cards = container.querySelectorAll(".credgrid .cred");
    expect(cards).toHaveLength(2);

    expect(screen.getByText("ARC")).toBeInTheDocument();
    expect(screen.getByText("INS")).toBeInTheDocument();
    expect(screen.getByText("No. AU12345")).toBeInTheDocument();
    expect(screen.getByText("QBE")).toBeInTheDocument();
    expect(screen.getByText("Expires 07/08/2026")).toBeInTheDocument();
    // 14 days out — the same 30-day window (and wording) as the dashboard chip
    expect(screen.getByText("Expires in 2 weeks")).toBeInTheDocument();
    expect(screen.getByText("No expiry date")).toBeInTheDocument();
  });

  it("offers a tile to add one", () => {
    setup({ credentials: [] });
    expect(screen.getByRole("button", { name: /Add licence or insurance/ })).toBeInTheDocument();
  });

  it("opens no modal until something is clicked", () => {
    setup();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("the credential modal", () => {
  it("adds one from the tile", async () => {
    const user = userEvent.setup();
    const { actions } = setup({ credentials: [] });

    await user.click(screen.getByRole("button", { name: /Add licence or insurance/ }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name/), "Working at Heights");
    await user.type(within(dialog).getByLabelText("Number"), "WAH-1");
    await user.click(within(dialog).getByRole("button", { name: /Save/ }));

    expect(actions.onAddCredential).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "licence", name: "Working at Heights", number: "WAH-1" })
    );
    // it saved, so it closed
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens on a card with that credential's values, and updates it by id", async () => {
    const user = userEvent.setup();
    const { actions } = setup();

    await user.click(screen.getByRole("button", { name: "Edit Public liability" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue("Public liability");
    expect(within(dialog).getByLabelText("Insurer")).toHaveValue("QBE");

    await user.clear(within(dialog).getByLabelText("Number"));
    await user.type(within(dialog).getByLabelText("Number"), "PL-10");
    await user.click(within(dialog).getByRole("button", { name: /Save/ }));

    expect(actions.onUpdateCredential).toHaveBeenCalledWith(
      "C2",
      expect.objectContaining({ kind: "insurance", name: "Public liability", number: "PL-10" })
    );
    expect(actions.onAddCredential).not.toHaveBeenCalled();
  });

  it("asks for the expiry with a calendar, never a text box", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /Add licence or insurance/ }));
    const dialog = screen.getByRole("dialog");
    // the shared popover picker: a button that opens the drawn calendar —
    // there is nothing to type a date into, well- or ill-formatted
    expect(within(dialog).getByLabelText("Expiry")).toHaveAttribute("type", "button");
    expect(dialog.querySelector('input[type="date"]')).toBeNull();
  });

  it("deletes only after a second, deliberate click", async () => {
    const user = userEvent.setup();
    const { actions } = setup();

    await user.click(screen.getByRole("button", { name: "Edit Public liability" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(actions.onRemoveCredential).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: /Tap again to delete/ }));
    expect(actions.onRemoveCredential).toHaveBeenCalledWith("C2");
  });

  it("has no Delete when there is nothing yet to delete", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: /Add licence or insurance/ }));
    expect(
      within(screen.getByRole("dialog")).queryByRole("button", { name: "Delete" })
    ).not.toBeInTheDocument();
  });

  it("refuses an unnamed credential without calling anything", async () => {
    const user = userEvent.setup();
    const { actions } = setup();
    await user.click(screen.getByRole("button", { name: /Add licence or insurance/ }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Save/ }));

    expect(await within(dialog).findByText("Give this licence or policy a name.")).toBeInTheDocument();
    expect(actions.onAddCredential).not.toHaveBeenCalled();
  });

  it("keeps the modal open and says why when the action refuses", async () => {
    const user = userEvent.setup();
    const { actions } = setup();
    actions.onAddCredential.mockResolvedValueOnce({ ok: false, error: "Couldn't add that." });

    await user.click(screen.getByRole("button", { name: /Add licence or insurance/ }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Name/), "ARC");
    await user.click(within(dialog).getByRole("button", { name: /Save/ }));

    expect(await screen.findByText("Couldn't add that.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes on Cancel without writing", async () => {
    const user = userEvent.setup();
    const { actions } = setup();
    await user.click(screen.getByRole("button", { name: /Add licence or insurance/ }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" })
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(actions.onAddCredential).not.toHaveBeenCalled();
  });
});

/* The address, which is FOUR fields and one lookup.

   This is the surface where autocomplete earns its keep: pick the address once
   and suburb, state and postcode fill themselves — including the state, which
   also picks the org's public-holiday calendar. The street box keeps the STREET
   line, not the whole formatted address, or the suburb would be printed twice
   on the same card.

   `fetch` is mocked for these tests and the only URL it may see is our own
   /api/address; the key lives on the server and has no way into this file. */
describe("the address", () => {
  const fetchMock = jest.fn();
  const realFetch = global.fetch;

  const SUGGESTION = { placeId: "PLACE_1", text: "12 Trade St, Ringwood VIC 3134, Australia" };
  const PARTS = { address: "12 Trade St", suburb: "Ringwood", state: "VIC", postcode: "3134" };
  const jsonOk = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

  beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((_url: string, init: { body: string }) => {
      const { op } = JSON.parse(init.body);
      if (op === "suggest")
        return Promise.resolve(jsonOk({ enabled: true, suggestions: [SUGGESTION] }));
      return Promise.resolve(
        jsonOk({ enabled: true, formatted: SUGGESTION.text, parts: PARTS })
      );
    });
  });

  // the second card is Contact & address — its own Edit, its own Save
  const openContact = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getAllByRole("button", { name: /Edit/ })[1]);
  const saveContact = () => screen.getAllByRole("button", { name: /Save/ })[1];

  const blank = {
    org: { address: null, suburb: null, state: null, postcode: null },
  };

  it("is four plain boxes when no key is configured", async () => {
    const user = userEvent.setup();
    const { actions } = setup({ ...blank, addressLookup: false });

    await openContact(user);
    await user.type(screen.getByLabelText("Street address"), "12 Trade Street");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.click(saveContact());
    expect(actions.onSave).toHaveBeenCalledWith(
      "contact",
      expect.objectContaining({ address: "12 Trade Street" })
    );
  });

  it("fills suburb, state and postcode from one pick", async () => {
    const user = userEvent.setup();
    setup({ ...blank, addressLookup: true });

    await openContact(user);
    await user.type(screen.getByLabelText("Street address"), "12 Trade");
    await screen.findByRole("listbox");
    await user.click(screen.getByText(SUGGESTION.text));

    await waitFor(() => expect(screen.getByLabelText("Suburb")).toHaveValue("Ringwood"));
    // the State SELECT, so the holiday calendar follows — a code it can show
    expect(screen.getByLabelText(/^State/)).toHaveValue("VIC");
    expect(screen.getByLabelText("Postcode")).toHaveValue("3134");
  });

  it("keeps the street line in the street box, not the whole address", async () => {
    const user = userEvent.setup();
    const { actions } = setup({ ...blank, addressLookup: true });

    await openContact(user);
    await user.type(screen.getByLabelText("Street address"), "12 Trade");
    await screen.findByRole("listbox");
    await user.click(screen.getByText(SUGGESTION.text));

    await waitFor(() => expect(screen.getByLabelText("Street address")).toHaveValue("12 Trade St"));

    await user.click(saveContact());
    expect(actions.onSave).toHaveBeenCalledWith("contact", expect.objectContaining(PARTS));
  });

  /* A suburb-level match has no street number and no route, and an empty
     street box would be a worse answer than the line the person picked. */
  it("falls back to the formatted line when Google had no street", async () => {
    fetchMock.mockImplementation((_url: string, init: { body: string }) => {
      const { op } = JSON.parse(init.body);
      if (op === "suggest")
        return Promise.resolve(
          jsonOk({ enabled: true, suggestions: [{ placeId: "P2", text: "Ringwood VIC, Australia" }] })
        );
      return Promise.resolve(
        jsonOk({
          enabled: true,
          formatted: "Ringwood VIC, Australia",
          parts: { address: "", suburb: "Ringwood", state: "VIC", postcode: "" },
        })
      );
    });
    const user = userEvent.setup();
    setup({ ...blank, addressLookup: true });

    await openContact(user);
    await user.type(screen.getByLabelText("Street address"), "Ringwood");
    await screen.findByRole("listbox");
    await user.click(screen.getByText("Ringwood VIC, Australia"));

    await waitFor(() =>
      expect(screen.getByLabelText("Street address")).toHaveValue("Ringwood VIC, Australia")
    );
    expect(screen.getByLabelText("Suburb")).toHaveValue("Ringwood");
  });

  it("still lets an address be typed in full, and typed over afterwards", async () => {
    const user = userEvent.setup();
    const { actions } = setup({ ...blank, addressLookup: true });

    await openContact(user);
    await user.type(screen.getByLabelText("Street address"), "12 Trade");
    await screen.findByRole("listbox");
    await user.click(screen.getByText(SUGGESTION.text));
    await waitFor(() => expect(screen.getByLabelText("Suburb")).toHaveValue("Ringwood"));

    // Google's answer is a starting point, not a lock
    await user.clear(screen.getByLabelText("Street address"));
    await user.type(screen.getByLabelText("Street address"), "Unit 9, 12 Trade St");
    await user.click(saveContact());

    expect(actions.onSave).toHaveBeenCalledWith(
      "contact",
      expect.objectContaining({ address: "Unit 9, 12 Trade St", suburb: "Ringwood", state: "VIC" })
    );
  });

  it("only ever talks to our own proxy", async () => {
    const user = userEvent.setup();
    setup({ ...blank, addressLookup: true });

    await openContact(user);
    await user.type(screen.getByLabelText("Street address"), "12 Trade");
    await screen.findByRole("listbox");
    await user.click(screen.getByText(SUGGESTION.text));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1));

    for (const [url] of fetchMock.mock.calls) expect(url).toBe("/api/address");
  });
});

/* The logo, which used to be a tile reading "Coming soon — needs document
   storage". It saves itself the moment a file is chosen, because the thing you
   are looking at is the confirmation. */
describe("the logo", () => {
  const file = () => new File(["x"], "logo.png", { type: "image/png" });

  beforeEach(() => uploadFile.mockReset());

  it("uploads as an org_logo and points the org at what came back", async () => {
    const user = userEvent.setup();
    uploadFile.mockResolvedValue({ ok: true, file: { documentId: "doc-9" } });
    const { actions } = setup();

    await user.click(screen.getAllByRole("button", { name: /Edit/ })[0]);
    await user.upload(screen.getByLabelText("Company logo"), file());

    expect(uploadFile).toHaveBeenCalledWith(expect.any(File), "org_logo");
    expect(actions.onSetLogo).toHaveBeenCalledWith("doc-9");
  });

  it("says what went wrong instead of pretending it saved", async () => {
    const user = userEvent.setup();
    uploadFile.mockResolvedValue({ ok: false, error: "That file is too big — 10 MB is the limit." });
    const { actions } = setup();

    await user.click(screen.getAllByRole("button", { name: /Edit/ })[0]);
    await user.upload(screen.getByLabelText("Company logo"), file());

    expect(
      await screen.findByText("That file is too big — 10 MB is the limit.")
    ).toBeInTheDocument();
    expect(actions.onSetLogo).not.toHaveBeenCalled();
  });

  it("offers Remove only once there is a logo", async () => {
    const user = userEvent.setup();
    const plain = setup();
    await user.click(screen.getAllByRole("button", { name: /Edit/ })[0]);
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    plain.unmount();

    const withLogo = setup({ logoUrl: "https://signed.example/logo.png" });
    await user.click(screen.getAllByRole("button", { name: /Edit/ })[0]);
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(withLogo.actions.onClearLogo).toHaveBeenCalled();
  });
});
