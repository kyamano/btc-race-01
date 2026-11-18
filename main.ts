// Dip-and-recovery bot for the cbBTC 24h race (agent-fun/bars-replay/v1).
//
// Idea, kept deliberately simple and robust: this market falls in steps and
// bounces in steps, and a full round trip costs about 26 bps, so the bot
// trades rarely and only when a move is already under way.
//
//   Entry (either signal, only when flat and past the cool-down):
//     1. Dip recovery: the latest close is at least DROP_BPS below the
//        highest close of the last HI_BARS bars (a real dip, not noise) and
//        at least REBOUND_BPS above the lowest close of the last LO_BARS
//        bars (the fall has stopped and turned). Buying the first green
//        step after a sharp fall, never the fall itself.
//     2. Momentum continuation: the close is up at least MOMENTUM_BPS over
//        the last MOMENTUM_BARS bars and sits within NEAR_HIGH_BPS of the
//        highest close of the last HIGH2_BARS bars, so a sustained rise in
//        a rising race window is traded too, not just dips.
//   Exit (whole position, whichever comes first):
//     - trailing stop: close falls TRAIL_BPS below the highest close seen
//       while holding;
//     - hard stop: close falls STOP_BPS below the close that triggered the
//       entry (the fill lands at the next open, close to that close);
//     - take profit: close rises TAKE_PROFIT_BPS above that entry close;
//     - time stop: MAX_HOLD_BARS bars in the position.
//   Risk: one position at most, sized by the hello caps; a COOLDOWN_BARS
//   pause after every exit so fees cannot churn the account; every order
//   carries a slippage cap so a wild next open refuses the fill instead of
//   taking a bad price, and the signal is simply read again next bar.
//
// All comparisons are exact bigint cross-multiplications on the integer
// closes, so two runs on the same bars send byte-identical orders. Only
// the kit SDK shim in vendor/ is used; no network, no clock, no files.

import { BPS, runBars, type BarsState, type OrderInput } from './vendor/makefun-bars.ts';

/** Bars of history behind the dip's reference high. */
const HI_BARS = 180;
/** Bars of history behind the rebound's reference low. */
const LO_BARS = 60;
/** A dip counts once the close is this far below the reference high. */
const DROP_BPS = 120;
/** The turn counts once the close is this far above the reference low. */
const REBOUND_BPS = 25;
/** Momentum lookback, in bars. */
const MOMENTUM_BARS = 120;
/** A rise counts once the close is up this much over the lookback. */
const MOMENTUM_BPS = 100;
/** Bars of history behind the momentum signal's reference high. */
const HIGH2_BARS = 240;
/** The close must sit within this of that high for momentum to count. */
const NEAR_HIGH_BPS = 50;
/** Exit when the close falls this far below the peak close while held.
 * 90 sits in the middle of the flat 70-100 bps plateau the local grader
 * shows on the dev window (60 bps churns and loses; 70, 80, 90 and 100
 * all take the same four trades), so the exit is not on an edge. */
const TRAIL_BPS = 90;
/** Exit when the close falls this far below the entry-trigger close. */
const STOP_BPS = 90;
/** Exit when the close rises this far above the entry-trigger close. */
const TAKE_PROFIT_BPS = 300;
/** Exit after this many bars in the position, whatever the price did. */
const MAX_HOLD_BARS = 360;
/** Bars to stay flat after an exit before any new entry. */
const COOLDOWN_BARS = 30;
/** Slippage caps: buys refuse a next open far above the decision close. */
const BUY_MAX_SLIPPAGE_BPS = 300;
/** Sells get a wider cap so an exit is not stranded by one fast bar. */
const SELL_MAX_SLIPPAGE_BPS = 500;

/** Every close seen so far, oldest first (integer, price-scale units). */
const closes: bigint[] = [];
/** Highest close since the current position's entry was triggered. */
let peak: bigint | null = null;
/** The close that triggered the current entry (the fill lands near it). */
let entryClose: bigint | null = null;
/** Batches the current position has been held for. */
let barsHeld = 0;
/** The batch seq of the last exit; -infinity before the first trade. */
let lastExitSeq = -1_000_000_000;

/** The largest of the last `n` closes, or null before `n` bars exist. */
function highest(n: number): bigint | null {
  if (closes.length < n) return null;
  let hi = closes[closes.length - n]!;
  for (let i = closes.length - n + 1; i < closes.length; i++) if (closes[i]! > hi) hi = closes[i]!;
  return hi;
}

/** The smallest of the last `n` closes, or null before `n` bars exist. */
function lowest(n: number): bigint | null {
  if (closes.length < n) return null;
  let lo = closes[closes.length - n]!;
  for (let i = closes.length - n + 1; i < closes.length; i++) if (closes[i]! < lo) lo = closes[i]!;
  return lo;
}

/** Whether `now` is at least `bps` below `ref`: now * BPS <= ref * (BPS - bps). */
const belowBy = (now: bigint, ref: bigint, bps: number) => now * BPS <= ref * (BPS - BigInt(bps));
/** Whether `now` is at least `bps` above `ref`: now * BPS >= ref * (BPS + bps). */
const aboveBy = (now: bigint, ref: bigint, bps: number) => now * BPS >= ref * (BPS + BigInt(bps));

/** Whether either entry signal fires on the latest close. */
function entrySignal(now: bigint): boolean {
  const hi = highest(HI_BARS);
  const lo = lowest(LO_BARS);
  if (hi !== null && lo !== null && belowBy(now, hi, DROP_BPS) && aboveBy(now, lo, REBOUND_BPS)) return true;
  const hi2 = highest(HIGH2_BARS);
  if (hi2 !== null && closes.length > MOMENTUM_BARS) {
    const then = closes[closes.length - 1 - MOMENTUM_BARS]!;
    if (aboveBy(now, then, MOMENTUM_BPS) && !belowBy(now, hi2, NEAR_HIGH_BPS)) return true;
  }
  return false;
}

/** Whether the held position exits on the latest close. */
function exitSignal(now: bigint): boolean {
  if (peak !== null && belowBy(now, peak, TRAIL_BPS)) return true;
  if (entryClose !== null && belowBy(now, entryClose, STOP_BPS)) return true;
  if (entryClose !== null && aboveBy(now, entryClose, TAKE_PROFIT_BPS)) return true;
  return barsHeld >= MAX_HOLD_BARS;
}

await runBars({
  onBatch(state: BarsState, batch) {
    const symbol = state.hello.symbols[0]!.symbol;
    const now = state.close(symbol);
    if (now === null) return [];
    closes.push(now);

    const held = state.positions.get(symbol);
    const orders: OrderInput[] = [];
    if (held !== undefined) {
      barsHeld++;
      if (peak === null || now > peak) peak = now;
      if (exitSignal(now)) {
        orders.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: SELL_MAX_SLIPPAGE_BPS });
        peak = null;
        entryClose = null;
        barsHeld = 0;
        lastExitSeq = batch.seq;
      }
      return orders;
    }

    if (batch.seq - lastExitSeq < COOLDOWN_BARS) return orders;
    if (!entrySignal(now)) return orders;

    const { caps, fees } = state.hello;
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    const notional = state.cash < byWeight ? state.cash : byWeight;
    if (notional === 0n || notional < BigInt(fees.min_notional_quote_units)) return orders;
    orders.push({ side: 'buy', symbol, notional_quote_units: notional, max_slippage_bps: BUY_MAX_SLIPPAGE_BPS });
    peak = now;
    entryClose = now;
    barsHeld = 0;
    return orders;
  },
});
