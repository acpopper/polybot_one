const fs = require("fs");
const path = require("path");
const config = require("./config.js");
const { fetchMarketData } = require("./market-data.js");
const { runStrategy } = require("./strategy.js");
const simulated = require("./execution-simulated.js");
const live = require("./execution-live.js");

/** Fallback target: first Binance price seen per event slug when API priceToBeat is missing */
const targetBySlug = Object.create(null);
/** Track which slugs we've already taken a position for (one shot per event) */
const positionTakenForSlug = Object.create(null);
/** Previous iteration's slug to detect event close (slug switch) */
let lastSlug = null;

/** Extract Unix timestamp (seconds) from slug e.g. btc-updown-5m-1771814100 */
function timestampFromSlug(slug) {
  const part = String(slug).split("-").pop();
  return /^\d+$/.test(part) ? part : "";
}

/** True when current time is within the last 1 minute of the 5-min window (slug ts + 240s .. slug ts + 300s) */
function withinLastMinute(slug) {
  const slugTs = parseInt(timestampFromSlug(slug), 10);
  if (!slugTs) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  const secondsIntoWindow = nowSec - slugTs;
  return secondsIntoWindow >= 240 && secondsIntoWindow < 300;
}

function formatBookSide(side) {
  if (!side || !Array.isArray(side) || side.length === 0) return "—";
  const best = side[0];
  const price =
    typeof best === "object" && best !== null ? (best.price ?? best[0]) : best;
  const size =
    typeof best === "object" && best !== null ? (best.size ?? best[1]) : "?";
  return `${Number(price)} @ ${Number(size)}`;
}

/** First ask level: { price, size } or empty */
function bestAsk(book) {
  const asks = book?.asks;
  if (!asks || !Array.isArray(asks) || asks.length === 0) return { price: "", size: "" };
  const a = asks[0];
  const price = typeof a === "object" && a !== null ? (a.price ?? a[0]) : a;
  const size = typeof a === "object" && a !== null ? (a.size ?? a[1]) : "";
  return { price: Number(price), size: Number(size) };
}

const CSV_HEADERS =
  "timestamp_fetch,timestamp_event_slug,price_to_beat,current_price,yes_price,yes_size,no_price,no_size";

function ensureCsvExists() {
  const filePath = path.resolve(config.LOG_CSV_PATH);
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, CSV_HEADERS + "\n", "utf8");
    }
  } catch (err) {
    console.error("CSV init error:", err.message);
  }
}

function appendCsvRow(row) {
  const filePath = path.resolve(config.LOG_CSV_PATH);
  const line = row.map((v) => (v === null || v === undefined ? "" : String(v))).join(",") + "\n";
  try {
    fs.appendFileSync(filePath, line, "utf8");
  } catch (err) {
    console.error("CSV append error:", err.message);
  }
}

function logMarketData(data, resolvedTarget) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${data.event.title} (${data.event.slug})`);
  const btcCurrent = data.btcPriceCurrent;
  const fmt = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const currentStr = btcCurrent != null ? `current $${fmt(btcCurrent)} (Binance)` : "current —";
  const targetStr =
    resolvedTarget != null ? `target $${fmt(resolvedTarget)} (window start)` : "target —";
  console.log(`  BTC: ${currentStr} | ${targetStr}`);
  const bookYes = data.books.yes;
  const bookNo = data.books.no;
  const yesStr =
    bookYes != null
      ? `bid: ${formatBookSide(bookYes.bids)}  ask: ${formatBookSide(bookYes.asks)}`
      : "book unavailable (e.g. market closed)";
  const noStr =
    bookNo != null
      ? `bid: ${formatBookSide(bookNo.bids)}  ask: ${formatBookSide(bookNo.asks)}`
      : "book unavailable (e.g. market closed)";
  console.log(`  Yes  ${yesStr}`);
  console.log(`  No   ${noStr}`);
}

async function runOnce() {
  const slug = config.getCurrentBtc5mSlug();
  const data = await fetchMarketData(slug);

  const btcCurrent = data.btcPriceCurrent;
  const apiTarget = data.event.priceToBeat;
  if (targetBySlug[slug] == null && btcCurrent != null) {
    targetBySlug[slug] = btcCurrent;
  }
  const resolvedTarget = apiTarget != null ? apiTarget : targetBySlug[slug] ?? null;

  if (slug !== lastSlug && lastSlug != null) {
    const targetPrev = targetBySlug[lastSlug];
    if (config.SIMULATED && targetPrev != null && btcCurrent != null) {
      const { pnl, resolvedUp } = simulated.resolveEvent(btcCurrent, targetPrev);
      console.log(
        `  [SIM] Event closed (${lastSlug}): resolved ${resolvedUp ? "Up" : "Down"}, PnL: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDC`,
      );
    } else {
      console.log(`  Event closed (${lastSlug}), watching new event (${slug}).`);
    }
  }
  lastSlug = slug;

  logMarketData(data, resolvedTarget);

  const tsFetch = new Date().toISOString();
  const tsSlug = timestampFromSlug(data.event.slug);
  const yesAsk = bestAsk(data.books.yes);
  const noAsk = bestAsk(data.books.no);
  appendCsvRow([
    tsFetch,
    tsSlug,
    resolvedTarget ?? "",
    btcCurrent ?? "",
    yesAsk.price,
    yesAsk.size,
    noAsk.price,
    noAsk.size,
  ]);

  const balance = config.SIMULATED ? simulated.getState().balance : 0;
  const inLastMin = withinLastMinute(slug);
  const context = { balance, withinLastMinute: inLastMin };
  const { orders } = runStrategy(data, context);

  if (positionTakenForSlug[slug]) {
    console.log("  No action taken (position already taken for this event).");
  } else if (orders.length > 0) {
    positionTakenForSlug[slug] = true;
    if (config.SIMULATED) {
      for (const order of orders) {
        simulated.placeOrder(order, data);
      }
      const o = orders[0];
      const state = simulated.getState();
      console.log(
        `  Position taken: ${o.side} size ${o.size.toFixed(2)} @ ${o.price} | value ${(o.size * o.price).toFixed(2)} USDC (20% of balance) | balance now ${state.balance.toFixed(2)} USDC`,
      );
    } else {
      for (const order of orders) {
        live.placeOrder(order, data);
      }
      const o = orders[0];
      console.log(
        `  Position taken: ${o.side} size ${o.size.toFixed(2)} @ ${o.price} | value ${(o.size * o.price).toFixed(2)} USDC`,
      );
    }
  } else {
    console.log("  No action taken.");
  }

  return data;
}

function start() {
  ensureCsvExists();
  const mode = config.SIMULATED ? "SIMULATED" : "LIVE";
  console.log(
    `Starting market data loop (BTC 5m event, ${mode}, strategy: ${config.STRATEGY}). Ctrl+C to stop.\n`,
  );
  if (config.SIMULATED) {
    console.log(`  Simulated balance: ${config.SIMULATED_BALANCE} USDC\n`);
  }
  if (config.LOG_CSV_PATH) {
    console.log(`  CSV log: ${config.LOG_CSV_PATH}\n`);
  }

  function loop() {
    return runOnce()
      .catch((err) => {
        console.error("Error fetching market data:", err.message);
      })
      .then(() => new Promise((r) => setTimeout(r, config.POLL_INTERVAL_MS)))
      .then(loop);
  }

  loop().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}

module.exports = { start, runOnce };
