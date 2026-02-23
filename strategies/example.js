/**
 * Default example strategy: once per event, fire at most one position.
 * Condition: odds in one direction >= 95% (best ask) AND within last minute of the event.
 * Action: buy that side with 20% of total balance.
 * @param {object} marketData - { event, market, tokenIds, books: { yes, no } }
 * @param {object} context - { balance: number, withinLastMinute: boolean }
 * @returns {{ orders: Array<{ side: 'yes'|'no', action: 'buy', price: number, size: number }> }}
 */
function strategy(marketData, context = {}) {
  const orders = [];
  const { balance = 0, withinLastMinute = false } = context;
  if (!withinLastMinute || balance <= 0) return { orders };

  const bookYes = marketData.books.yes;
  const bookNo = marketData.books.no;
  if (!bookYes?.asks?.length || !bookNo?.asks?.length) return { orders };

  const yesAsk = bookYes.asks[0];
  const noAsk = bookNo.asks[0];
  const priceYes = Number(yesAsk?.price ?? yesAsk?.[0] ?? 0);
  const priceNo = Number(noAsk?.price ?? noAsk?.[0] ?? 0);

  const THRESHOLD = 0.95;
  const ALLOCATION = 0.2;
  const sizeFromBalance = (p) => Math.max(0, (ALLOCATION * balance) / p);

  if (priceYes >= THRESHOLD && priceYes >= priceNo) {
    const size = sizeFromBalance(priceYes);
    if (size > 0) orders.push({ side: "yes", action: "buy", price: priceYes, size });
  } else if (priceNo >= THRESHOLD) {
    const size = sizeFromBalance(priceNo);
    if (size > 0) orders.push({ side: "no", action: "buy", price: priceNo, size });
  }

  return { orders };
}

module.exports = { strategy };
