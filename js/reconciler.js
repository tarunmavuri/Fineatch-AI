/* ============================================================
   reconciler.js — multi-pass matching engine
   Pass 1  Exact      amount + reference match                 -> 100%
   Pass 2  Fuzzy       amount ±0.5%, date ±3d, text similarity  -> 70-99%
   Pass 3  Heuristic   amount ±1%, counterparty substring       -> 40-69%
   Below 40% confidence -> exception, with a reason code.
   ============================================================ */

function textSimilarity(a, b) {
  if (!a || !b) return 0;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter(Boolean);
  const ta = new Set(norm(a));
  const tb = new Set(norm(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  ta.forEach((tok) => { if (tb.has(tok)) overlap++; });
  return overlap / Math.max(ta.size, tb.size);
}

function daysBetween(a, b) {
  return Math.abs((new Date(a) - new Date(b)) / 86400000);
}

function reconcile(bank, gl, ap) {
  const t0 = performance.now();

  const bankPool = bank.map((b) => ({ ...b, _absAmount: Math.abs(b.amount) }));
  const glPool = gl.map((g) => ({ ...g, _amount: g.debit || g.credit }));
  const usedGl = new Set();
  const usedBank = new Set();

  const matched = [];
  const dupeExceptions = [];

  function tryMatch(passName, scoreFn, threshold) {
    bankPool.forEach((b) => {
      if (usedBank.has(b.txn_id)) return;
      let best = null, bestScore = 0, second = null, secondScore = 0;
      glPool.forEach((g) => {
        if (usedGl.has(g.gl_id)) return;
        const score = scoreFn(b, g);
        if (score > bestScore) { second = best; secondScore = bestScore; best = g; bestScore = score; }
        else if (score > secondScore) { second = g; secondScore = score; }
      });
      if (!best || bestScore < threshold) return;

      // two candidates within a hair of each other's score — a human should
      // pick, not the algorithm. Flag both instead of silently choosing one.
      if (second && secondScore >= threshold && (bestScore - secondScore) < 0.01) {
        usedGl.add(best.gl_id);
        usedGl.add(second.gl_id);
        usedBank.add(b.txn_id);
        dupeExceptions.push({
          source: 'bank', record: b, reasonCode: 'DUPE_CANDIDATE', amount: b._absAmount,
          reason: `${best.gl_id} and ${second.gl_id} are equally plausible matches for ${b.txn_id} — looks like a duplicate posting`,
          suggestedAction: 'Compare both GL entries manually and reverse the duplicate one',
        });
        return;
      }

      usedBank.add(b.txn_id);
      usedGl.add(best.gl_id);
      matched.push({
        bank: b, gl: best, confidence: Math.round(bestScore * 100), pass: passName,
      });
    });
  }

  // Pass 1 — exact: identical payment reference on both legs, amount matches
  // to the paisa. This mirrors how a real reconciliation tool works — it never
  // looks at which "event" produced a record, only at data both systems expose.
  tryMatch('Exact', (b, g) => {
    if (!b.reference || !g.reference) return 0;
    if (b.reference !== g.reference) return 0;
    if (Math.abs(b._absAmount - g._amount) >= 0.01) return 0;
    return 1.0;
  }, 1.0);

  // Pass 2 — fuzzy: amount within 0.5%, date within 3 days, description similarity >= 0.6
  tryMatch('Fuzzy', (b, g) => {
    const amtDiffPct = Math.abs(b._absAmount - g._amount) / Math.max(g._amount, 1);
    const dateDiff = daysBetween(b.date, g.posting_date);
    const sim = textSimilarity(b.description, g.narration);
    if (amtDiffPct <= 0.005 && dateDiff <= 3 && sim >= 0.6) {
      const score = 1 - amtDiffPct * 6 - dateDiff * 0.08 - (1 - sim) * 0.2;
      return Math.max(0.70, Math.min(0.99, score));
    }
    return 0;
  }, 0.70);

  // Pass 3 — heuristic: amount within 1%, counterparty substring match
  tryMatch('Heuristic', (b, g) => {
    const amtDiffPct = Math.abs(b._absAmount - g._amount) / Math.max(g._amount, 1);
    const nameHit = b.counterparty && g.narration &&
      g.narration.toLowerCase().includes(b.counterparty.toLowerCase().split(' ')[0].toLowerCase());
    if (amtDiffPct <= 0.01 && nameHit) {
      const score = 0.69 - amtDiffPct * 10;
      return Math.max(0.40, Math.min(0.69, score));
    }
    return 0;
  }, 0.40);

  // ---- exceptions: everything left over ----
  const exceptions = [];

  bankPool.forEach((b) => {
    if (usedBank.has(b.txn_id)) return;
    exceptions.push(buildException('bank', b, glPool, usedGl));
  });
  glPool.forEach((g) => {
    if (usedGl.has(g.gl_id)) return;
    exceptions.push(buildException('gl', g, bankPool, usedBank));
  });

  // ---- AP settlement pass: does every PAID invoice have a matching bank debit? ----
  const apExceptions = [];
  const apMatched = [];
  ap.forEach((inv) => {
    // exact: same payment reference, amount matches to the rupee
    let hit = bankPool.find((b) =>
      b.amount < 0 && b.reference && inv.payment_ref && b.reference === inv.payment_ref &&
      Math.abs(Math.abs(b.amount) - inv.amount) < 1);
    // fuzzy fallback: vendor name + amount within 1% + within a week of due date —
    // covers cases where the reference simply never made it onto the bank feed
    if (!hit) {
      hit = bankPool.find((b) => {
        if (b.amount >= 0) return false;
        const amtDiffPct = Math.abs(Math.abs(b.amount) - inv.amount) / Math.max(inv.amount, 1);
        const vendorHit = b.counterparty && inv.vendor &&
          b.counterparty.toLowerCase() === inv.vendor.toLowerCase();
        const dateDiff = daysBetween(b.date, inv.due_date);
        return vendorHit && amtDiffPct <= 0.01 && dateDiff <= 7;
      });
    }
    if (hit) {
      apMatched.push({ invoice: inv, bank: hit });
    } else {
      apExceptions.push({
        source: 'ap',
        record: inv,
        reasonCode: 'NO_REF',
        reason: `Invoice ${inv.invoice_id} is marked PAID but no matching bank debit was found`,
        amount: inv.amount,
        suggestedAction: 'Confirm payment was actually released; request bank advice from vendor',
      });
    }
  });

  const t1 = performance.now();
  const elapsedSec = Math.max((t1 - t0) / 1000, 0.0001);
  const totalRecords = bank.length + gl.length + ap.length;

  // "Match rate" is the core bank<->GL reconciliation rate — the metric a
  // finance-ops team actually reports. AP settlement completeness (are PAID
  // invoices backed by a real bank debit?) is tracked separately and surfaces
  // through the exception list rather than inflating this headline number.
  const matchRate = (matched.length * 2) / (bank.length + gl.length);
  const apSettlementRate = apMatched.length / ap.length;

  const confHistogram = { '90-100': 0, '70-89': 0, '40-69': 0 };
  matched.forEach((m) => {
    if (m.confidence >= 90) confHistogram['90-100']++;
    else if (m.confidence >= 70) confHistogram['70-89']++;
    else confHistogram['40-69']++;
  });

  const allExceptions = [...exceptions, ...apExceptions, ...dupeExceptions]
    .map((e) => ({ ...e, impact: Math.abs(e.amount || 0) }))
    .sort((a, b) => b.impact - a.impact);

  return {
    matched,
    apMatched,
    exceptions: allExceptions,
    matchRate,
    apSettlementRate,
    throughput: Math.round(totalRecords / elapsedSec),
    confHistogram,
    totalRecords,
    elapsedMs: Math.round(t1 - t0),
  };
}

function buildException(sourceType, record, otherPool, usedOther) {
  const amount = sourceType === 'bank' ? Math.abs(record.amount) : (record.debit || record.credit);
  const id = sourceType === 'bank' ? record.txn_id : record.gl_id;

  // find the nearest (and second-nearest) unused candidate on the other side,
  // to explain *why* it failed to match
  let nearest = null, nearestDiff = Infinity;
  let second = null, secondDiff = Infinity;
  otherPool.forEach((o) => {
    if (usedOther.has(sourceType === 'bank' ? o.gl_id : o.txn_id)) return;
    const oAmt = sourceType === 'bank' ? (o.debit || o.credit) : Math.abs(o.amount);
    const diff = Math.abs(oAmt - amount);
    if (diff < nearestDiff) { second = nearest; secondDiff = nearestDiff; nearest = o; nearestDiff = diff; }
    else if (diff < secondDiff) { second = o; secondDiff = diff; }
  });

  let reasonCode = 'NO_REF';
  let reason = `No corresponding ${sourceType === 'bank' ? 'GL entry' : 'bank transaction'} found for ${id}`;

  // two candidates within 0.5% of amount and same posting date are equally
  // plausible — a human needs to pick, not the algorithm
  if (nearest && second) {
    const secondAmt = sourceType === 'bank' ? (second.debit || second.credit) : Math.abs(second.amount);
    const secondDate = sourceType === 'bank' ? second.posting_date : second.date;
    const nearestDate = sourceType === 'bank' ? nearest.posting_date : nearest.date;
    const tie = Math.abs(secondAmt - (sourceType === 'bank' ? (nearest.debit || nearest.credit) : Math.abs(nearest.amount))) < 1
      && secondDate === nearestDate;
    if (tie) {
      const nearestId = sourceType === 'bank' ? nearest.gl_id : nearest.txn_id;
      const secondId = sourceType === 'bank' ? second.gl_id : second.txn_id;
      return {
        source: sourceType, record, reasonCode: 'DUPE_CANDIDATE', amount,
        reason: `${nearestId} and ${secondId} are equally plausible matches — looks like a duplicate posting`,
        suggestedAction: 'Compare both candidates manually and reverse the duplicate entry',
      };
    }
  }

  if (nearest) {
    const nearestAmt = sourceType === 'bank' ? (nearest.debit || nearest.credit) : Math.abs(nearest.amount);
    const amtDiffPct = Math.abs(nearestAmt - amount) / Math.max(amount, 1);
    const nearestDate = sourceType === 'bank' ? nearest.posting_date : nearest.date;
    const recordDate = sourceType === 'bank' ? record.date : record.posting_date;
    const dateDiff = daysBetween(recordDate, nearestDate);

    if (sourceType === 'bank' && record.currency !== 'INR' && amtDiffPct > 0.005) {
      reasonCode = 'FX_VARIANCE';
      reason = `${record.currency} transaction — closest INR candidate differs by ${(amtDiffPct * 100).toFixed(1)}%, likely a conversion-rate gap`;
    } else if (amtDiffPct > 0.01 && amtDiffPct <= 0.5) {
      reasonCode = 'AMT_MISMATCH';
      reason = `Closest candidate differs by ${(amtDiffPct * 100).toFixed(1)}% in amount`;
    } else if (dateDiff > 7) {
      reasonCode = 'DATE_GAP';
      reason = `Closest candidate is ${Math.round(dateDiff)} days apart`;
    }
  }
  if (sourceType === 'bank' && (!record.reference)) reasonCode = 'NO_REF';

  return {
    source: sourceType,
    record,
    reasonCode,
    reason,
    amount,
    suggestedAction: reasonCode === 'AMT_MISMATCH'
      ? 'Verify amount with source document; check for partial payment or FX rounding'
      : reasonCode === 'DATE_GAP'
        ? 'Check for late posting or timing difference between systems'
        : reasonCode === 'FX_VARIANCE'
          ? 'Recompute using the settlement-date FX rate'
          : 'Search for a missing reference number or manual journal entry',
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { reconcile };
}
