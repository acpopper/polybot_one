const { GAMMA_API_URL, CLOB_HOST } = require("./config.js");

/**
 * Fetch event by numeric id or slug from Gamma API.
 * @param {string} eventIdOrSlug - numeric id (e.g. 221564) or slug (e.g. btc-updown-5m-1771778400)
 * @returns {Promise<{ id, title, slug, markets: Array }>}
 */
async function fetchEvent(eventIdOrSlug) {
  const isNumericId = /^\d+$/.test(String(eventIdOrSlug).trim());
  let event;
  if (isNumericId) {
    const url = `${GAMMA_API_URL}/events/${eventIdOrSlug}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `Gamma API error ${res.status}: ${res.statusText} for ${url}`,
      );
    }
    event = await res.json();
  } else {
    const url = `${GAMMA_API_URL}/events?slug=${encodeURIComponent(eventIdOrSlug)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `Gamma API error ${res.status}: ${res.statusText} for ${url}`,
      );
    }
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error(`No event found for slug: ${eventIdOrSlug}`);
    }
    event = arr[0];
  }
  return event;
}

const BINANCE_TICKER_URL =
  "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT";

/**
 * Fetch current BTC/USD price from Binance (for display; resolution uses Chainlink).
 * @returns {Promise<number | null>}
 */
async function fetchBtcPrice() {
  try {
    const res = await fetch(BINANCE_TICKER_URL);
    if (!res.ok) return null;
    const json = await res.json();
    const p = parseFloat(json?.price, 10);
    return Number.isFinite(p) ? p : null;
  } catch {
    return null;
  }
}

/**
 * Fetch order book for a single token from CLOB.
 * Returns null if 404 (e.g. market closed, book removed).
 * @param {string} tokenId
 * @returns {Promise<{ bids, asks, market?: string } | null>}
 */
async function fetchOrderBook(tokenId) {
  const url = `${CLOB_HOST}/book?token_id=${encodeURIComponent(tokenId)}`;
  const res = await fetch(url);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(
      `CLOB API error ${res.status}: ${res.statusText} for token ${tokenId}`,
    );
  }
  return res.json();
}

/**
 * Parse clobTokenIds from Gamma market (JSON string array, comma-separated string, or array).
 * @param {string|string[]} clobTokenIds
 * @returns {{ yes: string, no: string }}
 */
function parseTokenIds(clobTokenIds) {
  if (clobTokenIds == null || clobTokenIds === "") {
    throw new Error("Market has no clobTokenIds");
  }
  let ids;
  if (Array.isArray(clobTokenIds)) {
    ids = clobTokenIds;
  } else {
    const raw = String(clobTokenIds).trim();
    if (raw.startsWith("[")) {
      try {
        ids = JSON.parse(raw);
      } catch {
        ids = raw
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      }
    } else {
      ids = raw
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }
  }
  if (!Array.isArray(ids) || ids.length < 2) {
    throw new Error("Expected at least two token IDs (Yes, No)");
  }
  return { yes: String(ids[0]), no: String(ids[1]) };
}

/**
 * Fetch live market data for the given event: event + first market + order books for Yes/No.
 * @param {string} eventIdOrSlug - Gamma event id (numeric) or slug
 * @returns {Promise<{
 *   event: { id, title, slug },
 *   market: { conditionId, question, tickSize, negRisk },
 *   tokenIds: { yes, no },
 *   books: { yes: object, no: object }
 * }>}
 */
async function fetchMarketData(eventIdOrSlug) {
  const event = await fetchEvent(eventIdOrSlug);
  const markets = event.markets || [];
  if (markets.length === 0) {
    throw new Error(`Event ${eventIdOrSlug} has no markets`);
  }
  const market = markets[0];
  const conditionId = market.conditionId || market.condition_id;
  if (!conditionId) {
    throw new Error("Market has no conditionId");
  }
  const tokenIds = parseTokenIds(market.clobTokenIds || market.clob_token_ids);
  const tickSize =
    market.orderPriceMinTickSize ?? market.order_price_min_tick_size ?? 0.01;
  const negRisk = market.negRisk ?? market.neg_risk ?? false;

  const [bookYes, bookNo, btcPriceCurrent] = await Promise.all([
    fetchOrderBook(tokenIds.yes),
    fetchOrderBook(tokenIds.no),
    fetchBtcPrice(),
  ]);

  // Gamma returns eventMetadata.priceToBeat (BTC at window start). Check event and market, both key styles.
  const eventMeta = event.eventMetadata || event.event_metadata || {};
  const marketMeta = market.eventMetadata || market.event_metadata || {};
  const raw =
    eventMeta.priceToBeat ??
    eventMeta.price_to_beat ??
    marketMeta.priceToBeat ??
    marketMeta.price_to_beat;
  const priceToBeat = raw != null ? Number(raw) : null;

  return {
    event: {
      id: event.id,
      title: event.title,
      slug: event.slug,
      startTime: event.startTime || event.startDate || null,
      endDate: event.endDate || null,
      resolutionSource: event.resolutionSource || null,
      priceToBeat: Number.isFinite(priceToBeat) ? priceToBeat : null,
    },
    market: {
      conditionId,
      question: market.question,
      tickSize: Number(tickSize),
      negRisk: Boolean(negRisk),
    },
    tokenIds,
    books: {
      yes: bookYes,
      no: bookNo,
    },
    btcPriceCurrent,
  };
}

module.exports = {
  fetchEvent,
  fetchOrderBook,
  fetchBtcPrice,
  fetchMarketData,
  parseTokenIds,
};
