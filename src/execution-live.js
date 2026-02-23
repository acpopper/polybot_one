/**
 * Live execution: places real orders via CLOB client.
 * Stub for now; implement using auth.getClobClient() and createAndPostOrder when ready.
 * @param {{ side: 'yes'|'no', action: 'buy'|'sell', price: number, size: number }} order
 * @param {object} _marketData
 */
function placeOrder(order, _marketData) {
  console.log(`  [LIVE] Would place order: ${order.action} ${order.side} ${order.size} @ ${order.price} (not implemented)`);
}

module.exports = { placeOrder };
