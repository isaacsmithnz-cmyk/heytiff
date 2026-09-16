import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/* Tiff's reader and the uploader are mocked here, not left to jest.setup.ts,
   so each test decides what they answer. */
const readWorkRightsDocument = jest.fn();
jest.mock("@/app/actions/work-rights-ai", () => ({
  readWorkRightsDocument: (...a: unknown[]) => readWorkRightsDocument(...a),
}));

const uploadFile = jest.fn();
jest.mock("@/lib/documents/upload-client", () => ({
  uploadFile: (...a: unknown[]) => uploadFile(...a),
}));

import { WorkRightsModal } from "../work-rights-modal";
import { TODAY } from "./fixtures/staff";

/* The right-to-work modal is one screen — the modal IS the record — so Escape
   and the backdrop closed it outright, and a VEVO result already read and
   uploaded went with it, the file owned by nothing. */

function mount() {
  const onClose = jest.fn();
  render(
    <WorkRightsModal
      staffId="S1"
      subject={null}
      records={[]}
      documents={[]}
      today={TODAY}
      warnDays={30}
      onRecord={jest.fn().mockResolvedValue({ ok: true })}
      onAttach={jest.fn().mockResolvedValue({ ok: true })}
      onRemoveCheck={jest.fn().mockResolvedValue({ ok: true })}
      onClose={onClose}
    />,
  );
  return { onClose, user: userEvent.setup() };
}

const backdrop = () => fireEvent.click(document.querySelector(".vm-ov") as HTMLElement);

beforeEach(() => {
  uploadFile.mockReset().mockResolvedValue({ ok: true, file: { documentId: "doc-7" } });
  readWorkRightsDocument.mockReset().mockResolvedValue({
    ok: true,
    status: "Full working rights (visa)",
    visaType: "482 TSS",
    hoursCondition: null,
    expiresOn: "2027-08-07",
    checkedOn: "2026-09-01",
  });
});

describe("a scan in progress survives Escape", () => {
  const pdf = () => new File(["x"], "vevo.pdf", { type: "application/pdf" });

  it("keeps the window and the scan when Escape is pressed or the backdrop clicked", async () => {
    const { user, onClose } = mount();
    await user.upload(screen.getByLabelText("Scan document"), pdf());
    await screen.findByText("Scanned");

    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    backdrop();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Scanned")).toBeInTheDocument();

    // the X still closes
    await user.click(screen.getAllByRole("button", { name: "Close" })[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("still closes on Escape and on the backdrop when nothing has been scanned", async () => {
    const { user, onClose } = mount();
    expect(screen.getByText("Scan or upload what the check gave you")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    backdrop();
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

/* WHERE THE CHECKING HAPPENS, and it is not in this window. Isaac, on the
   walk: "You're not actually checking it. You're just updating the visa."
   The panel opens on the check — the Home Affairs site for a visa, the
   passport itself for a citizen — and the scan below it files the result. */
describe("the door to the check", () => {
  it("sends an employer to the Home Affairs check, and offers the account it needs", () => {
    mount();
    const check = screen.getByRole("link", { name: "Open the Home Affairs check" });
    expect(check).toHaveAttribute("href", "https://online.immi.gov.au/evo/thirdParty");
    expect(check).toHaveAttribute("target", "_blank");
    expect(check).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.getByRole("link", { name: "Register an organisation account" })).toHaveAttribute(
      "href",
      "https://online.immi.gov.au/lusc/register"
    );
  });

  /* A citizen or permanent resident has no visa to look up, so there is no
     site to send them to — the check is sighting the document. */
  it("sends a citizen nowhere, and names the document instead", async () => {
    const { user } = mount();
    await user.click(screen.getByRole("button", { name: /Enter manually/ }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Right to work" }),
      "Australian citizen"
    );

    expect(screen.queryByRole("link", { name: /Home Affairs/ })).not.toBeInTheDocument();
    expect(screen.getByText(/passport or the citizenship certificate/)).toBeInTheDocument();
  });

  /* "File what it said" is nonsense about a passport, which said nothing. */
  it("files a sighted document rather than what a check said", async () => {
    const { user } = mount();
    expect(screen.getByText("File what it said")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Enter manually/ }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Right to work" }),
      "Australian citizen"
    );

    expect(screen.getByText("File the document")).toBeInTheDocument();
    expect(screen.queryByText("File what it said")).not.toBeInTheDocument();
  });
});
