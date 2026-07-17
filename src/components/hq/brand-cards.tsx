/* Brand pack cards — the /hq/data landing. One card per installed brand pack,
   linking into the drill-down. Presentational (server-safe, plain <a> like
   org-table). */

export interface BrandCardData {
  brand: string;
  name: string;
  packName: string;
  version: string;
  idu: number;
  odu: number;
  pairs: number;
  readyPct: number;
  blockingGaps: number;
  validationErrors: number;
  orphans: number;
}

export function HqBrandCards({ brands }: { brands: BrandCardData[] }) {
  if (brands.length === 0) {
    return <div className="hq-empty">No data packs installed.</div>;
  }
  return (
    <div className="hq-brandgrid">
      {brands.map((b) => (
        <a key={b.brand} className="hq-brandcard" href={`/hq/data/${b.brand}`}>
          <div className="hq-brandcard-top">
            <span className="hq-brandcard-name">{b.name}</span>
            <span className="hq-brandcard-ver">{b.version}</span>
          </div>
          <div className="hq-brandcard-pack">{b.packName}</div>
          <div className="hq-brandcard-stats hq-num">
            {b.idu} indoor · {b.odu} outdoor · {b.pairs} pairs
          </div>
          <div className="hq-brandcard-foot">
            <span className="hq-brandcard-ready">
              <b>{b.readyPct}%</b> engine-ready
              {b.blockingGaps > 0 ? (
                <span className="hq-brandcard-block"> · {b.blockingGaps} blocking</span>
              ) : null}
            </span>
            <span className="hq-brandcard-badges">
              {b.validationErrors > 0 ? (
                <span className="hq-badge error">{b.validationErrors} validation</span>
              ) : null}
              {b.orphans > 0 ? (
                <span className="hq-badge warn">{b.orphans} stale</span>
              ) : null}
              <span className="hq-arrow">→</span>
            </span>
          </div>
        </a>
      ))}
    </div>
  );
}
