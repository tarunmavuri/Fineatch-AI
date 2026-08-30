/* ============================================================
   forecaster.js — 30-day forward cash position model
   Opening balance = net of matched bank flow so far.
   Then projects forward using:
     - open AP due dates (known outflows)
     - unmatched/incoming exception items (probabilistic inflows,
       discounted by how confident we are they'll actually land)
     - simple weekly recurrence detection on vendor payments
   ============================================================ */

function detectRecurringVendors(gl) {
  const byVendorWeek = {};
  gl.forEach((g) => {
    if (!g.narration || !g.narration.startsWith('Payment to')) return;
    const vendor = g.narration.replace('Payment to ', '');
    byVendorWeek[vendor] = (byVendorWeek[vendor] || 0) + 1;
  });
  return Object.entries(byVendorWeek)
    .filter(([, count]) => count >= 3)
    .map(([vendor, count]) => ({ vendor, occurrences: count }));
}

// A company doesn't start each month at ₹0 — this is the pre-existing operating
// cash reserve the 30-day bank feed sits on top of. The forecast's opening
// balance is that reserve plus the net movement already seen in the feed.
const STARTING_CASH_RESERVE = 8500000;

function forecastCash(reconciliation, ap, bank, horizonDays = 30) {
  const openingBalance = STARTING_CASH_RESERVE + bank.reduce((sum, b) => sum + b.amount, 0);

  const today = new Date('2026-07-28T00:00:00Z'); // end of the synthetic data window
  const days = [];
  let running = openingBalance;

  // known outflows: AP invoices whose due date falls within the horizon and
  // that we haven't already confirmed as settled
  const settledInvoiceIds = new Set(reconciliation.apMatched.map((m) => m.invoice.invoice_id));
  const openPayables = ap.filter((inv) => !settledInvoiceIds.has(inv.invoice_id));

  // probabilistic inflows / outflows from exceptions still sitting open — weighted
  // by how far the exception is from a clean match (reason code proxy for confidence)
  const exceptionWeight = { AMT_MISMATCH: 0.75, DATE_GAP: 0.85, NO_REF: 0.55, DUPE_CANDIDATE: 0.4, FX_VARIANCE: 0.65 };

  for (let i = 1; i <= horizonDays; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + i);
    const dateStr = d.toISOString().slice(0, 10);

    let dayFlow = 0;
    openPayables.forEach((inv) => {
      if (inv.due_date === dateStr) dayFlow -= inv.amount;
    });
    // spread a light-touch probabilistic drip from open exceptions across the
    // first 10 days, discounted by confidence — represents items likely to
    // resolve one way or another rather than sit forever
    if (i <= 10) {
      reconciliation.exceptions.forEach((exc, idx) => {
        if (idx % 10 !== (i - 1)) return;
        const weight = exceptionWeight[exc.reasonCode] ?? 0.5;
        const direction = exc.source === 'bank' && exc.record.amount > 0 ? 1 : -1;
        dayFlow += direction * exc.amount * weight * 0.15;
      });
    }

    running += dayFlow;
    days.push({
      date: dateStr,
      balance: Math.round(running),
      p10: Math.round(running - Math.abs(dayFlow) * 0.4 - i * 800),
      p90: Math.round(running + Math.abs(dayFlow) * 0.4 + i * 800),
      flow: Math.round(dayFlow),
    });
  }

  return {
    openingBalance: Math.round(openingBalance),
    days,
    recurringVendors: detectRecurringVendors(bank.map((b) => ({ narration: b.description }))),
    totalOpenPayables: Math.round(openPayables.reduce((s, i) => s + i.amount, 0)),
    openPayableCount: openPayables.length,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { forecastCash };
}
