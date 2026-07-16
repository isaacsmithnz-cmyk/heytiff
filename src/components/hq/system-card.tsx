/* System & support card — the panel to screenshot for tech support. Shows
   environment/runtime facts and a set/missing checklist of required env vars.
   NEVER renders a value — only whether each var is set (booleans computed
   server-side and passed in). Presentational. */

export interface SysFact {
  label: string;
  value: string;
}
export interface EnvFlag {
  name: string;
  set: boolean;
}

export function SystemCard({ facts, env }: { facts: SysFact[]; env: EnvFlag[] }) {
  return (
    <div className="hq-syscard">
      <div className="hq-sys-facts">
        {facts.map((f) => (
          <div className="hq-sys-fact" key={f.label}>
            <span className="hq-sys-k">{f.label}</span>
            <span className="hq-sys-v">{f.value}</span>
          </div>
        ))}
      </div>
      <div className="hq-sys-env">
        {env.map((e) => (
          <span key={e.name} className={`hq-env ${e.set ? "set" : "miss"}`}>
            {e.set ? "✓" : "✗"} {e.name}
          </span>
        ))}
      </div>
    </div>
  );
}
