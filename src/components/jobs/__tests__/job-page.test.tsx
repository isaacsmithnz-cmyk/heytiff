/* THE JOB'S PAGE AROUND THE CARD (v2, step 5): which section is open, kept
   in the address as `?tab=`; Pin and Copy the link under Actions; the name
   its open tab wears; and a row in the sidebar's Recents. The card's faces
   have their own suite (job-sheet-page.test.tsx); here the card is a stand-in
   that shows what the page hands it. */

import { act, render, screen } from "@testing-library/react";
import { WindowsContext, type WindowsApi } from "@/components/records/records-context";
import type { JobSheetPage } from "@/components/workboard/board/job-sheet";
import type { AllJobRow } from "@/lib/workboard/all-jobs";

const push = jest.fn();
let pathname = "/dashboard/jobs/j-3209";
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => pathname }));

let handed: { page: JobSheetPage; initialTab?: string; onCreateAgreement: (r: AllJobRow) => void } | null = null;
jest.mock("@/components/workboard/board/job-sheet", () => ({
  JobSheet: (p: { page: JobSheetPage; initialTab?: string; onCreateAgreement: (r: AllJobRow) => void }) => {
    handed = p;
    return <p>{`On ${p.page.section}`}</p>;
  },
}));

const pin = jest.fn(async () => true);
const unpin = jest.fn(async () => true);
const NO_PINS: never[] = [];
jest.mock("@/components/shell/pins-store", () => ({
  subscribePins: () => () => {},
  pinsSnapshot: () => NO_PINS,
  pinsServerSnapshot: () => NO_PINS,
  isPinned: () => false,
  pin: (...a: unknown[]) => pin(...(a as [])),
  unpin: (...a: unknown[]) => unpin(...(a as [])),
}));

/* New agreement opens over the page; its actions are "use server" modules */
const agreementFormContext = jest.fn(async () => ({ agreements: [], categories: [], connected: true, voiceless: false }));
jest.mock("@/app/actions/agreement-form", () => ({ agreementFormContext: () => agreementFormContext() }));
jest.mock("@/app/actions/workboard-maintenance", () => ({
  createAgreement: jest.fn(),
  createCategory: jest.fn(),
  addPackingItem: jest.fn(),
}));
jest.mock("@/app/actions/workboard-projects", () => ({ spawnAgreementFromProject: jest.fn() }));
jest.mock("@/app/actions/workboard", () => ({ searchJobs: jest.fn(async () => []) }));
jest.mock("@/app/actions/workboard-ai", () => ({ analyseSm8JobForAgreement: jest.fn() }));
jest.mock("@/components/notes/note-token", () => ({ NoteToken: () => <textarea aria-label="access notes" /> }));

import { JobPage } from "../job-page";
import { pageNamesSnapshot } from "@/components/shell/page-names";

const row = (): AllJobRow => ({
  key: "sm8:j-3209",
  kind: "sm8",
  id: "j-3209",
  number: "3209",
  numberSystem: "sm8",
  clientName: "Richards Building",
  title: "VRF",
  suburb: "North Narrabeen",
  categoryName: "Install",
  categoryColour: "#2E68FF",
  statusLabel: "Work Order",
  tone: "",
  date: null,
  dateLabel: "raised",
  booked: true,
  tracked: null,
  money: null,
  sortOn: "2026-10-01",
});

const remember = jest.fn();
const host = { windows: [], docked: true, close: jest.fn(), dismiss: jest.fn(), setAside: jest.fn(), restore: jest.fn(), stepOf: () => null, step: jest.fn(), reload: jest.fn(), toast: jest.fn(), recent: [], remember } as unknown as WindowsApi;

const draw = (section: "overview" | "photos" | "billing" = "overview") =>
  render(
    <WindowsContext.Provider value={host}>
      <JobPage row={row()} section={section} manage moneyVisible />
    </WindowsContext.Provider>,
  );

beforeEach(() => {
  handed = null;
  push.mockReset();
  remember.mockReset();
  pin.mockClear();
  pathname = "/dashboard/jobs/j-3209";
  window.history.replaceState(null, "", "/dashboard/jobs/j-3209");
});

it("opens the card on the section the address named, on that section's first face", () => {
  draw("billing");
  expect(screen.getByText("On billing")).toBeInTheDocument();
  expect(handed!.initialTab).toBe("money");
});

it("keeps the section in the address as ?tab=, replaced rather than stacked, and Overview as no tab at all", () => {
  draw();
  const before = window.history.length;
  act(() => handed!.page.onSection("photos"));
  expect(screen.getByText("On photos")).toBeInTheDocument();
  expect(window.location.pathname + window.location.search).toBe("/dashboard/jobs/j-3209?tab=photos");
  act(() => handed!.page.onSection("overview"));
  expect(window.location.search).toBe("");
  expect(window.history.length).toBe(before);
});

it("names its open tab with the job's number, short name and colour", () => {
  draw();
  expect(pageNamesSnapshot()["/dashboard/jobs/j-3209"]).toEqual({ label: "3209 Richards", hue: "blue" });
});

it("joins the sidebar's Recents as the job", () => {
  draw();
  expect(remember).toHaveBeenCalledWith({ key: "job.j-3209", ref: { kind: "job", id: "j-3209" }, title: "Job 3209", sub: "Richards Building" });
});

it("hands Actions Pin the job and Copy the link, and pins the job by its number and client", async () => {
  draw();
  expect(handed!.page.actions.map((a) => a.label)).toEqual(["Pin the job", "Copy the link"]);
  await act(async () => handed!.page.onAction("pin"));
  expect(pin).toHaveBeenCalledWith({ ref: { kind: "job", id: "j-3209" }, title: "Job 3209", sub: "Richards Building" });
});

it("copies the link to the job's page", async () => {
  const writeText = jest.fn(async () => {});
  Object.assign(navigator, { clipboard: { writeText } });
  draw();
  await act(async () => handed!.page.onAction("link"));
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/dashboard/jobs/j-3209`);
  expect(await screen.findByText("Link copied.")).toBeInTheDocument();
});

it("opens New agreement over the page from Create a maintenance agreement, the job filled in", async () => {
  draw();
  await act(async () => handed!.onCreateAgreement(row()));
  const form = screen.getByRole("dialog", { name: "New agreement" });
  expect(push).not.toHaveBeenCalled();
  expect(form).toHaveTextContent("Job 3209, Richards Building, North Narrabeen");
  expect(screen.getByLabelText("Client")).toHaveValue("Richards Building");
  // what the board would have handed over, read by the form itself
  expect(agreementFormContext).toHaveBeenCalled();
});
