# Polymarket BTC Up/Down 5m Trading Bot — Plan

## Goal

Build a **long-running Node.js service** that:

1. **Gets market data** for the BTC up or down 5m event (`btc-updown-5m-1771778400`).
2. **Authenticates** with your Polymarket account (EOA or proxy + optional gasless).
3. **Opens and closes positions** using a **pluggable strategy** (arbitrary algorithm).
4. **Supports a testing/simulation mode** (“simulated money”) that does not send real orders, for backtesting and safe runs.

Deployment target: any Node-friendly host (Railway, Render, Fly.io, VPS, etc.).

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Long-running process                          │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────────────────┐   │
│  │ Market Data │   │   Strategy   │   │ Execution (live or   │   │
│  │  (Gamma +   │──▶│  (algorithm  │──▶│  simulated)         │   │
│  │   CLOB)     │   │   in/out)    │   │  Orders / Sim ledger │   │
│  └─────────────┘   └──────────────┘   └─────────────────────┘   │
│         │                  │                      │              │
│         ▼                  ▼                      ▼              │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Config: event id, SIMULATED=true|false, credentials (env)   ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

- **Market data**: Gamma API (event/markets, token IDs) + CLOB (order book, midpoint, prices). All public; no auth for data.
- **Auth**: Used only when placing/cancelling orders (and for gasless relayer if applicable). In simulation mode, no real credentials needed for execution (only for optional “live” data).
- **Strategy**: One or more strategy modules that receive market state and return signals (e.g. “buy Yes at 0.52”, “sell”, “no-op”). The runner calls the strategy on a schedule or event loop.
- **Execution**:  
  - **Live**: `@polymarket/clob-client` to create/post/cancel orders.  
  - **Simulated**: Same interface conceptually, but instead of calling the CLOB, update an in-memory (or persisted) ledger: virtual balance, positions, and fill simulation (e.g. fill at midpoint or best bid/ask). No real orders.

---

## Polymarket APIs (from docs)

| Need            | Source | Notes |
|-----------------|--------|--------|
| Event + markets | Gamma API | Base: `https://gamma-api.polymarket.com`. GET `/events/{id}` returns event with `markets[]`. Each market: `conditionId`, `clobTokenIds` (Yes then No), `orderPriceMinTickSize`, `negRisk`, etc. |
| Resolve event   | Gamma API | Event id in URL is numeric. Your slug `btc-updown-5m-1771778400` may need mapping (e.g. slug → id) or use id if you have it. |
| Order book / price | CLOB Data API | Use CLOB client or REST: book, midpoint, price. Rate limits: e.g. /book 1500/10s. |
| Tick size, neg risk | CLOB / Gamma | From market: `orderPriceMinTickSize` (or CLOB `getTickSize()`), `negRisk`. Required for placing orders. |
| Auth (trading)  | CLOB client | Wallet (ethers `Wallet` + `PRIVATE_KEY`) or proxy; `createOrDeriveApiKey()`. Signature types: 0 = EOA, 1 = POLY_PROXY, 2 = GNOSIS_SAFE. |
| Gasless         | Relayer | Builder API key + passphrase + signature (HMAC-SHA256). SDK can use `BuilderConfig` so relayer pays gas. |
| Place order     | CLOB client | `createAndPostOrder({ tokenID, price, size, side }, { tickSize, negRisk })`. |
| Cancel / list   | CLOB client | `cancelOrder(orderID)`, `getOpenOrders({ market })`. |

---

## High-Level Tasks

### 1. Project setup and config

- **1.1** Initialize Node project (e.g. `package.json`, TypeScript or plain JS, `tsconfig` if TS).
- **1.2** Add dependencies: `@polymarket/clob-client`, `ethers` (v5), and optionally `node-fetch` or use global fetch for Gamma.
- **1.3** Define config (env):  
  - `EVENT_SLUG_OR_ID` (e.g. `btc-updown-5m-1771778400` or numeric id).  
  - `SIMULATED` (e.g. `true` / `false`) — if true, no real orders; use simulated ledger.  
  - `PRIVATE_KEY` (for EOA) or proxy + builder credentials for gasless.  
  - Optional: `CHAIN_ID`, `CLOB_HOST`, `GAMMA_API_URL`, polling interval, strategy name.
- **1.4** Add a minimal `.env.example` and document required vars (no secrets in repo).

### 2. Market data layer

- **2.1** **Resolve event and get token IDs**  
  - Call Gamma API: if you have numeric event id, GET `https://gamma-api.polymarket.com/events/{id}`.  
  - If only slug: check Gamma for a “by slug” endpoint or maintain a small mapping (e.g. slug → id) for this event.  
  - From response: take first market (or the one matching “BTC up/down 5m”), read `conditionId`, `clobTokenIds` (Yes = first, No = second), `orderPriceMinTickSize`, `negRisk` (and `enableNegRisk` for augmented neg risk).
- **2.2** **Fetch CLOB market data**  
  - Use CLOB client or REST to get order book / midpoint / price for the Yes and No token IDs.  
  - Implement a small “market data” module that returns a unified structure: e.g. `{ conditionId, yesTokenId, noTokenId, bestBid, bestAsk, midpoint, tickSize, negRisk }` (and optionally full book).
- **2.3** **Respect rate limits**  
  - CLOB: e.g. 1500 req/10s per endpoint; add simple throttling or caching (e.g. poll every N seconds and reuse).

### 3. Authentication and CLOB client (live mode)

- **3.1** **Initialize CLOB client for live trading**  
  - From env: create ethers `Wallet` from `PRIVATE_KEY`; derive API creds with `createOrDeriveApiKey()`.  
  - Build `ClobClient(HOST, CHAIN_ID, signer, apiCreds, signatureType, funderAddress)`.  
  - If using gasless: configure `BuilderConfig` with Builder API key/passphrase and pass into client (see Polymarket gasless docs).
- **3.2** **Get market options for orders**  
  - Use `client.getMarket(conditionId)` or Gamma market data to get `tickSize` and `negRisk` for every `createAndPostOrder` / cancel flow.

### 4. Strategy interface and runner loop

- **4.1** **Define strategy interface**  
  - Input: current market data (and optionally previous state, e.g. last signal, open positions).  
  - Output: signal or list of actions, e.g. `{ action: 'buy'|'sell'|'none', side: 'yes'|'no', price?, size? }` or equivalent.  
  - One default strategy (e.g. “no-op” or simple threshold) so the loop runs without you implementing algo first.
- **4.2** **Main loop**  
  - Loop forever (or until shutdown):  
    - Fetch latest market data (task 2).  
    - Call strategy with market data (and execution state in simulation).  
    - Pass strategy output to execution layer (live or simulated).  
  - Use a configurable interval (e.g. 5–30 s) to avoid hammering APIs.  
  - Add graceful shutdown (e.g. SIGINT/SIGTERM) and optional health endpoint for deployment.

### 5. Live execution (real orders)

- **5.1** **Place orders**  
  - Map strategy output to `createAndPostOrder` with correct `tokenID`, `price`, `size`, `side`, and options `{ tickSize, negRisk }`.  
  - Handle and log errors (rate limits, insufficient balance, invalid tick size).
- **5.2** **Close or adjust positions**  
  - “Close” = place opposite order or sell existing position; use `getOpenOrders` and optionally `getTrades`/positions to know current state.  
  - Implement cancel-and-replace or cancel old then place new if strategy logic requires it.

### 6. Simulated execution (testing / backtesting)

- **6.1** **Simulated ledger**  
  - In-memory (or file/DB) state: virtual USDC balance, positions per token (size, avg price).  
  - Configurable starting balance (env or config).
- **6.2** **Simulated order execution**  
  - When strategy says “buy Yes at 0.52, size 10”: do not call CLOB; instead apply a fill rule, e.g. fill at 0.52 (or at current midpoint) and update virtual balance and position.  
  - Optionally support “fill at best ask” for buys and “fill at best bid” for sells to be more realistic.
- **6.3** **Same interface as live**  
  - Execution layer exposes the same “place order” / “cancel” API so the runner does not care whether it’s live or simulated; only the implementation differs.  
  - When `SIMULATED=true`, wire runner to simulated executor instead of live CLOB.

### 7. Deployment and operability

- **7.1** **Single entrypoint**  
  - e.g. `npm start` or `node src/index.js` that runs the loop and never exits unless crash or shutdown.
- **7.2** **Logging**  
  - Structured logs (e.g. timestamps, mode=live|simulated, strategy, orders, errors) so you can debug and monitor on Railway/Render/Fly.
- **7.3** **Deploy**  
  - Use Node runtime; set env vars (EVENT_SLUG_OR_ID, SIMULATED, PRIVATE_KEY or builder creds).  
  - Prefer `SIMULATED=true` until you are confident, then switch to live.

---

## Event and market resolution

- Your event identifier: **`btc-updown-5m-1771778400`**.  
- Gamma’s **Get event by id** uses a **numeric** `id` in the path. You have two options:  
  - **A)** If `1771778400` is the Gamma event id, call `GET https://gamma-api.polymarket.com/events/1771778400`.  
  - **B)** If not, check Gamma docs or API for “get event by slug” (or list events filtered by slug); otherwise maintain a mapping from this slug to the correct event id once you find it (e.g. from the Polymarket UI or API exploration).  
- From the chosen event’s `markets[]`, pick the market for “BTC up or down 5m” (likely one market with two outcomes). Use that market’s `conditionId`, `clobTokenIds`, `orderPriceMinTickSize`, and `negRisk` for the rest of the bot.

---

## Suggested file layout (Node)

```
bot_one/
├── package.json
├── .env.example
├── PLAN.md
├── README.md
├── src/
│   ├── index.js              # Entry: load config, start loop
│   ├── config.js              # Env and constants
│   ├── market-data.js         # Gamma + CLOB data (event, book, prices)
│   ├── auth.js                # Build CLOB client (live)
│   ├── strategy.js            # Strategy interface + default strategy
│   ├── execution-live.js      # Real orders via CLOB client
│   ├── execution-simulated.js # Simulated ledger + fills
│   └── runner.js              # Main loop: data → strategy → execution
└── strategies/                # Optional: pluggable strategy files
    └── example.js
```

---

## Summary checklist

| # | Task |
|---|------|
| 1 | Project setup, deps, config, `.env.example` |
| 2 | Market data: resolve event (Gamma), get token IDs + book/prices (CLOB) |
| 3 | Auth: CLOB client init (EOA or proxy + optional gasless) |
| 4 | Strategy interface + default strategy + main runner loop |
| 5 | Live execution: place/cancel orders, optional position tracking |
| 6 | Simulated execution: virtual ledger, fill logic, same interface as live |
| 7 | Single entrypoint, logging, deploy with SIMULATED first |

This plan uses only public Polymarket docs and standard Node patterns so you can implement it step by step and deploy anywhere that runs Node.
