[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/kyamano/btc-race-01/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/kyamano/btc-race-01/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

# Dip-and-Recovery — a cbBTC paper-trading bot

A trading bot for the make.fun 24-hour race
[`btc-race-24h-20261118-1444`](https://make.fun/bounty/btc-race-24h-20261118-1444).
It trades Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute bars with
1,000 USDC of paper money — a simulation only; nothing is traded for real.

## Strategy

Trades rarely, only when a move is already under way (a full round trip
costs about 26 bps in fees, slippage and impact):

- **Dip recovery entry:** the close is at least 1.2% below the highest
  close of the last 180 bars and at least 0.25% above the lowest close of
  the last 60 bars — a sharp fall that has stopped and turned.
- **Momentum entry:** the close is up at least 1.0% over the last 120 bars
  and within 0.5% of the 240-bar high, so a sustained rise is traded too.
- **Exits:** a 0.9% trailing stop from the peak close while held, a 0.9%
  hard stop and a 3.0% take-profit against the entry-trigger close, or a
  360-bar time stop — whichever comes first.
- **Risk:** one position at most, a 30-bar cool-down after every exit,
  slippage caps on every order, exact integer arithmetic throughout, so
  two runs on the same bars send byte-identical orders.

On the frozen dev window shipped with the kit, the local grader reports
a net PnL of about +$17.80 on the $1,000 start (4 trades, max drawdown
under 1%) — above the $0 dev gate that decides who races.

## Layout

- `main.ts` — the bot (Node 22, standard library only)
- `vendor/makefun-bars.ts` — the kit's bars-replay SDK shim, byte-identical
