/* ============================================================
   qa_agent.js — Fineatch AI Settlement Q&A Engine
   Rule-based, fully offline. Answers questions about:
     - Specific transaction IDs (BNK / GL / INV)
     - Exception categories (AMT_MISMATCH, FX_VARIANCE, etc.)
     - Cash position (N days out)
     - General status summary
     - Agent results (what did the agent find?)
     - Unresolvable exceptions (honest list)
     - Dataset record count
   ============================================================ */

const QAAgent = (function () {

  function extractTxnId(q) {
    const m = q.match(/\b(BNK|GL|INV|INV-SP|INV-ADV|BNK-SP|BNK-ADV)-[\w\d]{2,6}\b/i);
    return m ? m[0].toUpperCase() : null;
  }

  function extractReasonCode(q) {
    const codes = ['AMT_MISMATCH', 'DATE_GAP', 'NO_REF', 'DUPE_CANDIDATE', 'FX_VARIANCE', 'SPLIT_PAYMENT', 'ADVANCE_PAYMENT'];
    const upper = q.toUpperCase();
    const found = codes.find((c) => upper.includes(c.replace('_', ' ')) || upper.includes(c));
    if (found) return found;
    if (/fx|currency|forex/i.test(q))          return 'FX_VARIANCE';
    if (/no ref|missing ref|reference/i.test(q)) return 'NO_REF';
    if (/date|timing|late/i.test(q))            return 'DATE_GAP';
    if (/amount|mismatch|differ/i.test(q))      return 'AMT_MISMATCH';
    if (/duplicate|dupe/i.test(q))              return 'DUPE_CANDIDATE';
    if (/split/i.test(q))                       return 'SPLIT_PAYMENT';
    if (/advance/i.test(q))                     return 'ADVANCE_PAYMENT';
    return null;
  }

  function money(n) { return '₹' + Math.round(n).toLocaleString('en-IN'); }
  function pct(n)   { return (n * 100).toFixed(1) + '%'; }

  function findRecord(id, state) {
    const { bank, gl, ap } = state.data;
    if (id.startsWith('BNK')) return { type: 'bank', record: bank.find((b) => b.txn_id === id) };
    if (id.startsWith('GL'))  return { type: 'gl',   record: gl.find((g) => g.gl_id === id) };
    if (id.startsWith('INV')) return { type: 'ap',   record: ap.find((a) => a.invoice_id === id) };
    return null;
  }

  function explainTransaction(id, state) {
    const found = findRecord(id, state);
    if (!found || !found.record)
      return `I couldn't find a record with ID ${id}. Double-check it against the reconciliation table.`;

    const { reconciliation, agentReport } = state;

    // Check matched pairs
    const matchedHit = reconciliation.matched.find((m) =>
      (found.type === 'bank' && m.bank.txn_id === id) ||
      (found.type === 'gl'   && m.gl.gl_id   === id));
    if (matchedHit) {
      return `${id} matched at ${matchedHit.confidence}% confidence on the ${matchedHit.pass} pass, `
        + `paired with ${found.type === 'bank' ? matchedHit.gl.gl_id : matchedHit.bank.txn_id} `
        + `for ${money(found.record.debit ?? found.record.credit ?? Math.abs(found.record.amount))}. No action needed.`;
    }

    // Check AP settlement
    const apHit = reconciliation.apMatched.find((m) =>
      m.invoice.invoice_id === id || m.bank.txn_id === id);
    if (apHit) {
      return `${id} is a settled AP item — ${apHit.invoice.invoice_id} matched against `
        + `bank debit ${apHit.bank.txn_id} for ${money(apHit.invoice.amount)}.`;
    }

    // Check agent's resolved list
    if (agentReport) {
      const resolved = agentReport.resolved.find((r) => r.id === id);
      if (resolved) {
        return `${id} is in the agent's resolved list (${resolved.reasonCode}). `
          + `Agent action: ${resolved.action}`;
      }
      const unresolved = agentReport.unresolved.find((r) => r.id === id);
      if (unresolved) {
        return `${id} is in the agent's UNRESOLVABLE list. Reason: ${unresolved.reason}. `
          + `Escalation note: ${unresolved.escalationNote} Amount at risk: ${money(unresolved.amount)}.`;
      }
    }

    // Check exceptions
    const exc = reconciliation.exceptions.find((e) => {
      const rid = e.source === 'bank' ? e.record.txn_id
                : e.source === 'gl'   ? e.record.gl_id
                : e.record.invoice_id;
      return rid === id;
    });
    if (exc) {
      return `${id} is flagged — reason: ${exc.reasonCode} (${exc.reason}). `
        + `Amount at risk: ${money(exc.amount)}. Suggested: ${exc.suggestedAction}`;
    }

    return `${id} exists in the dataset but hasn't been processed yet — try running reconciliation first.`;
  }

  function listByReasonCode(code, state) {
    const hits = state.reconciliation.exceptions.filter((e) => e.reasonCode === code);
    if (hits.length === 0) return `No open exceptions tagged ${code}.`;
    const lines = hits.slice(0, 8).map((e) => {
      const id = e.source === 'bank' ? e.record.txn_id
               : e.source === 'gl'   ? e.record.gl_id
               : e.record.invoice_id;
      return `• ${id} — ${money(e.amount)} — ${e.reason}`;
    });
    const more = hits.length > 8 ? `\n…and ${hits.length - 8} more.` : '';
    return `${hits.length} exception(s) tagged ${code}:\n${lines.join('\n')}${more}`;
  }

  function cashInNDays(n, state) {
    const day = state.forecast.days[Math.min(n, state.forecast.days.length) - 1];
    if (!day) return `I only have a ${state.forecast.days.length}-day forecast window.`;
    return `Projected cash position ${n} day(s) out (${day.date}): ${money(day.balance)} `
      + `(range ${money(day.p10)} – ${money(day.p90)}).`;
  }

  function summarize(state) {
    const r = state.reconciliation;
    const a = state.agentReport;
    const agentLine = a
      ? ` Agent closed ${a.closedItems}/${a.totalItems} items (${pct(a.coverageRate)} coverage), `
        + `with ${a.unresolvedCount} unresolvable item(s) requiring human review.`
      : '';
    return `Match rate is ${pct(r.matchRate)} across ${r.totalRecords} records. `
      + `AP settlement rate is ${pct(r.apSettlementRate)}. `
      + `${r.exceptions.length} open exceptions worth ${money(r.exceptions.reduce((s, e) => s + e.amount, 0))}.`
      + agentLine;
  }

  function agentSummary(state) {
    if (!state.agentReport) return 'Run reconciliation first — the agent hasn\'t processed any data yet.';
    const a = state.agentReport;
    return `Agent run complete:\n`
      + `• Match rate: ${pct(a.matchRate)} (AP settlement: ${pct(a.apSettlementRate)})\n`
      + `• Confidence — Exact: ${a.confHistogram['90-100']}, Fuzzy: ${a.confHistogram['70-89']}, Heuristic: ${a.confHistogram['40-69']}\n`
      + `• Closed ${a.closedItems} of ${a.totalItems} items (${pct(a.coverageRate)} coverage)\n`
      + `• Resolved ${a.resolvedCount} exception(s) with suggested actions\n`
      + `• Could NOT resolve ${a.unresolvedCount} item(s) — escalated to human review\n`
      + `• Throughput: ${a.throughputRps.toLocaleString('en-IN')} rec/s in ${a.elapsedMs}ms`;
  }

  function listUnresolvable(state) {
    if (!state.agentReport) return 'Run reconciliation first.';
    const ur = state.agentReport.unresolved;
    if (ur.length === 0) return '✓ Great news — the agent resolved all exceptions. No items require human review.';
    const lines = ur.map((u) => `• ${u.id} (${u.reasonCode}) — ${money(u.amount)} — ${u.escalationNote}`);
    return `${ur.length} unresolvable item(s) requiring human controller review:\n${lines.join('\n')}`;
  }

  function recordCount(state) {
    if (!state.data) return 'Run reconciliation first.';
    const s = state.data.summary;
    return `Dataset contains ${s.total} total records: ${s.bankCount} bank transactions, `
      + `${s.glCount} GL entries, and ${s.apCount} AP invoices across ${s.eventCount} economic events. `
      + `Noise types: ${s.noiseTypes.join(', ')}.`;
  }

  /* ── Main ask router ── */
  function ask(question, state) {
    if (!state.reconciliation)
      return "Run reconciliation first — I don't have any data to answer from yet.";

    const q = (question || '').trim();

    // Web search query
    if (/web|search|online|fetch|url|public data/i.test(q)) {
      return "🌐 Web Dataset Search active! Head over to the 'Import Data' tab to search public web datasets or enter any public CSV/API URL to fetch live financial data.";
    }

    // Specific transaction lookup
    const id = extractTxnId(q);
    if (id) return explainTransaction(id, state);

    // Agent results
    if (/agent|what did.*find|batch.*result|coverage/i.test(q)) return agentSummary(state);

    // Unresolvable / escalated
    if (/unresolvab|could not resolve|escalat|human review/i.test(q)) return listUnresolvable(state);

    // Record count
    if (/how many record|dataset|total record|how large/i.test(q)) return recordCount(state);

    // Cash / balance
    if (/cash|balance|runway|forecast/i.test(q)) {
      const dayMatch = q.match(/(\d+)\s*day/i);
      const n = dayMatch ? parseInt(dayMatch[1], 10) : 30;
      return cashInNDays(n, state);
    }

    // Exception category
    const reasonCode = extractReasonCode(q);
    if (reasonCode) return listByReasonCode(reasonCode, state);

    // Summary
    if (/summary|overview|how (are|is) (we|things|it)|status/i.test(q)) return summarize(state);

    // Tax
    if (/tax|exposure/i.test(q)) {
      const t = state.tax;
      return `Tax classifier flagged ${t.flagged.length} GL line(s) with estimated exposure of ${money(t.totalExposure)}. `
        + `Largest bucket: ${Object.entries(t.categoryTotals).sort((a, b) => b[1] - a[1])[0][0]}.`;
    }

    // Largest exception
    if (/exception/i.test(q) && /most|biggest|largest|top/i.test(q)) {
      const top = state.reconciliation.exceptions[0];
      if (!top) return 'No open exceptions right now.';
      const rid = top.source === 'bank' ? top.record.txn_id
                : top.source === 'gl'   ? top.record.gl_id
                : top.record.invoice_id;
      return `Largest open exception: ${rid} at ${money(top.amount)} (${top.reasonCode}): ${top.reason}`;
    }

    return 'I can answer questions about:\n'
      + '• A specific record — "why was BNK-1024 flagged?"\n'
      + '• Exception categories — "show me all FX exceptions"\n'
      + '• Cash position — "what\'s my cash in 15 days?"\n'
      + '• Agent results — "what did the agent find?"\n'
      + '• Unresolved items — "show unresolvable exceptions"\n'
      + '• Record count — "how many records are in the dataset?"\n'
      + '• Status summary — "give me a status summary"';
  }

  return { ask };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { QAAgent };
}
