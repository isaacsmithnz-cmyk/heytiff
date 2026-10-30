import { act, fireEvent, render, screen } from "@testing-library/react";

/* Send pressed while the microphone's open: it stops, and what was said goes
   (3423, Isaac, 30 October 2026) */
type Dict = { recording: boolean; arming: boolean; transcribing: boolean; seconds: number; interim: string; start: jest.Mock; stop: jest.Mock };
const dict: Dict = { recording: true, arming: false, transcribing: false, seconds: 3, interim: "", start: jest.fn(), stop: jest.fn() };
let hear: (said: string) => void = () => undefined;
jest.mock("@/components/notes/dictation", () => ({
  appendSpoken: (now: string, said: string) => (now ? `${now} ${said}` : said),
  DictClock: () => null,
  useDictation: (o: { onTranscript: (s: string) => void }) => {
    hear = o.onTranscript;
    return dict;
  },
}));
jest.mock("@/components/notes/use-reply-draft", () => ({ useReplyDraft: () => undefined }));

import { TiffPanel } from "../tiff-panel";

const respond = (body: unknown) => ({ json: async () => body });
const posted = () => ((global as unknown as { fetch: jest.Mock }).fetch.mock.calls as [string, RequestInit?][]).filter(([, o]) => o?.method === "POST");

beforeEach(() => {
  Object.assign(dict, { recording: true, arming: false, transcribing: false });
  dict.stop.mockReset();
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => respond({ ok: true, on: true, me: "m", events: [{ id: 1, turnId: "t", kind: "reply", author: "tiff", body: { text: "Hello" }, at: "" }], working: false }));
});

it("takes Send while you're talking: stops the microphone, then sends the words once they're back", async () => {
  const { rerender } = render(<TiffPanel job="j" onChanged={jest.fn()} />);
  await act(async () => {});
  const sendBtn = screen.getByRole("button", { name: "Send" });
  expect(sendBtn).toBeEnabled();
  fireEvent.click(sendBtn);
  expect(dict.stop).toHaveBeenCalledTimes(1);
  expect(posted()).toHaveLength(0);

  /* the recorder stopped, and the words are being written down */
  Object.assign(dict, { recording: false, transcribing: true });
  rerender(<TiffPanel job="j" onChanged={jest.fn()} />);
  expect(posted()).toHaveLength(0);

  await act(async () => {
    hear("Six hours for two");
    Object.assign(dict, { transcribing: false });
  });
  rerender(<TiffPanel job="j" onChanged={jest.fn()} />);
  await act(async () => {});
  expect(posted()).toHaveLength(1);
  expect(JSON.parse(posted()[0]![1]!.body as string)).toMatchObject({ job: "j", message: "Six hours for two" });
});

it("has Send off when nothing's typed and the microphone is closed", async () => {
  Object.assign(dict, { recording: false });
  render(<TiffPanel job="j" onChanged={jest.fn()} />);
  await act(async () => {});
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
});

it("draws her points as a list, with no asterisks", async () => {
  Object.assign(dict, { recording: false });
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => respond({ ok: true, on: true, me: "m", events: [{ id: 1, turnId: "t", kind: "reply", author: "tiff", body: { text: "Built.\n\n- **Labour:** 12 h." }, at: "" }], working: false }));
  render(<TiffPanel job="j" onChanged={jest.fn()} />);
  await act(async () => {});
  expect(screen.getByRole("listitem")).toHaveTextContent("Labour: 12 h.");
  expect(screen.queryByText(/\*\*/)).toBeNull();
});
