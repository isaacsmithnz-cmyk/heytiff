/* A letter written on the paper it prints on: the details at the side draw
   onto the letterhead as they're typed, Save sends the whole letter, and a
   signature is only ever the signer's own. */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LetterEditor } from "../letter-editor";
import { STANDARD_LETTERHEAD } from "@/lib/templates/settings";
import { blankLetter } from "@/lib/letters/letter";
import type { LetterheadFacts } from "@/lib/letters/letterhead";

const replace = jest.fn();
const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace, push, refresh: jest.fn() }) }));
const saveLetter = jest.fn(async (..._a: unknown[]) => ({ ok: true, id: "l-1", updatedAt: "2026-10-09T00:00:00Z", withSignature: true }));
const deleteLetter = jest.fn(async (..._a: unknown[]) => ({ ok: true }));
jest.mock("@/app/actions/letters", () => ({
  saveLetter: (...a: unknown[]) => saveLetter(...a),
  deleteLetter: (...a: unknown[]) => deleteLetter(...a),
}));

const FACTS: LetterheadFacts = {
  brand: { name: "Diamond Air Solutions", logoUrl: null, color: null, abn: "14603285409", phone: null, email: null, website: null },
  legalName: null,
  acn: null,
  address: [],
  licences: [],
};
const SIGNERS = [
  { staffId: "staff-1", name: "Isaac Smith", title: "Director", hasSignature: true },
  { staffId: "staff-2", name: "Sam Taylor", title: "Technician", hasSignature: false },
];

const open = (initial = blankLetter("2026-10-09", "staff-1")) =>
  render(
    <LetterEditor
      initial={initial}
      facts={FACTS}
      letterhead={STANDARD_LETTERHEAD}
      signers={SIGNERS}
      me={{ staffId: "staff-1", signatureSvg: "<svg/>" }}
      today="2026-10-09"
    />
  );
const paper = () => within(document.querySelector(".ltr") as HTMLElement);

beforeEach(() => jest.clearAllMocks());

it("draws the details onto the letterhead as they're typed, and saves the whole letter", async () => {
  open();
  expect(paper().getByText("9 October 2026")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("To, a line each"), "Department of Home Affairs{enter}GPO Box 9984");
  await userEvent.type(screen.getByLabelText("Re"), "Employment confirmation");
  expect(paper().getByText("Department of Home Affairs")).toBeInTheDocument();
  expect(paper().getByText("GPO Box 9984")).toBeInTheDocument();
  expect(paper().getByText("Re: Employment confirmation")).toBeInTheDocument();
  expect(paper().getByText("Isaac Smith")).toBeInTheDocument();
  expect(paper().getByAltText("Signature of Isaac Smith")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(saveLetter).toHaveBeenCalled());
  expect(saveLetter.mock.calls[0][0]).toEqual(
    expect.objectContaining({ recipient: "Department of Home Affairs\nGPO Box 9984", subject: "Employment confirmation", signerStaffId: "staff-1", withSignature: true })
  );
  expect(replace).toHaveBeenCalledWith("/dashboard/admin/letters/l-1");
  expect(await screen.findByText("Saved.")).toBeInTheDocument();
});

it("offers only the signer their own signature, and says so for anyone else", async () => {
  open();
  expect(screen.getByRole("checkbox", { name: "Add my signature" })).toBeChecked();
  await userEvent.selectOptions(screen.getByLabelText("Signed by"), "staff-2");
  expect(screen.queryByRole("checkbox", { name: "Add my signature" })).toBeNull();
  expect(screen.getByText("Only Sam Taylor can add their signature, by opening this letter and saving it.")).toBeInTheDocument();
  expect(paper().queryByAltText(/Signature of/)).toBeNull();
  expect(paper().getByText("Technician")).toBeInTheDocument();
});

it("has a toolbar of worded buttons over the paper", async () => {
  open();
  const bar = await screen.findByRole("toolbar", { name: "Formatting" });
  for (const name of ["Bold", "Italic", "Underline", "Heading", "Bullets", "Numbers", "Centre", "Table", "Undo"]) {
    expect(within(bar).getByRole("button", { name })).toBeInTheDocument();
  }
});

it("deletes after a second press, and goes back to the list", async () => {
  open({ ...blankLetter("2026-10-09", "staff-1"), id: "l-1" });
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  await userEvent.click(screen.getByRole("button", { name: "Keep" }));
  expect(deleteLetter).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  await userEvent.click(screen.getByRole("button", { name: "Delete letter" }));
  await waitFor(() => expect(deleteLetter).toHaveBeenCalledWith("l-1"));
  expect(push).toHaveBeenCalledWith("/dashboard/admin/letters");
});
