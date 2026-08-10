import { MyLeave } from "@/components/timepay/my-leave";
import { loadMyLeave } from "@/lib/timepay/leave-page";

/* Ungated: your own leave is intrinsic, like your timesheet and vehicle.
   The heading, the tabs and the page frame come from `(my-time)/layout.tsx`. */

export default async function MyLeavePage() {
  const data = await loadMyLeave();

  if (!data) {
    return (
      <div className="emptybox">
        <b>No staff record yet</b>
        <em>Your leave appears once your card exists in Team.</em>
      </div>
    );
  }

  return (
    <MyLeave
      today={data.today}
      standard={data.standard}
      balances={data.balances}
      requests={data.requests}
      holidays={data.holidays}
      workDays={data.workDays}
    />
  );
}
