import Link from "next/link";

// Placeholder — Stage 2 replaces this with the full interactive staff profile
// (per-card edit, work rights, payroll cost-split, permissions, etc.).
export default async function StaffProfilePage({
  params,
}: {
  params: Promise<{ staff: string }>;
}) {
  const { staff } = await params;
  const name = staff
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return (
    <div className="page in">
      <div className="wrap">
        <div className="stg">
          <div className="v2head" style={{ marginBottom: 32 }}>
            <div>
              <Link
                href="/dashboard/team"
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#9ca3af",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  marginBottom: 16,
                }}
              >
                ← Team
              </Link>
              <h1 style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>
                {name}
              </h1>
            </div>
          </div>
          <div
            style={{
              padding: "80px 16px",
              textAlign: "center",
              border: "1.5px dashed #e6e8ee",
              borderRadius: 24,
              background: "linear-gradient(180deg,#fafbfc,#fff)",
            }}
          >
            <b style={{ display: "block", fontSize: 16, fontWeight: 700, color: "#6b7280" }}>
              Staff profile
            </b>
            <em
              style={{
                fontStyle: "normal",
                display: "block",
                fontSize: 13,
                color: "#9ca3af",
                marginTop: 6,
              }}
            >
              Coming next.
            </em>
          </div>
        </div>
      </div>
    </div>
  );
}
