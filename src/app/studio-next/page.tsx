import { notFound } from "next/navigation";
import "@/app/dashboard/shell.css";
import { NoteScopeProvider } from "@/components/notes/note-context";
import { ToastProvider } from "@/components/parts/toast";
import { TiffModalProvider } from "@/components/tiff/modal/tiff-host";
import { isTranscriptionConfigured } from "@/lib/voice/transcribe";
import { StudioNext } from "./studio-next";
import { isLocal } from "./local";

/* /studio-next: the Studio's next flow, on this Mac only (local.ts). */
export default async function StudioNextPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isLocal()) notFound();
  const { flow } = await searchParams;
  return (
    <div className="fg">
      <div className="gridbg" />
      <div className="main">
        <div className="outlet ds-kept">
          <ToastProvider>
            {/* Tiff's host, as the dashboard's frame mounts it */}
            <NoteScopeProvider voiceEnabled={isTranscriptionConfigured()}>
              <TiffModalProvider>
                <StudioNext flow={flow === "current" ? "current" : "next"} />
              </TiffModalProvider>
            </NoteScopeProvider>
          </ToastProvider>
        </div>
      </div>
    </div>
  );
}
