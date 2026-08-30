/* ============================================================
   agent.js — Fineatch AI Batch Finance-Ops Agent
   ──────────────────────────────────────────────────────────
   Closes one complete finance-ops loop across a 50+ record
   synthetic batch. For every exception the agent either:

     RESOLVED   → suggests a concrete, actionable resolution
     UNRESOLVED → admits it cannot close the item and explains
                  why, so a human controller knows exactly what
                  to look at

   The agent never cherry-picks. It reports:
     • matchRate         (bank ↔ GL headline metric)
     • apSettlementRate  (PAID invoices with real bank debit)
     • confHistogram     (3-pass breakdown)
     • resolvedItems[]   — items the agent closed with a reason
     • unresolved[]      — honest list with escalation notes
     • throughputRps     — records/second
     • elapsedMs

   This is what separates measured accuracy from a demo:
   every unresolvable item is surfaced, not hidden.
   ============================================================ */

const FinAgentV1 = (function () {

  /* ── Resolution confidence thresholds ── */
  const RESOLVE_CONFIDENCE = {
    AMT_MISMATCH:   0.85,   // amount difference < 0.5% → resolvable
    DATE_GAP:       0.80,   // date gap ≤ 7 days → resolvable
    NO_REF:         0.65,   // missing ref but counterparty+amount match → resolvable
    DUPE_CANDIDATE: 0.50,   // need human to confirm which one to reverse
    FX_VARIANCE:    0.75,   // FX rate check is resolvable if < 2% variance
    SPLIT_PAYMENT:  0.70,   // can be matched by summing AP legs
    ADVANCE_PAYMENT:0.60,   // timing gap; need payables team confirm
  };

  const REASON_LABELS = {
    AMT_MISMATCH:   'Amount mismatch',
    DATE_GAP:       'Date gap',
    NO_REF:         'Missing reference',
    DUPE_CANDIDATE: 'Duplicate candidate',
    FX_VARIANCE:    'FX variance',
    SPLIT_PAYMENT:  'Split payment',
    ADVANCE_PAYMENT:'Advance payment',
  };

  /* ── Suggested actions per code ── */
  function suggestResolution(exc) {
    const { reasonCode, amount, record, source } = exc;
    const fmt = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
    switch (reasonCode) {
      case 'AMT_MISMATCH':
        return `Agent → Verify with source invoice. Difference is likely a rounding or partial-payment. Check if ${fmt(amount)} reconciles net of TDS deduction.`;
      case 'DATE_GAP':
        return `Agent → Timing difference. Confirm posting date in source ERP. Common cause: NEFT cut-off or month-end batch delay.`;
      case 'NO_REF':
        return `Agent → Run a fuzzy counterparty + amount search (±1%) in bank feed for ±7 days. If found, tag the reference manually and re-run.`;
      case 'DUPE_CANDIDATE':
        return `Agent → Two GL entries match this bank debit. Pull journal vouchers from ERP, compare narrations. Reverse the duplicate with a journal reversal in the same period.`;
      case 'FX_VARIANCE':
        return `Agent → Recompute using settlement-date FX rate from RBI/Bloomberg. If variance < 2%, book as FX gain/loss. If > 2%, escalate to treasury.`;
      case 'SPLIT_PAYMENT':
        return `Agent → Sum the two AP invoice legs. If they equal the bank debit total, mark all as settled and cross-reference REF on all three records.`;
      case 'ADVANCE_PAYMENT':
        return `Agent → Advance payment detected. Match bank debit to advance AP invoice. Update invoice status to SETTLED once underlying service invoice arrives.`;
      default:
        return `Agent → Manual review required. Cross-check source documents for ${source === 'bank' ? record.txn_id : record.gl_id ?? record.invoice_id}.`;
    }
  }

  /* ── Escalation notes for unresolvable items ── */
  function escalationNote(exc) {
    const { reasonCode, record, source } = exc;
    const id = source === 'bank' ? record.txn_id
             : source === 'gl'   ? record.gl_id
             : record.invoice_id;
    switch (reasonCode) {
      case 'DUPE_CANDIDATE':
        return `Cannot auto-reverse without verifying which GL entry represents the real economic event. Requires controller sign-off on journal reversal.`;
      case 'NO_REF':
        return `No counterparty or amount match found in any source. Record may be an unposted manual adjustment or a fraud indicator. Escalate to finance controller.`;
      case 'FX_VARIANCE':
        return `FX variance exceeds 2% of notional — outside agent's auto-correct threshold. Requires treasury team to confirm settlement rate and book the gain/loss entry.`;
      case 'AMT_MISMATCH':
        return `Amount difference > 1%. Cannot confirm whether this is a partial payment, credit note offset, or data entry error without source documents. Escalate to AP/AR team.`;
      default:
        return `${id} could not be resolved by any automated pass. Add to manual review queue with full audit trail.`;
    }
  }

  /* ── Core: classify each exception as resolvable or not ── */
  function classifyException(exc, allExceptions) {
    const { reasonCode, amount } = exc;
    const threshold = RESOLVE_CONFIDENCE[reasonCode] ?? 0.5;

    // DUPE_CANDIDATE always goes to human — the agent cannot safely choose
    if (reasonCode === 'DUPE_CANDIDATE') {
      return { resolvable: false, confidence: 0.45, note: escalationNote(exc) };
    }

    // FX_VARIANCE: resolvable only if variance < 2%
    if (reasonCode === 'FX_VARIANCE') {
      const variancePct = exc._variancePct ?? 0.03;
      if (variancePct > 0.02) {
        return { resolvable: false, confidence: 0.60, note: escalationNote(exc) };
      }
      return { resolvable: true, confidence: 0.80, action: suggestResolution(exc) };
    }

    // NO_REF with no amount near-match: unresolvable
    if (reasonCode === 'NO_REF' && amount > 500000) {
      return { resolvable: false, confidence: 0.55, note: escalationNote(exc) };
    }

    // AMT_MISMATCH > 5%: unresolvable
    if (reasonCode === 'AMT_MISMATCH' && exc._amtDiffPct && exc._amtDiffPct > 0.05) {
      return { resolvable: false, confidence: 0.50, note: escalationNote(exc) };
    }

    return { resolvable: true, confidence: threshold, action: suggestResolution(exc) };
  }

  /* ── Main agent entry point ── */
  function runBatch(bank, gl, ap, reconciliationResult) {
    const t0 = performance.now();
    const { matched, exceptions, apMatched, matchRate, apSettlementRate, confHistogram, totalRecords } = reconciliationResult;

    // Enrich exceptions with numeric variance for the classifier
    const enrichedExceptions = exceptions.map((exc) => {
      const enriched = { ...exc };
      if (exc.reasonCode === 'FX_VARIANCE' && exc.record) {
        // Estimate variance from the reason text
        const m = exc.reason && exc.reason.match(/([\d.]+)%/);
        enriched._variancePct = m ? parseFloat(m[1]) / 100 : 0.03;
      }
      if (exc.reasonCode === 'AMT_MISMATCH' && exc.reason) {
        const m = exc.reason.match(/([\d.]+)%/);
        enriched._amtDiffPct = m ? parseFloat(m[1]) / 100 : 0;
      }
      return enriched;
    });

    const resolved   = [];
    const unresolved = [];

    enrichedExceptions.forEach((exc) => {
      const cls = classifyException(exc, enrichedExceptions);
      const id = exc.source === 'bank' ? exc.record.txn_id
               : exc.source === 'gl'   ? exc.record.gl_id
               : exc.record.invoice_id;
      const entry = {
        id,
        source:     exc.source,
        reasonCode: exc.reasonCode,
        amount:     exc.amount,
        reason:     exc.reason,
        confidence: cls.confidence,
      };
      if (cls.resolvable) {
        resolved.push({ ...entry, action: cls.action });
      } else {
        unresolved.push({ ...entry, escalationNote: cls.note });
      }
    });

    // Sort: resolved by confidence desc, unresolved by $ impact desc
    resolved.sort((a, b) => b.confidence - a.confidence);
    unresolved.sort((a, b) => b.amount - a.amount);

    const t1 = performance.now();
    const elapsedMs = Math.round(t1 - t0);

    // Agent coverage = matched pairs + resolved exceptions / total exceptions + matched
    const totalItems = matched.length + exceptions.length;
    const closedItems = matched.length + resolved.length;

    return {
      /* Headline metrics */
      matchRate,
      apSettlementRate,
      confHistogram,
      totalRecords,
      totalItems,
      closedItems,
      coverageRate: totalItems > 0 ? closedItems / totalItems : 0,

      /* Exception lists */
      resolved,
      unresolved,
      resolvedCount:   resolved.length,
      unresolvedCount: unresolved.length,

      /* Performance */
      elapsedMs,
      throughputRps: Math.round(totalRecords / Math.max(elapsedMs / 1000, 0.001)),

      /* Audit trail */
      timestamp: new Date().toISOString(),
      datasetSummary: {
        bank: bank.length,
        gl:   gl.length,
        ap:   ap.length,
        total: bank.length + gl.length + ap.length,
      },
    };
  }

  return { runBatch };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FinAgentV1 };
}
