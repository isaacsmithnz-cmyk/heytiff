/* The letterhead in Admin → Templates: chosen once, drawn on a letter as it
   changes, kept for every letter after. A detail the business hasn't put on
   file can't be ticked, and says where it is set. */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LetterheadTemplate } from "../letterhead-template";
import { STANDARD_LETTERHEAD } from "@/lib/templates/settings";
import type { LetterheadFacts } from "@/lib/letters/letterhead";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const saveTemplate = jest.fn(async (..._a: unknown[]) => ({ ok: true }));
const resetTemplate = jest.fn(async (..._a: unknown[]) => ({ ok: true }));
jest.mock("@/app/actions/templates", () => ({
  saveTemplate: (...a: unknown[]) => saveTemplate(...a),
  resetTemplate: (...a: unknown[]) => resetTemplate(...a),
}));

const FACTS: LetterheadFacts = {
  brand: {
    name: "Diamond Air Solutions",
    logoUrl: null,
    color: "#436cad",
    abn: "14603285409",
    phone: null,
    email: "service@diamondairsolutions.com",
    website: "www.diamondairsolutions.com",
  },
  legalName: "DAS PTY LTD",
  acn: null,
  address: ["12 Example Street", "Paddington NSW 2021"],
  licences: ["Contractor licence 315890C"],
};
const SIGNER = { name: "Isaac Smith", title: "Director", signatureSvg: "<svg/>" };

const open = (isOwner = true) =>
  render(
    <LetterheadTemplate facts={FACTS} letterhead={STANDARD_LETTERHEAD} changed={false} isOwner={isOwner} signer={SIGNER} today="8 October 2026" />
  );
const paper = () => within(document.querySelector(".ltr") as HTMLElement);

beforeEach(() => jest.clearAllMocks());

it("draws a letter on the business's paper, signed by whoever is looking", () => {
  open();
  const p = paper();
  expect(p.getByText("Diamond Air Solutions", { selector: ".ltr-name" })).toBeInTheDocument();
  expect(p.getByText("ABN 14 603 285 409")).toBeInTheDocument();
  expect(p.getByText("Paddington NSW 2021")).toBeInTheDocument();
  expect(p.getByText("Contractor licence 315890C")).toBeInTheDocument();
  expect(p.getByText("8 October 2026")).toBeInTheDocument();
  expect(p.getByText("Re: Employment confirmation")).toBeInTheDocument();
  expect(p.getByText("Yours sincerely")).toBeInTheDocument();
  expect(p.getByAltText("Signature of Isaac Smith")).toBeInTheDocument();
  expect(p.getByText("Director")).toBeInTheDocument();
});

it("redraws as the choices change, and saves them", async () => {
  open();
  await userEvent.click(screen.getByRole("checkbox", { name: /ABN/ }));
  expect(paper().queryByText("ABN 14 603 285 409")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Centred" }));
  expect(document.querySelector(".ltr-head")).toHaveClass("centre");
  await userEvent.type(screen.getByLabelText("Line along the foot of every page"), "DAS Pty Ltd, ABN 14 603 285 409");
  expect(paper().getByText("DAS Pty Ltd, ABN 14 603 285 409")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("checkbox", { name: /drawn signature/ }));
  expect(paper().queryByAltText("Signature of Isaac Smith")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  const [key, value] = saveTemplate.mock.calls[0] as [string, typeof STANDARD_LETTERHEAD];
  expect(key).toBe("letterhead");
  expect(value).toEqual(
    expect.objectContaining({ layout: "centre", footer: "DAS Pty Ltd, ABN 14 603 285 409", signature: false, show: expect.objectContaining({ abn: false }) })
  );
  expect(refresh).toHaveBeenCalled();
});

it("can't tick a detail the business hasn't put on file, and says where it is set", () => {
  open();
  const phone = screen.getByRole("checkbox", { name: /Phone/ });
  expect(phone).toBeDisabled();
  expect(phone).not.toBeChecked();
  expect(screen.getAllByText("Not set in Organisation").length).toBeGreaterThan(0);
});

it("shows anyone but the owner the letterhead without the editor", () => {
  open(false);
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(screen.getByText(/Only the owner can change it/)).toBeInTheDocument();
});
