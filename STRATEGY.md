# Strategy note

Long-only cbBTC/USDC on 1-minute bars, $1,000 paper start.

- Entry 1 (dip recovery): close >= 1.2% below the 180-bar high AND
  >= 0.25% above the 60-bar low.
- Entry 2 (momentum): close up >= 1.0% over 120 bars AND within 0.5%
  of the 240-bar high.
- Exit: trailing stop 0.9% from the peak close while held; hard stop
  0.9% / take-profit 3.0% vs the entry-trigger close; time stop 360 bars.
- One position, 30-bar cool-down after exits, slippage caps 300 bps
  (buys) / 500 bps (sells). All comparisons in exact bigint arithmetic.

Dev window (frozen, in the kit): local grade +$17.80, 4 trades,
max drawdown 0.98%, fees $1.62. Parameter neighbours were checked with
the local grader: trailing stop 70-100 bps all take the same trades;
the chosen values sit on plateaus, not edges.
