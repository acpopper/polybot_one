require("dotenv").config();

const GAMMA_API_URL = (
  process.env.GAMMA_API_URL || "https://gamma-api.polymarket.com"
).replace(/\/$/, "");
const CLOB_HOST = (
  process.env.CLOB_HOST || "https://clob.polymarket.com"
).replace(/\/$/, "");
const POLL_INTERVAL_MS = Math.max(
  2000,
  parseInt(process.env.POLL_INTERVAL_MS || "10000", 10),
);

const SIMULATED = process.env.SIMULATED !== "false" && process.env.SIMULATED !== "0";
const SIMULATED_BALANCE = Math.max(
  0,
  parseFloat(process.env.SIMULATED_BALANCE || "1000", 10),
);

const STRATEGY = (process.env.STRATEGY || "example").trim().toLowerCase();

const LOG_CSV_PATH = process.env.LOG_CSV_PATH || "market-data.csv";

const FIVE_MIN_SECONDS = 300;

/**
 * Current 5-minute window start in Unix seconds (aligned to 0, 5, 10, ... minutes).
 */
function currentBtc5mTimestamp() {
  return Math.floor(Date.now() / 1000 / FIVE_MIN_SECONDS) * FIVE_MIN_SECONDS;
}

/**
 * Slug for the BTC up/down 5m event for the current 5-minute window.
 * Optional override: EVENT_SLUG or EVENT_ID in env to pin a specific event (e.g. for testing).
 */
function getCurrentBtc5mSlug() {
  if (process.env.EVENT_SLUG) return process.env.EVENT_SLUG;
  if (process.env.EVENT_ID) {
    const id = process.env.EVENT_ID.trim();
    if (/^\d+$/.test(id)) return `btc-updown-5m-${id}`;
    return id;
  }
  const ts = currentBtc5mTimestamp();
  return `btc-updown-5m-${ts}`;
}

module.exports = {
  getCurrentBtc5mSlug,
  currentBtc5mTimestamp,
  GAMMA_API_URL,
  CLOB_HOST,
  POLL_INTERVAL_MS,
  SIMULATED,
  SIMULATED_BALANCE,
  STRATEGY,
  LOG_CSV_PATH,
};
