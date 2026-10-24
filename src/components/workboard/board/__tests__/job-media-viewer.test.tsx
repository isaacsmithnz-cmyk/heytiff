/* The viewer, white like every dialog (the mock of 25 October 2026, frame
   14): the file's name, its date and where it came from, "1 of 3", what can
   be done to it, Star on a photo, and the cross; Previous and Next in words;
   the strip underneath. What ends something is the red word and asks first,
   and the arrow keys keep walking the roll. */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JobMediaItem } from "@/lib/workboard/job-media";
import { JobMediaViewer, type ViewerAct } from "../job-media-viewer";

const item = (over: Partial<JobMediaItem> & { remoteId: string; name: string }): JobMediaItem => ({
  fileType: ".jpg",
  kind: "photo",
  origin: null,
  takenAt: null,
  url: "https://x/p.jpg",
  width: null,
  height: null,
  fromClaim: null,
  ...over,
});

const ROLL = [
  item({ remoteId: "1", name: "Quote #3385", fileType: ".pdf", kind: "document", origin: "Quote", takenAt: "2026-10-16 09:00:00", url: "https://x/q.pdf" }),
  item({ remoteId: "2", name: "Ceiling.jpg" }),
  item({ remoteId: "3", name: "Condenser.jpg" }),
];

const view = (over: Partial<Parameters<typeof JobMediaViewer>[0]> = {}) => {
  const props = { items: ROLL, index: 0, onNav: jest.fn(), onClose: jest.fn(), ...over };
  render(<JobMediaViewer {...props} />);
  return props;
};

it("heads itself with the file's name, its date and where it came from, and where it is in the roll", () => {
  view();
  const dialog = screen.getByRole("dialog", { name: "Quote #3385" });
  expect(within(dialog).getByRole("heading", { name: "Quote #3385" })).toBeInTheDocument();
  expect(within(dialog).getByText("Fri 16 Oct, 9:00am, Quote")).toBeInTheDocument();
  expect(within(dialog).getByText("1 of 3")).toBeInTheDocument();
  expect(within(dialog).queryByText("1 / 3")).toBeNull();
});

it("takes focus on the way in, and closes on the cross, the scrim and Escape", async () => {
  const props = view();
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveFocus();
  await userEvent.click(screen.getByRole("button", { name: "Close viewer" }));
  expect(props.onClose).toHaveBeenCalledTimes(1);
  await userEvent.click(document.querySelector(".wb2-mvscrim") as HTMLElement);
  expect(props.onClose).toHaveBeenCalledTimes(2);
  await userEvent.keyboard("{Escape}");
  expect(props.onClose).toHaveBeenCalledTimes(3);
});

it("says Previous and Next in words, only where there is one, and the arrow keys walk the roll", async () => {
  const props = view({ index: 1 });
  await userEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(props.onNav).toHaveBeenLastCalledWith(0);
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(props.onNav).toHaveBeenLastCalledWith(2);
  expect(screen.queryByText("‹")).toBeNull();
  expect(screen.queryByText("›")).toBeNull();
  fireEvent.keyDown(document, { key: "ArrowRight" });
  expect(props.onNav).toHaveBeenLastCalledWith(2);
  fireEvent.keyDown(document, { key: "ArrowLeft" });
  expect(props.onNav).toHaveBeenLastCalledWith(0);
});

it("has no Previous on the first and no Next on the last", () => {
  view({ index: 2 });
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  expect(screen.getByRole("button", { name: "Previous" })).toBeInTheDocument();
});

it("carries the roll underneath, jumping by thumbnail", async () => {
  const props = view();
  const strip = screen.getByRole("tablist", { name: "Photos on this job" });
  expect(within(strip).getByRole("tab", { name: "Quote #3385" })).toHaveAttribute("aria-selected", "true");
  await userEvent.click(within(strip).getByRole("tab", { name: "Condenser.jpg" }));
  expect(props.onNav).toHaveBeenLastCalledWith(2);
});

it("stars a photo with a button that says so in words", async () => {
  const onStar = jest.fn();
  const { rerender } = render(<JobMediaViewer items={ROLL} index={1} favourites={new Set()} onStar={onStar} onNav={() => {}} onClose={() => {}} />);
  const star = screen.getByRole("button", { name: "Star" });
  expect(star).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(star);
  expect(onStar).toHaveBeenCalledWith("2");
  rerender(<JobMediaViewer items={ROLL} index={1} favourites={new Set(["2"])} onStar={onStar} onNav={() => {}} onClose={() => {}} />);
  expect(screen.getByRole("button", { name: "Starred" })).toHaveAttribute("aria-pressed", "true");
});

it("draws no star on paper", () => {
  view();
  expect(screen.queryByRole("button", { name: /Star/ })).toBeNull();
});

describe("what can be done to the file, in the head", () => {
  it("runs a plain act at once", async () => {
    const run = jest.fn(async () => null);
    view({ actions: [{ key: "revise", label: "Revise", run }] });
    const revise = screen.getByRole("button", { name: "Revise" });
    expect(revise).toHaveClass("pt-btn--second");
    await userEvent.click(revise);
    expect(run).toHaveBeenCalled();
  });

  it("asks first for what ends something, in red, and Keep loses nothing", async () => {
    const run = jest.fn(async () => null as string | null);
    const act: ViewerAct = {
      key: "remove",
      label: "Remove",
      danger: true,
      closes: true,
      confirm: { heading: "Delete this file?", body: "It comes off the job, and nothing brings it back.", confirm: "Delete file", cancel: "Keep" },
      run,
    };
    const props = view({ actions: [act] });
    const remove = screen.getByRole("button", { name: "Remove" });
    expect(remove).toHaveClass("pt-btn--delete");
    await userEvent.click(remove);
    const ask = screen.getByRole("dialog", { name: "Delete this file?" });
    expect(within(ask).getByText("It comes off the job, and nothing brings it back.")).toBeInTheDocument();
    /* the arrows don't walk the roll behind the question */
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(props.onNav).not.toHaveBeenCalled();
    await userEvent.click(within(ask).getByRole("button", { name: "Keep" }));
    expect(run).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Delete this file?" })).getByRole("button", { name: "Delete file" }));
    expect(run).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
  });

  it("stays open and says why when it didn't land", async () => {
    const props = view({
      actions: [{ key: "renew", label: "Use renewal", busyLabel: "Switching to the renewal", run: async () => "Couldn't switch to the renewal.", closes: true }],
    });
    await userEvent.click(screen.getByRole("button", { name: "Use renewal" }));
    expect(await screen.findByText("Couldn't switch to the renewal.")).toBeInTheDocument();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("says what it is doing while the work is out, and holds the others", async () => {
    let finish: (v: string | null) => void = () => {};
    view({
      actions: [
        { key: "renew", label: "Use renewal", busyLabel: "Switching to the renewal", run: () => new Promise<string | null>((done) => (finish = done)) },
        { key: "remove", label: "Remove", danger: true, run: async () => null },
      ],
    });
    await userEvent.click(screen.getByRole("button", { name: "Use renewal" }));
    expect(screen.getByRole("button", { name: "Switching to the renewal" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
    finish(null);
    expect(await screen.findByRole("button", { name: "Use renewal" })).toBeEnabled();
  });
});

it("uses a line it is given where the date and origin don't say it", () => {
  view({ items: [ROLL[0]], line: "QBE, to 30 Jun 2027, added by Isaac Smith" });
  expect(screen.getByText("QBE, to 30 Jun 2027, added by Isaac Smith")).toBeInTheDocument();
  expect(screen.queryByText("1 of 1")).toBeNull();
});
