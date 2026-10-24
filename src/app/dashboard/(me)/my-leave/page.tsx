import { Button } from "@/components/parts/button";
import { Empty } from "@/components/parts/states";
import { MyLeave } from "@/components/timepay/my-leave";
import { loadMyLeave } from "@/lib/timepay/leave-page";

/* LEAVE (v2; Isaac's mock of 24 October 2026): Your name › Leave, a page of
   its own at the address it always had, as Timesheet is. It loads what the
   leave face of the old Me card loaded, `loadMyLeave`, and nothing else: the
   other four faces' reads no longer ride along.

   Ungated: booking your own leave is intrinsic. `timepay_all` gates
   everyone else's, never this. */
export default async function MyLeavePage() {
  const data = await loadMyLeave();

  if (!data)
    return (
      <div className="wrap lv2">
        <h1 className="lv2-h1">Leave</h1>
        <Empty
          what="No staff card yet"
          line="Your leave appears once your card exists in Team."
          action={
            <Button href="/dashboard/profile" kind="second">
              Open your card
            </Button>
          }
        />
      </div>
    );

  return <MyLeave {...data} />;
}
