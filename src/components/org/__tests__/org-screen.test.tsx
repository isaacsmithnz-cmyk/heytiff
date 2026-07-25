import { render, screen, within } from "@testing-library/react";
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

function setup(over: { org?: Partial<OrgSettings>; credentials?: OrgCredential[]; logoUrl?: string } = {}) {
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
    expect(within(screen.getByRole("dialog")).getByLabelText("Expiry")).toHaveAttribute(
      "type",
      "date"
    );
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
