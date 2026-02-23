const config = require("./config.js");

let balance = config.SIMULATED_BALANCE;
const positions = { yes: { size: 0, avgPrice: 0 }, no: { size: 0, avgPrice: 0 } };

function getState() {
  return {
    balance,
    positions: { yes: { ...positions.yes }, no: { ...positions.no } },
  };
}

function resetState() {
  balance = config.SIMULATED_BALANCE;
  positions.yes = { size: 0, avgPrice: 0 };
  positions.no = { size: 0, avgPrice: 0 };
}

/**
 * Simulated fill at order price. Updates balance and positions; does not call CLOB.
 * @param {{ side: 'yes'|'no', action: 'buy'|'sell', price: number, size: number }} order
 * @param {object} _marketData - unused for fill price; could use for midpoint later
 * @returns {{ filled: boolean, cost?: number, message?: string }}
 */
function placeOrder(order, _marketData) {
  const { side, action, price, size } = order;
  const pos = positions[side];

  if (action === "buy") {
    const cost = size * price;
    if (cost > balance) {
      return { filled: false, message: `Insufficient balance: need ${cost.toFixed(2)} USDC` };
    }
    balance -= cost;
    const newSize = pos.size + size;
    const newAvg = pos.size === 0 ? price : (pos.size * pos.avgPrice + size * price) / newSize;
    pos.size = newSize;
    pos.avgPrice = newAvg;
    console.log(`  [SIM] Filled BUY ${side} ${size} @ ${price} -> cost ${cost.toFixed(2)} USDC, pos ${pos.size.toFixed(2)} @ avg ${pos.avgPrice.toFixed(4)}`);
    return { filled: true, cost };
  }

  if (action === "sell") {
    if (size > pos.size) {
      return { filled: false, message: `Insufficient ${side} position: have ${pos.size.toFixed(2)}` };
    }
    const proceeds = size * price;
    balance += proceeds;
    pos.size -= size;
    if (pos.size <= 0) pos.avgPrice = 0;
    console.log(`  [SIM] Filled SELL ${side} ${size} @ ${price} -> proceeds ${proceeds.toFixed(2)} USDC, pos ${pos.size.toFixed(2)}`);
    return { filled: true, cost: -proceeds };
  }

  return { filled: false, message: "Unknown action" };
}

/**
 * Resolve the current event: settle positions against closing BTC vs target, update balance, reset positions.
 * Up = closingBtcPrice >= targetPrice; Yes pays $1/share if Up, No pays $1/share if Down.
 * @param {number} closingBtcPrice - BTC price at event close (e.g. from first fetch of next slug)
 * @param {number} targetPrice - Price to beat (window start) for the event
 * @returns {{ pnl: number, resolvedUp: boolean }}
 */
function resolveEvent(closingBtcPrice, targetPrice) {
  const resolvedUp = closingBtcPrice >= targetPrice;
  const yesSize = positions.yes.size;
  const noSize = positions.no.size;
  const pnl = yesSize * (resolvedUp ? 1 : 0) + noSize * (resolvedUp ? 0 : 1);
  balance += pnl;
  positions.yes = { size: 0, avgPrice: 0 };
  positions.no = { size: 0, avgPrice: 0 };
  return { pnl, resolvedUp };
}

module.exports = { placeOrder, getState, resetState, resolveEvent };
