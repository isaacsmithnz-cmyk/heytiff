"use client";

/* The Studio in the next flow, its designs kept in this browser. `?flow=current`
   runs the shipping flow on the same designs, to compare the two. */

import { useEffect, useState } from "react";
import { Studio } from "@/components/studio/studio";
import type { StudioFlow } from "@/components/studio/flow";
import { LocalDesignStore } from "@/lib/studio/store";
import type { PageImage, PlanImages } from "@/lib/studio/plans";
import type { PlanReading } from "@/lib/studio/reading";
import type { DataPack } from "@/lib/studio/packs/schema";
import { NO_BRAND } from "@/lib/org/brand";

class LocalPlanImages implements PlanImages {
  private urls = new Map<string, string>();
  private async put(blob: Blob, ext: string): Promise<string> {
    const res = await fetch(`/studio-next/api/upload?ext=${ext}`, {
      method: "POST",
      body: blob,
      headers: { "content-type": blob.type || "application/octet-stream" },
    });
    const body = (await res.json()) as { ref?: string; error?: string };
    if (!body.ref) throw new Error(body.error ?? "The plan couldn't be stored");
    return body.ref;
  }
  upload(page: PageImage): Promise<string> {
    if (!page.blob || !page.ext) throw new Error("cannot upload a page with no image data");
    return this.put(page.blob, page.ext);
  }
  uploadSource(file: File): Promise<string> {
    return this.put(file, file.type === "application/pdf" ? "pdf" : file.type === "image/jpeg" ? "jpeg" : "png");
  }
  async sourceFile(ref: string): Promise<File> {
    const blob = await (await fetch(await this.url(ref))).blob();
    return new File([blob], ref, { type: blob.type });
  }
  async url(ref: string): Promise<string> {
    const held = this.urls.get(ref);
    if (held) return held;
    const body = (await (await fetch(`/studio-next/api/url?ref=${encodeURIComponent(ref)}`)).json()) as { url?: string };
    if (!body.url) throw new Error("The plan couldn't be fetched");
    this.urls.set(ref, body.url);
    return body.url;
  }
  /* only what a dialog sent up early and didn't use (new-design.tsx) */
  async remove(ref: string): Promise<void> {
    await fetch("/studio-next/api/remove", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ref }) });
  }
}

export function StudioNext({ flow }: { flow: StudioFlow }) {
  /* browser-only: the store reads localStorage, which the server has none of */
  const [held, setHeld] = useState<{ store: LocalDesignStore; images: LocalPlanImages } | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHeld({ store: new LocalDesignStore(window.localStorage), images: new LocalPlanImages() });
  }, []);
  if (!held) return null;
  const { store, images } = held;
  return (
    <Studio
      flow={flow}
      store={store}
      planImages={images}
      sm8Jobs={false}
      brand={NO_BRAND}
      jobSearch={async () => []}
      packLoader={async () => (await (await fetch("/studio-next/api/pack")).json()) as { pack: DataPack; version: string } | null}
      planReader={async (designId) => {
        const doc = await store.load(designId);
        if (!doc) return null;
        const res = await fetch("/studio-next/api/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(doc) });
        const body = (await res.json()) as { ok: boolean; reading?: PlanReading };
        return body.ok && body.reading ? body.reading : null;
      }}
    />
  );
}
