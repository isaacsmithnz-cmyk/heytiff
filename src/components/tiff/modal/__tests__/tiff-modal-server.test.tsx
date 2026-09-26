/**
 * @jest-environment node
 */
import { renderToString } from "react-dom/server";
import { NoteScopeProvider } from "@/components/notes/note-context";
import { TiffModalProvider } from "../tiff-host";
import { TiffModal } from "../tiff-modal";

/* NOTHING MEASURES IN RENDER. The host sits in the dashboard layout, which
   the server renders for every page, and the modal is drawn from state a
   click set. Where the button was, how the page is laid out and whether
   motion is reduced are all read in the click or after mount — a layout read
   in a render body is the hydration trap this codebase has paid for once.
   Here there is no window at all, so any such read throws. */

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
  usePathname: () => "/dashboard",
}));
jest.mock("@/lib/brain/ask-client", () => ({ askBrain: () => {} }));
jest.mock("@/app/actions/workboard-notes", () => ({
  routeNote: () => new Promise(() => {}),
  continueNote: () => new Promise(() => {}),
  fileNote: () => new Promise(() => {}),
  undoNote: () => new Promise(() => {}),
  keepWords: () => new Promise(() => {}),
  publishNoteKb: () => new Promise(() => {}),
  dismissNote: () => new Promise(() => {}),
}));
jest.mock("@/app/actions/calendar", () => ({
  fileCalendarLine: () => new Promise(() => {}),
  noteOnCalendarEvents: () => new Promise(() => {}),
  undoCalendarLine: () => new Promise(() => {}),
}));

const session = {
  n: 1,
  from: {} as HTMLElement,
  origin: { x: 900, y: 30 },
  openerId: null,
  still: false,
  keyboard: false,
  at: 0,
};

it("has no window to read", () => {
  expect(typeof window).toBe("undefined");
});

it("renders the host, inert, with no window", () => {
  const html = renderToString(
    <NoteScopeProvider voiceEnabled>
      <TiffModalProvider>
        <p>page</p>
      </TiffModalProvider>
    </NoteScopeProvider>
  );
  expect(html).toContain("page");
  expect(html).not.toContain('role="dialog"');
});

it("renders an open modal, listening, with no window", () => {
  const html = renderToString(
    <NoteScopeProvider voiceEnabled>
      <TiffModal session={session} onClosed={() => {}} />
    </NoteScopeProvider>
  );
  expect(html).toContain('aria-label="Tiff"');
  expect(html).toContain("Done");
});

it("renders one opened on typed words, with no window", () => {
  const html = renderToString(
    <NoteScopeProvider voiceEnabled={false}>
      <TiffModal session={{ ...session, words: "Callum picks up the filters", room: "diary" }} onClosed={() => {}} />
    </NoteScopeProvider>
  );
  expect(html).toContain("Callum picks up the filters");
  expect(html).toContain("Diary");
});

/* THE HOST IS MOUNTED, AND THE LAYOUT STAYS SYNCHRONOUS. Drop the host from
   the dashboard layout and nothing fails loudly: every Tiff button quietly
   opens nothing. It sits inside the note scope because the modal reads it,
   and the layout must never await (see its own header). */
it("the dashboard layout mounts the host inside the note scope, and never awaits", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const src = readFileSync(join(process.cwd(), "src/app/dashboard/layout.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\}/g, "");
  const scope = [src.indexOf("<NoteScopeProvider"), src.indexOf("</NoteScopeProvider>")];
  const host = [src.indexOf("<TiffModalProvider>"), src.indexOf("</TiffModalProvider>")];
  expect(host[0]).toBeGreaterThan(scope[0]);
  expect(host[1]).toBeGreaterThan(host[0]);
  expect(scope[1]).toBeGreaterThan(host[1]);
  expect(src).toMatch(/export default function DashboardLayout/);
  expect(src).not.toMatch(/\basync\b|\bawait\b/);
});
