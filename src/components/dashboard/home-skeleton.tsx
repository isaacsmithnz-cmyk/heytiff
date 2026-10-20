/* HOME'S OWN HOLD (Isaac, 20 October: "when you click home, it does
   skeleton loading, but it's not even in the right spot"). The generic
   hold (shell/page-skeleton) is a title and rows in a full-width band;
   Home is one centred column, so it holds its own shape: the mark, the box,
   and the three columns, each where it lands. Nothing here is real or pressable. */
export function HomeSkeleton() {
  return (
    <div className="page in" aria-busy="true" aria-live="polite">
      <div className="wrap hm">
        <span className="pk-sr">Loading</span>
        <div className="hm-ask" aria-hidden="true">
          <span className="pk-b hm-pk-mark" />
          <span className="pk-b hm-pk-box" />
        </div>
        <div className="hm-cols" aria-hidden="true">
          {[3, 4, 4].map((n, i) => (
            <div className="hm-sec" key={i}>
              <div className="hm-head">
                <span className="pk-b hm-pk-blk" />
                <span className="pk-b hm-pk-h" />
              </div>
              <div className="pk">
                {Array.from({ length: n }, (_, j) => (
                  <div className="pk-row" key={j}>
                    <span className="pk-b pk-l2" />
                    <span className="pk-b pk-l1" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
