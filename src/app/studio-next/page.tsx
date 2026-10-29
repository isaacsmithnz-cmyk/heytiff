import { notFound } from "next/navigation";
import "@/app/dashboard/shell.css";
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
          <StudioNext flow={flow === "current" ? "current" : "next"} />
        </div>
      </div>
    </div>
  );
}
