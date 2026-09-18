/* Signing on to a SWMS in the app: yourself from the bell, a helper on your
   phone, and never to a version that has been replaced. */

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BELL_REFRESH_EVENT } from "@/lib/dashboard/chips";
import { buildSwms, DEFAULT_ANSWERS } from "@/lib/swms/library";
import type { SwmsDocument, SwmsPerson } from "@/lib/swms/query";

const signOnSwms = jest.fn(async (..._: unknown[]) => ({ ok: true as const, signedAt: "2026-09-16T07:58:00.000Z" }));
const raiseSwmsIssue = jest.fn(async (..._: unknown[]) => ({ ok: true as const }));
const clearSwmsIssue = jest.fn(async (..._: unknown[]) => ({ ok: true as const }));
jest.mock("@/app/actions/swms", () => ({
  signOnSwms: (...a: unknown[]) => signOnSwms(...a),
  raiseSwmsIssue: (...a: unknown[]) => raiseSwmsIssue(...a),
  clearSwmsIssue: (...a: unknown[]) => clearSwmsIssue(...a),
}));
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
const withIssue = (issue: string, over: Partial<NonNullable<SwmsPerson["signon"]>> = {}) => ({
  at: "2026-09-15T21:50:00.000Z", version: 1, onPhoneOf: null, signedByStaffId: null, briefedBy: "Troy Porter", issue, issueCleared: null, svg: "<svg/>", ...over,
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
  job: { uuid: "job-1", number: "2601", clientName: null, address: "14 Attunga Road, Miranda NSW 2228", description: null, status: "Work Order", state: "NSW", jurisdiction: "NSW", postcode: "2228", categoryName: "Install" },
  responsibleStaffId: "troy",
  responsible: "Troy Porter",
  siteCheckedBy: "Troy Porter",
  siteCheckedAt: "2026-09-15T21:40:00.000Z",
  people: [
    person({ id: "p-troy", staffProfileId: "troy", name: "Troy Porter", role: "Crew lead", signon: withIssue("") }),
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

/* ONE PROMISE, NOT TWO. The paragraph says what signing means; a tick
   repeating it was the same promise twice, and a greyed-out button that said
   nothing left the reader hunting for what was missing. */
it("signs you on once you've signed, and says so while the box is empty", async () => {
  const bell = jest.fn();
  window.addEventListener(BELL_REFRESH_EVENT, bell);
  render(<SwmsSignOn doc={doc()} me="dane" />);

  const button = screen.getByRole("button", { name: "Sign on" });
  expect(button).toBeDisabled();
  expect(screen.getByText("Sign in the box to finish.")).toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).toBeNull();
  sign("Your signature");
  expect(button).toBeEnabled();

  await userEvent.click(button);
  expect(signOnSwms).toHaveBeenCalledWith({ personId: "p-dane", pathData: expect.stringMatching(/^M[\d.]+ [\d.]+( L[\d.]+ [\d.]+){3}$/), issue: null });
  expect(bell).toHaveBeenCalled();
  expect(refresh).toHaveBeenCalled();
  window.removeEventListener(BELL_REFRESH_EVENT, bell);
});

it("sends an issue raised with the sign-on", async () => {
  render(<SwmsSignOn doc={doc()} me="dane" />);
  await userEvent.click(screen.getByRole("button", { name: "Raise an issue with this SWMS" }));
  await userEvent.type(screen.getByRole("textbox", { name: "Issue with this SWMS" }), "No anchor on the rear ridge");
  sign("Your signature");
  await userEvent.click(screen.getByRole("button", { name: "Sign on" }));
  expect(signOnSwms).toHaveBeenCalledWith(expect.objectContaining({ issue: "No anchor on the rear ridge" }));
});

/* THE PHONE THAT IS OUT. A workmate standing at the same briefing had a
   longer road than a stranger, who could always sign on the lead's phone. */
it("shows who's signed on, and lets someone on it sign anyone else on their phone", async () => {
  render(<SwmsSignOn doc={doc()} me="troy" />);
  expect(screen.queryByRole("button", { name: "Sign on" })).toBeNull();
  expect(screen.getByText(/^You signed on/)).toBeInTheDocument();
  expect(screen.getByText("1 of 3 signed on")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Sign them on" })).toHaveLength(2);

  const kai = screen.getByText("Kai Lindqvist").closest(".sws-person") as HTMLElement;
  await userEvent.click(within(kai).getByRole("button", { name: "Sign them on" }));
  sign("Kai Lindqvist's signature");
  await userEvent.click(screen.getByRole("button", { name: "Sign on Kai Lindqvist" }));
  expect(signOnSwms).toHaveBeenCalledWith(expect.objectContaining({ personId: "p-kai" }));
});

/* SIGNING AGAIN WITHOUT BEING TOLD WHY. The reason lived only on the version
   that had been replaced, never on the one being signed. */
it("leads a revision with what changed", () => {
  render(
    <SwmsSignOn
      doc={doc({
        version: 2,
        versions: [
          { id: "v-1", version: 1, issuedAt: "2026-09-15T21:42:00.000Z", reason: "First issue", material: true, issuedBy: "Troy Porter" },
          { id: "v-2", version: 2, issuedAt: "2026-09-16T01:00:00.000Z", reason: "Crane lift instead of a hoist", material: true, issuedBy: "Troy Porter" },
        ],
      })}
      me="dane"
    />
  );
  const changed = screen.getByText("What changed");
  expect(within(changed.closest(".sws-card") as HTMLElement).getByText("Crane lift instead of a hoist")).toBeInTheDocument();
  expect(screen.getByText("Everyone signs on again")).toBeInTheDocument();
  /* and it stands above the document it changed */
  expect(changed.compareDocumentPosition(screen.getByText("Before you start")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

/* what a worker raised reaches the person in charge — the bell, and here */
it("shows an issue raised at sign-on beside the person who raised it", () => {
  const raised = doc();
  raised.people[1] = {
    ...raised.people[1],
    signon: withIssue("No anchor on the rear ridge"),
  };
  render(<SwmsSignOn doc={raised} me="troy" />);
  expect(screen.getByText("Raised: No anchor on the rear ridge")).toBeInTheDocument();
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
  expect(screen.getByText("A newer SWMS replaced this one: New isolation point.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open the current SWMS" })).toHaveAttribute("href", "/dashboard/swms/v-2");
  expect(screen.queryByRole("button", { name: "Sign on" })).toBeNull();
});

it("puts the reading before the signature, in plain words, in the site's own time", () => {
  render(<SwmsSignOn doc={doc()} me="dane" />);
  const reading = screen.getByText("Before you start");
  const signing = screen.getByRole("button", { name: "Sign on" });
  /* the SWMS comes first on the page, the signature after it */
  expect(reading.compareDocumentPosition(signing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText("1. Get onto the roof and set fall protection")).toBeInTheDocument();
  expect(screen.getByText(/Nearest hospital: Sutherland Hospital/)).toBeInTheDocument();
  /* the gear the signature says they'll follow, on the screen it's signed on */
  expect(screen.getByText("Protective equipment")).toBeInTheDocument();
  expect(screen.getByText(/Fit-checked P2 respirator and hearing protection for drilling/)).toBeInTheDocument();
  /* the category in the words of the site, and no control-level labels */
  expect(screen.getByText("Falling more than 2 m")).toBeInTheDocument();
  expect(screen.queryByText("Isolate")).toBeNull();
  expect(screen.queryByText("Admin")).toBeNull();
  /* 21:42 UTC on the 15th is 7:42am on the 16th in Sydney — written the way
     the job card writes a day and the calendar writes a time */
  expect(screen.getByText("Issued Wed 16 Sept, 7:42am. Troy Porter is in charge on site.")).toBeInTheDocument();
});

/* the person in charge ticked "I've been briefed", and the register said
   they briefed themselves */
it("asks the person in charge to brief everyone, not to have been briefed", async () => {
  const unsigned = doc();
  unsigned.people[0] = { ...unsigned.people[0], signon: null };
  render(<SwmsSignOn doc={unsigned} me="troy" />);
  expect(screen.getByText(/You're in charge on site\.$/)).toBeInTheDocument();
  expect(screen.queryByText(/I was consulted and briefed/)).toBeNull();
  expect(screen.getByText(/I'll brief everyone it covers before work starts/)).toBeInTheDocument();
  expect(screen.queryByText(/and tell Troy Porter/)).toBeNull();
  sign("Your signature");
  await userEvent.click(screen.getByRole("button", { name: "Sign on" }));
  expect(signOnSwms).toHaveBeenCalledWith(expect.objectContaining({ personId: "p-troy" }));
});

/* THE BELL SENT THE PERSON IN CHARGE HERE FOR THE ISSUE, not for the briefing
   they wrote themselves — it was a small amber line in the third card. */
it("leads with the issue for whoever has to answer it, and records it as sorted", async () => {
  const raised = doc();
  raised.people[1] = { ...raised.people[1], signon: withIssue("No anchor on the rear ridge") };
  render(<SwmsSignOn doc={raised} me="troy" />);

  const card = screen.getByText("An issue was raised").closest(".sws-card") as HTMLElement;
  expect(within(card).getByText("No anchor on the rear ridge")).toBeInTheDocument();
  expect(within(card).getByText(/^Dane Whitmore, Wed 16 Sept/)).toBeInTheDocument();
  expect(within(card).getByRole("link", { name: "Open the job to revise the SWMS" })).toHaveAttribute("href", "/dashboard/workboard?job=job-1");
  /* above the briefing it is about */
  expect(card.compareDocumentPosition(screen.getByText("Before you start")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  /* a verb and a noun, not a state word sitting where "Signed on" sits */
  await userEvent.click(within(card).getByRole("button", { name: "Record it as sorted" }));
  expect(clearSwmsIssue).toHaveBeenCalledWith("p-dane");
});

it("shows nobody else the answer-it card, and says who sorted one", () => {
  const sorted = doc();
  sorted.people[1] = {
    ...sorted.people[1],
    signon: withIssue("No anchor on the rear ridge", { issueCleared: { by: "Troy Porter", at: "2026-09-16T08:05:00.000Z" } }),
  };
  render(<SwmsSignOn doc={sorted} me="dane" />);
  expect(screen.queryByText("An issue was raised")).toBeNull();
  expect(screen.getByText("Raised: No anchor on the rear ridge — sorted by Troy Porter, Wed 16 Sept, 6:05pm")).toBeInTheDocument();
});

/* THE ANCHOR IS FOUND RUSTED ON THE ROOF — after the briefing at the truck,
   when the only door to raising it was inside the sign-on form. */
it("keeps a door to raise an issue after you've signed", async () => {
  const signed = doc();
  signed.people[1] = { ...signed.people[1], signon: withIssue("") };
  render(<SwmsSignOn doc={signed} me="dane" />);

  await userEvent.click(screen.getByRole("button", { name: "Raise an issue with this SWMS" }));
  /* the box takes the card's width under the row, not a slot beside a button */
  const box = screen.getByRole("textbox", { name: "Issue with this SWMS" });
  expect(box.closest(".sws-actions")).toBeNull();
  await userEvent.type(box, "The anchor is rusted");
  await userEvent.click(screen.getByRole("button", { name: "Tell the crew lead" }));
  expect(raiseSwmsIssue).toHaveBeenCalledWith({ personId: "p-dane", issue: "The anchor is rusted" });
});

/* A HELPER SIGNED ON THIS PHONE could never have an issue recorded after
   signing — the door was only ever on the reader's own row. */
it("lets whoever gave a sign-on on their phone add an issue to it", async () => {
  const given = doc();
  given.people[2] = { ...given.people[2], signon: withIssue("", { onPhoneOf: "Troy Porter", signedByStaffId: "troy" }) };
  render(<SwmsSignOn doc={given} me="troy" />);
  const kai = screen.getByText("Kai Lindqvist").closest(".sws-person") as HTMLElement;
  await userEvent.click(within(kai).getByRole("button", { name: "Raise an issue with this SWMS" }));
  await userEvent.type(screen.getByRole("textbox", { name: "Issue with this SWMS" }), "Kai says the ladder is too short");
  await userEvent.click(screen.getByRole("button", { name: "Tell the crew lead" }));
  expect(raiseSwmsIssue).toHaveBeenCalledWith({ personId: "p-kai", issue: "Kai says the ladder is too short" });
});

it("offers nobody else's row that door", () => {
  const given = doc();
  given.people[2] = { ...given.people[2], signon: withIssue("", { onPhoneOf: "Troy Porter", signedByStaffId: "troy" }) };
  render(<SwmsSignOn doc={given} me="dane" />);
  const kai = screen.getByText("Kai Lindqvist").closest(".sws-person") as HTMLElement;
  expect(within(kai).queryByRole("button", { name: /Raise an issue/ })).toBeNull();
});

/* signed on someone else's phone, the person in charge still signs to THEIR
   own promise — they give the briefing */
it("keeps the in-charge words when someone else holds the phone", async () => {
  const unsigned = doc();
  unsigned.people[0] = { ...unsigned.people[0], signon: null };
  render(<SwmsSignOn doc={unsigned} me="dane" />);
  const troy = screen.getByText("Troy Porter").closest(".sws-person") as HTMLElement;
  await userEvent.click(within(troy).getByRole("button", { name: "Sign them on" }));
  expect(screen.getByText(/They'll brief everyone it covers before work starts/)).toBeInTheDocument();
});

it("goes back to the job it came from", () => {
  render(<SwmsSignOn doc={doc()} me="dane" />);
  expect(screen.getByRole("link", { name: "← Job #2601" })).toHaveAttribute("href", "/dashboard/workboard?job=job-1");
});

it("says a sign-on a correction carried was given before it, without a version number", () => {
  const carried = doc({
    version: 2,
    versions: [
      { id: "v-1", version: 1, issuedAt: "2026-09-15T21:42:00.000Z", reason: "First issue", material: true, issuedBy: "Troy Porter" },
      { id: "v-2", version: 2, issuedAt: "2026-09-16T01:00:00.000Z", reason: "Hospital name was wrong", material: false, issuedBy: "Troy Porter" },
    ],
  });
  render(<SwmsSignOn doc={carried} me="troy" />);
  expect(screen.getByText("You signed on Wed 16 Sept, 7:50am, before a correction.")).toBeInTheDocument();
  expect(screen.queryByText(/version 1/)).toBeNull();
});
