/* Signing on to a SWMS in the app: yourself from the bell, a helper on your
   phone, and never to a version that has been replaced. */

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BELL_REFRESH_EVENT } from "@/lib/dashboard/chips";
import { buildSwms, DEFAULT_ANSWERS } from "@/lib/swms/library";
import type { SwmsDocument, SwmsPerson } from "@/lib/swms/query";

const signOnSwms = jest.fn(async (..._: unknown[]) => ({ ok: true as const, signedAt: "2026-09-16T07:58:00.000Z" }));
jest.mock("@/app/actions/swms", () => ({ signOnSwms: (...a: unknown[]) => signOnSwms(...a) }));
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { SwmsSignOn } from "../sign-on";

const answers = { ...DEFAULT_ANSWERS, isolation: "Main switchboard", hospital: "Sutherland Hospital" };
const person = (over: Partial<SwmsPerson>): SwmsPerson => ({
  id: "p",
  staffProfileId: null,
  name: "—",
  role: "",
  team: true,
  signon: null,
  ...over,
});
const doc = (over: Partial<SwmsDocument> = {}): SwmsDocument => ({
  swmsId: "s-1",
  versionId: "v-1",
  version: 1,
  latest: true,
  issuedAt: "2026-09-15T21:42:00.000Z",
  jurisdiction: "NSW",
  answers,
  content: buildSwms(answers, { work: "Install a split system", electricianName: "Sam Ikpeba", firstAiderName: "Troy Porter" }),
  libraryVersion: "hvac-2026.09",
  job: { uuid: "job-1", number: "2601", clientName: null, address: "14 Attunga Road, Miranda NSW 2228", description: null, jurisdiction: "NSW" },
  responsibleStaffId: "troy",
  responsible: "Troy Porter",
  siteCheckedBy: "Troy Porter",
  siteCheckedAt: "2026-09-15T21:40:00.000Z",
  people: [
    person({ id: "p-troy", staffProfileId: "troy", name: "Troy Porter", role: "Crew lead", signon: { at: "2026-09-15T21:50:00.000Z", onPhoneOf: null, briefedBy: "Troy Porter", issue: null, svg: "<svg/>" } }),
    person({ id: "p-dane", staffProfileId: "dane", name: "Dane Whitmore" }),
    person({ id: "p-kai", name: "Kai Lindqvist", role: "Lindqvist Plumbing", team: false }),
  ],
  versions: [{ id: "v-1", version: 1, issuedAt: "2026-09-15T21:42:00.000Z", reason: "First issue", material: true, issuedBy: "Troy Porter" }],
  ...over,
});

/* jsdom draws nothing; the pad only needs somewhere to put its strokes */
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
beforeEach(() => jest.clearAllMocks());

const sign = (label: string) => {
  const pad = screen.getByLabelText(label);
  fireEvent.pointerDown(pad, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerMove(pad, { clientX: 20, clientY: 15, pointerId: 1 });
  fireEvent.pointerMove(pad, { clientX: 30, clientY: 12, pointerId: 1 });
  fireEvent.pointerMove(pad, { clientX: 40, clientY: 20, pointerId: 1 });
  fireEvent.pointerUp(pad, { pointerId: 1 });
};

it("signs you on once you've ticked the briefing and signed, then clears the bell", async () => {
  const bell = jest.fn();
  window.addEventListener(BELL_REFRESH_EVENT, bell);
  render(<SwmsSignOn doc={doc()} me="dane" />);

  const button = screen.getByRole("button", { name: "Sign on" });
  expect(button).toBeDisabled();
  sign("Your signature");
  expect(button).toBeDisabled();
  await userEvent.click(screen.getByRole("checkbox", { name: "I've been briefed and I'll follow this SWMS" }));
  expect(button).toBeEnabled();

  await userEvent.click(button);
  expect(signOnSwms).toHaveBeenCalledWith({ personId: "p-dane", pathData: expect.stringMatching(/^M[\d.]+ [\d.]+( L[\d.]+ [\d.]+){3}$/), briefed: true, issue: null });
  expect(bell).toHaveBeenCalled();
  expect(refresh).toHaveBeenCalled();
  window.removeEventListener(BELL_REFRESH_EVENT, bell);
});

it("sends an issue raised with the sign-on", async () => {
  render(<SwmsSignOn doc={doc()} me="dane" />);
  await userEvent.click(screen.getByRole("button", { name: "Raise an issue with this SWMS" }));
  await userEvent.type(screen.getByRole("textbox", { name: "Issue with this SWMS" }), "No anchor on the rear ridge");
  sign("Your signature");
  await userEvent.click(screen.getByRole("checkbox", { name: /briefed/ }));
  await userEvent.click(screen.getByRole("button", { name: "Sign on" }));
  expect(signOnSwms).toHaveBeenCalledWith(expect.objectContaining({ issue: "No anchor on the rear ridge" }));
});

it("shows who's signed on, and lets someone on it sign a helper on their phone", async () => {
  render(<SwmsSignOn doc={doc()} me="troy" />);
  expect(screen.queryByRole("button", { name: "Sign on" })).toBeNull();
  expect(screen.getByText(/^You signed on/)).toBeInTheDocument();
  expect(screen.getByText("1 of 3 signed on")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Sign them on" }));
  sign("Kai Lindqvist's signature");
  await userEvent.click(screen.getByRole("checkbox", { name: "Kai Lindqvist has been briefed and will follow this SWMS" }));
  await userEvent.click(screen.getByRole("button", { name: "Sign on Kai Lindqvist" }));
  expect(signOnSwms).toHaveBeenCalledWith(expect.objectContaining({ personId: "p-kai", briefed: true }));
});

it("offers someone who isn't on it nothing to sign", () => {
  render(<SwmsSignOn doc={doc()} me="manager" />);
  expect(screen.queryByRole("button", { name: /Sign on|Sign them on/ })).toBeNull();
  const kai = screen.getByText("Kai Lindqvist").closest(".sws-person") as HTMLElement;
  expect(within(kai).getByText("Not signed on")).toBeInTheDocument();
});

it("points a replaced version at the one that replaced it, and takes no sign-on", () => {
  render(
    <SwmsSignOn
      doc={doc({
        latest: false,
        versions: [
          { id: "v-1", version: 1, issuedAt: "2026-09-15T21:42:00.000Z", reason: "First issue", material: true, issuedBy: "Troy Porter" },
          { id: "v-2", version: 2, issuedAt: "2026-09-16T01:00:00.000Z", reason: "New isolation point", material: true, issuedBy: "Troy Porter" },
        ],
      })}
      me="dane"
    />
  );
  expect(screen.getByText("Version 2 replaced this one: New isolation point.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open version 2" })).toHaveAttribute("href", "/dashboard/swms/v-2");
  expect(screen.queryByRole("button", { name: "Sign on" })).toBeNull();
});

it("reads the SWMS before the sign-on, in the site's own time", () => {
  render(<SwmsSignOn doc={doc()} me="dane" />);
  expect(screen.getByText("1. Get onto the roof and set fall protection")).toBeInTheDocument();
  expect(screen.getByText(/Nearest hospital: Sutherland Hospital/)).toBeInTheDocument();
  // 21:42 UTC on the 15th is 7:42 am on the 16th in Sydney
  expect(screen.getByText(/issued Wed, 16 Sept, 7:42[\s\u202f]?am/i)).toBeInTheDocument();
});
