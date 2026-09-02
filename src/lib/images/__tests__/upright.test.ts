import { fileToUprightBase64 } from "../upright";

/* The guarantee under test is not "the image looks nicer". It is that the
   bytes handed to the vision API have the EXIF rotation BAKED IN — a phone
   photo of a form reached Tiff a quarter-turn over, because the API decodes
   pixels and ignores the orientation tag every viewer honours.

   Two halves, and the second matters as much as the first: the re-encode
   happens where a canvas can do it, and where one CANNOT — an old browser,
   jsdom, a codec that won't decode — the scan still gets the raw bytes rather
   than an exception. A rotated read is a worse read; a thrown one is a broken
   feature. */

const B64_HELLO = "aGVsbG8="; // "hello"

function file(type: string, name = "doc"): File {
  return new File(["hello"], name, { type });
}

/** A canvas that records how it was sized and hands back a JPEG data URL. */
function stubCanvas(): { width: () => number; height: () => number } {
  const drawn = { w: 0, h: 0 };
  jest
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(function (this: HTMLCanvasElement) {
      drawn.w = this.width;
      drawn.h = this.height;
      return { fillStyle: "", fillRect: jest.fn(), drawImage: jest.fn() } as unknown as CanvasRenderingContext2D;
    } as unknown as typeof HTMLCanvasElement.prototype.getContext);
  jest
    .spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockReturnValue(`data:image/jpeg;base64,${B64_HELLO}`);
  return { width: () => drawn.w, height: () => drawn.h };
}

/** `createImageBitmap` isn't in jsdom, so every test that wants one installs it. */
function stubBitmaps(width: number, height: number) {
  const calls: (ImageBitmapOptions | undefined)[] = [];
  const close = jest.fn();
  (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = jest.fn(
    async (_src: unknown, opts?: ImageBitmapOptions) => {
      calls.push(opts);
      return { width, height, close } as unknown as ImageBitmap;
    },
  );
  return { calls, close };
}

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as unknown as { createImageBitmap?: unknown }).createImageBitmap;
});

describe("a photo that can be redrawn", () => {
  it("asks for the EXIF rotation to be applied, and reports the type it re-encoded to", async () => {
    const { calls } = stubBitmaps(4000, 2252); // the green slip, as the phone stored it
    stubCanvas();

    const out = await fileToUprightBase64(file("image/jpeg", "greenslip.jpg"));

    // the whole point: without this option the tag is ignored and the form
    // arrives sideways at the one reader that can't turn its head
    expect(calls[0]).toEqual({ imageOrientation: "from-image" });
    expect(out).toEqual({ data: B64_HELLO, mediaType: "image/jpeg" });
  });

  it("re-encodes a PNG as a JPEG and says so — the media type is what the API validates", async () => {
    stubBitmaps(800, 600);
    stubCanvas();
    expect((await fileToUprightBase64(file("image/png"))).mediaType).toBe("image/jpeg");
  });

  it("closes the decoded bitmap", async () => {
    const { close } = stubBitmaps(800, 600);
    stubCanvas();
    await fileToUprightBase64(file("image/jpeg"));
    expect(close).toHaveBeenCalled();
  });

  it("bounds the long edge and keeps the aspect ratio", async () => {
    stubBitmaps(4000, 2252);
    const canvas = stubCanvas();
    await fileToUprightBase64(file("image/jpeg"));
    expect(canvas.width()).toBe(2400);
    expect(canvas.height()).toBe(Math.round((2252 * 2400) / 4000));
  });

  it("leaves an already-small photo alone rather than blowing it up", async () => {
    stubBitmaps(900, 1200);
    const canvas = stubCanvas();
    await fileToUprightBase64(file("image/jpeg"));
    expect(canvas.width()).toBe(900);
    expect(canvas.height()).toBe(1200);
  });
});

describe("everything that can't be redrawn still scans", () => {
  it("passes a PDF renewal notice through byte for byte", async () => {
    stubBitmaps(10, 10); // available, and still must not be used on a PDF
    stubCanvas();
    expect(await fileToUprightBase64(file("application/pdf", "rego.pdf"))).toEqual({
      data: B64_HELLO,
      mediaType: "application/pdf",
    });
  });

  it("passes a GIF through — no orientation tag to apply", async () => {
    stubBitmaps(10, 10);
    stubCanvas();
    expect((await fileToUprightBase64(file("image/gif"))).mediaType).toBe("image/gif");
  });

  it("falls back to the raw bytes where there is no createImageBitmap", async () => {
    expect(await fileToUprightBase64(file("image/jpeg"))).toEqual({
      data: B64_HELLO,
      mediaType: "image/jpeg",
    });
  });

  it("falls back when the decode throws", async () => {
    (globalThis as unknown as { createImageBitmap: unknown }).createImageBitmap = jest.fn(
      async () => {
        throw new Error("unsupported codec");
      },
    );
    expect(await fileToUprightBase64(file("image/jpeg"))).toEqual({
      data: B64_HELLO,
      mediaType: "image/jpeg",
    });
  });

  it("falls back when the canvas can't give a 2D context", async () => {
    stubBitmaps(800, 600);
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect((await fileToUprightBase64(file("image/webp"))).mediaType).toBe("image/webp");
  });

  it("falls back when the canvas won't encode a JPEG", async () => {
    stubBitmaps(800, 600);
    stubCanvas();
    jest.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:,");
    expect((await fileToUprightBase64(file("image/jpeg"))).mediaType).toBe("image/jpeg");
    // and the payload is the original file, not the empty encode
    expect((await fileToUprightBase64(file("image/jpeg"))).data).toBe(B64_HELLO);
  });
});
