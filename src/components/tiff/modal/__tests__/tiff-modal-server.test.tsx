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

const session = {
  n: 1,
  from: {} as HTMLElement,
  origin: { x: 900, y: 30 },
  openerId: null,
  still: false,
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
