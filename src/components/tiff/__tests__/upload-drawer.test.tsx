import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UploadDrawer } from "../upload-drawer";

/* The upload drawer.

   What these pin: the drawer OFFERS a guess and never enforces it (title and
   category arrive prefilled and editable); a file the bucket would refuse is
   refused here, before a slot is asked for; and the uploads run one after the
   other, each handing its document to the library's reading queue as it
   lands. */

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const uploadKbFile = jest.fn();
jest.mock("@/lib/tiff/upload-client", () => ({
  uploadKbFile: (...a: unknown[]) => uploadKbFile(...(a as [])),
}));

const pdf = (name: string) => new File([new Uint8Array(8)], name, { type: "application/pdf" });

/** jsdom builds a File with the real byte length; the size checks want a
    manual's worth of bytes, so it is stamped on after the fact. */
const sized = (file: File, size: number) => {
  Object.defineProperty(file, "size", { value: size });
  return file;
};

const drop = async (files: File[]) => {
  const zone = screen.getByText("Drop PDFs here").closest(".tk-drop") as HTMLElement;
  // userEvent has no drop; the component reads dataTransfer.files directly
  const event = new Event("drop", { bubbles: true }) as Event & { dataTransfer?: unknown };
  event.dataTransfer = { files };
  zone.dispatchEvent(event);
  await waitFor(() => expect(screen.getByText(files[0].name)).toBeInTheDocument());
};

beforeEach(() => jest.clearAllMocks());
afterEach(cleanup);

describe("what the drawer offers before anything is stored", () => {
  it("prefills a title and a category from the filename, both editable", async () => {
    render(<UploadDrawer progress={{}} onIngest={jest.fn()} onClose={jest.fn()} />);
    await drop([pdf("PUZ-ZM250_installation-manual.pdf")]);

    expect(screen.getByDisplayValue("PUZ-ZM250 Installation Manual")).toBeInTheDocument();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("install");

    await userEvent.selectOptions(screen.getByRole("combobox"), "specs");
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("specs");
  });

  it("refuses a file the bucket would refuse, before a slot is asked for", async () => {
    render(<UploadDrawer progress={{}} onIngest={jest.fn()} onClose={jest.fn()} />);
    await drop([new File(["x"], "site-photo.png", { type: "image/png" })]);

    expect(screen.getByText("The knowledge base takes PDFs only.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Upload documents/ })).toBeDisabled();
  });

  it("refuses a file over the 50 MB ceiling", async () => {
    render(<UploadDrawer progress={{}} onIngest={jest.fn()} onClose={jest.fn()} />);
    await drop([sized(pdf("huge-manual.pdf"), 60 * 1024 * 1024)]);

    expect(screen.getByText(/too big/)).toBeInTheDocument();
  });

  it("lets a file be taken back out of the list before anything starts", async () => {
    render(<UploadDrawer progress={{}} onIngest={jest.fn()} onClose={jest.fn()} />);
    await drop([pdf("fault-codes.pdf")]);

    await userEvent.click(screen.getByRole("button", { name: "Remove fault-codes.pdf" }));
    expect(screen.queryByText("fault-codes.pdf")).not.toBeInTheDocument();
  });
});

describe("driving the uploads", () => {
  it("uploads one after the other and hands each one to the reading queue", async () => {
    const onIngest = jest.fn();
    uploadKbFile
      .mockResolvedValueOnce({ ok: true, documentId: "d-1" })
      .mockResolvedValueOnce({ ok: true, documentId: "d-2" });

    render(<UploadDrawer progress={{}} onIngest={onIngest} onClose={jest.fn()} />);
    await drop([pdf("fault-codes.pdf"), pdf("install-guide.pdf")]);

    await userEvent.click(screen.getByRole("button", { name: /Upload 2 documents/ }));

    await waitFor(() => expect(uploadKbFile).toHaveBeenCalledTimes(2));
    expect(uploadKbFile.mock.calls[0][1]).toMatchObject({ category: "faults", title: "Fault Codes" });
    expect(uploadKbFile.mock.calls[1][1]).toMatchObject({ category: "install", title: "Install Guide" });
    expect(onIngest.mock.calls).toEqual([[["d-1"]], [["d-2"]]]);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows a failed upload's reason on its own row and keeps going", async () => {
    uploadKbFile
      .mockResolvedValueOnce({ ok: false, error: "That upload didn't finish." })
      .mockResolvedValueOnce({ ok: true, documentId: "d-2" });

    render(<UploadDrawer progress={{}} onIngest={jest.fn()} onClose={jest.fn()} />);
    await drop([pdf("fault-codes.pdf"), pdf("install-guide.pdf")]);

    await userEvent.click(screen.getByRole("button", { name: /Upload 2 documents/ }));

    expect(await screen.findByText("That upload didn't finish.")).toBeInTheDocument();
    await waitFor(() => expect(uploadKbFile).toHaveBeenCalledTimes(2));
  });

  it("reports the reading progress the library's queue reports", async () => {
    uploadKbFile.mockResolvedValue({ ok: true, documentId: "d-1" });
    const { rerender } = render(<UploadDrawer progress={{}} onIngest={jest.fn()} onClose={jest.fn()} />);
    await drop([pdf("fault-codes.pdf")]);
    await userEvent.click(screen.getByRole("button", { name: /Upload 1 document/ }));
    await waitFor(() => expect(uploadKbFile).toHaveBeenCalled());

    rerender(
      <UploadDrawer
        progress={{ "d-1": { status: "processing", pagesDone: 20, pageCount: 220 } }}
        onIngest={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByText("Reading… 20 of 220 pages")).toBeInTheDocument();

    rerender(
      <UploadDrawer
        progress={{ "d-1": { status: "ready", pagesDone: 220, pageCount: 220 } }}
        onIngest={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByText("Ready — Tiff can quote it")).toBeInTheDocument();
  });
});

describe("closing", () => {
  it("the scrim closes the drawer while nothing is moving", async () => {
    const onClose = jest.fn();
    const { container } = render(<UploadDrawer progress={{}} onIngest={jest.fn()} onClose={onClose} />);

    await userEvent.click(container.ownerDocument.querySelector(".tk-scrim") as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape closes it too", async () => {
    const onClose = jest.fn();
    render(<UploadDrawer progress={{}} onIngest={jest.fn()} onClose={onClose} />);

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("locks the page behind it, and gives the scroll back on the way out", () => {
    const { unmount } = render(<UploadDrawer progress={{}} onIngest={jest.fn()} onClose={jest.fn()} />);
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("holds the scrim shut while bytes are actually moving", async () => {
    const onClose = jest.fn();
    let land: (v: unknown) => void = () => {};
    uploadKbFile.mockImplementation(() => new Promise((res) => (land = res)));

    const { container } = render(<UploadDrawer progress={{}} onIngest={jest.fn()} onClose={onClose} />);
    await drop([pdf("fault-codes.pdf")]);
    await userEvent.click(screen.getByRole("button", { name: /Upload 1 document/ }));
    await waitFor(() => expect(uploadKbFile).toHaveBeenCalled());

    await userEvent.click(container.ownerDocument.querySelector(".tk-scrim") as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();

    land({ ok: true, documentId: "d-1" });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe("the row's own state", () => {
  it("names each file and its size", async () => {
    render(<UploadDrawer progress={{}} onIngest={jest.fn()} onClose={jest.fn()} />);
    await drop([sized(pdf("fault-codes.pdf"), 4 * 1024 * 1024)]);

    const row = screen.getByText("fault-codes.pdf").closest(".tk-file") as HTMLElement;
    expect(within(row).getByText("4.0 MB")).toBeInTheDocument();
  });
});
