const path = require("path");
const config = require("./config.js");

const strategyCache = Object.create(null);

/**
 * Load and return the strategy function for the given name.
 * Strategies live in strategies/{name}.js and must export a function(marketData) -> { orders }.
 * @param {string} name - Strategy name (e.g. "example"), used as strategies/{name}.js
 * @returns {function(object): { orders: Array }}
 */
function getStrategy(name) {
  const key = name || config.STRATEGY;
  if (strategyCache[key]) return strategyCache[key];

  try {
    const modulePath = path.join(__dirname, "..", "strategies", `${key}.js`);
    const mod = require(modulePath);
    const fn = mod.strategy ?? mod.default ?? mod;
    if (typeof fn !== "function") {
      throw new Error(
        `Strategy "${key}" must export a function (strategy or default)`,
      );
    }
    strategyCache[key] = fn;
    return fn;
  } catch (err) {
    if (err.code === "MODULE_NOT_FOUND" && key !== "example") {
      console.warn(`Strategy "${key}" not found, falling back to "example"`);
      return getStrategy("example");
    }
    throw err;
  }
}

/**
 * Run the configured (or specified) strategy on market data.
 * @param {object} marketData - { event, market, tokenIds, books }
 * @param {object} [context] - { balance, withinLastMinute } for per-event strategies
 * @param {string} [strategyName] - Override strategy name; defaults to config.STRATEGY
 * @returns {{ orders: Array }}
 */
function runStrategy(marketData, context, strategyName) {
  const fn = getStrategy(strategyName);
  return fn(marketData, context);
}

module.exports = { getStrategy, runStrategy };
