/* ============================================================
   data.js — Fineatch AI deterministic synthetic dataset
   Seeded PRNG (mulberry32) produces 65+ economic events → 150+
   total records across Bank / GL / AP with realistic noise:
     • Date drift ± 3 days            (20% of records)
     • Penny rounding                  (10%)
     • Missing reference               (8%)
     • FX variance on non-INR tx       (6%)
     • Misposted account code          (5%)
     • Split payments (one bank debit, two AP invoices)
     • Advance payments (bank before invoice)
     • FX-hedged receipts
     • Partial write-offs
     • Intercompany transfers
   ============================================================ */

const SEED = 84231;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let rng = mulberry32(SEED);
const rndInt   = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
const rndFloat = (min, max) => rng() * (max - min) + min;
const pick     = (arr) => arr[Math.floor(rng() * arr.length)];
const roll     = (pct) => rng() < pct;

function fmtDate(d) { return d.toISOString().slice(0, 10); }
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return fmtDate(d);
}

const BASE_DATE = '2026-07-01';

const VENDORS = [
  'Nimbus Cloud Services', 'Orbit Logistics Pvt Ltd', 'Kestrel Office Supplies',
  'Bluepeak IT Consulting', 'Sundara Facilities Mgmt', 'Vertex Marketing Co',
  'Ashoka Legal Associates', 'Northgate Freight', 'Prakash Print & Packaging',
  'Zenith HR Solutions', 'Coral Bay Insurance', 'Ridgeline Equipment Leasing',
  'Meridian Payroll Services', 'Tanvi Software Labs', 'Everest Travel Desk',
  'Horizon Data Systems', 'Crest Advisory LLP', 'Pinnacle Logistics'
];
const CUSTOMERS = [
  'Aarav Retail Chain', 'Blue Horizon Traders', 'Copper Leaf Hospitality',
  'Dockside Exports', 'Elevate Fitness Group', 'Farside Manufacturing',
  'Golden Harvest Foods', 'Hillcrest Realty', 'Indigo Maritime Ltd',
  'Juniper Analytics Co'
];

const CATEGORY_MAP = {
  vendor_payment:   { accountRange: [6000, 7999], tax: 'GST-ITC', desc: (v) => `Payment to ${v}` },
  payroll:          { accountRange: [6000, 6999], tax: 'TDS-192', desc: () => `Payroll disbursement` },
  customer_receipt: { accountRange: [4000, 5999], tax: 'GST-OUT', desc: (v) => `Receipt from ${v}` },
  tax_payment:      { accountRange: [6000, 6999], tax: 'GST-PMT', desc: () => `Statutory tax remittance` },
  asset_transfer:   { accountRange: [1000, 1999], tax: 'NA',      desc: () => `Internal fund transfer` },
  intercompany:     { accountRange: [1000, 1999], tax: 'NA',      desc: (v) => `Intercompany settlement — ${v}` },
};

function accountCodeFor(category) {
  const [lo, hi] = CATEGORY_MAP[category].accountRange;
  return String(rndInt(lo, hi));
}

function generateDataset(opts = {}) {
  rng = mulberry32(opts.seed ?? SEED);
  const eventCount     = Math.max(65, opts.eventCount ?? 65);
  const vendorShare    = opts.vendorShare ?? 38 / 58;
  const orphanBankCount= opts.orphanBankCount ?? Math.max(3, Math.round(eventCount * (5 / 65)));
  const orphanGlCount  = opts.orphanGlCount ?? Math.max(2, Math.round(eventCount * (3 / 65)));
  const dupeCount      = opts.dupeCount ?? Math.max(2, Math.round(eventCount * (3 / 65)));
  const unmatchedApShare = opts.unmatchedApShare ?? 8 / 38;
  const mispostShare     = opts.mispostShare ?? 5 / 65;
  const splitCount       = opts.splitCount ?? 3;
  const advanceCount     = opts.advanceCount ?? 2;
  const writeOffCount    = opts.writeOffCount ?? 2;

  const bank = [];
  const gl   = [];
  const ap   = [];

  const vendorCount = Math.round(eventCount * vendorShare);
  const categories  = [];
  for (let i = 0; i < eventCount; i++) {
    if (i < vendorCount) categories.push('vendor_payment');
    else categories.push(pick(['payroll', 'customer_receipt', 'tax_payment', 'asset_transfer', 'intercompany']));
  }

  const unmatchedApCount = Math.max(2, Math.round(vendorCount * unmatchedApShare));
  const unmatchedApIdx   = new Set();
  while (unmatchedApIdx.size < unmatchedApCount) unmatchedApIdx.add(rndInt(0, vendorCount - 1));

  const mispostCount = Math.max(1, Math.round(eventCount * mispostShare));
  const mispostIdx   = new Set();
  while (mispostIdx.size < mispostCount) mispostIdx.add(rndInt(0, eventCount - 1));

  let bankSeq = 1, glSeq = 1, apSeq = 1;

  categories.forEach((category, idx) => {
    const isVendor = category === 'vendor_payment';
    const isIntercompany = category === 'intercompany';
    const counterparty = isVendor || category === 'tax_payment'
      ? pick(VENDORS)
      : category === 'customer_receipt'
        ? pick(CUSTOMERS)
        : isIntercompany
          ? pick(['Treasury Alpha', 'Treasury Beta', 'HoldCo Capital'])
          : 'Treasury / Internal';

    const baseAmount = category === 'payroll'
      ? rndFloat(180000, 420000)
      : category === 'tax_payment'
        ? rndFloat(25000, 160000)
        : category === 'customer_receipt'
          ? rndFloat(40000, 650000)
          : category === 'intercompany'
            ? rndFloat(200000, 1200000)
            : rndFloat(3500, 220000);

    const amount    = Math.round(baseAmount * 100) / 100;
    const eventDate = addDays(BASE_DATE, rndInt(0, 27));
    const refBase   = `REF-${(2600 + idx).toString().padStart(5, '0')}`;
    const meta      = CATEGORY_MAP[category];
    const isVendorPaymentUnmatched = isVendor && unmatchedApIdx.has(idx);

    // ── AP invoice ──
    if (isVendor) {
      const invoiceId = `INV-${(1000 + apSeq).toString()}`;
      apSeq++;
      ap.push({
        invoice_id:  invoiceId,
        vendor:      counterparty,
        due_date:    addDays(eventDate, rndInt(-3, 5)),
        amount,
        currency:    roll(0.08) ? pick(['USD', 'EUR']) : 'INR',
        status:      'PAID',
        payment_ref: isVendorPaymentUnmatched ? null : refBase,
        _eventIdx:   idx,
        _unmatched:  isVendorPaymentUnmatched,
        _type:       'standard',
      });
    }

    // ── Bank record ──
    if (!isVendorPaymentUnmatched) {
      let bankAmount = amount;
      let bankDate   = eventDate;
      let bankRef    = refBase;
      let bankDesc   = meta.desc(counterparty);
      const isDebit  = category !== 'customer_receipt';

      if (roll(0.20)) bankDate   = addDays(eventDate, pick([-3, -2, -1, 1, 2, 3]));
      if (roll(0.10)) bankAmount = Math.round((amount + rndFloat(-1.5, 1.5)) * 100) / 100;
      if (roll(0.08)) bankRef    = null;
      const currency = roll(0.06) ? pick(['USD', 'EUR']) : 'INR';
      if (currency !== 'INR') bankAmount = Math.round(bankAmount * rndFloat(0.985, 1.02) * 100) / 100;

      bank.push({
        txn_id:      `BNK-${(1000 + bankSeq).toString()}`,
        date:        bankDate,
        amount:      isDebit ? -Math.abs(bankAmount) : Math.abs(bankAmount),
        description: bankDesc,
        reference:   bankRef,
        counterparty,
        currency,
        _eventIdx:   idx,
        _type:       'standard',
      });
      bankSeq++;
    }

    // ── GL record ──
    const misposted  = mispostIdx.has(idx);
    const accountCode = misposted
      ? String(rndInt(1000, 1999))
      : accountCodeFor(category);
    const isDebitGL = category !== 'customer_receipt';
    const glRef     = roll(0.12) ? null : refBase;

    gl.push({
      gl_id:        `GL-${(5000 + glSeq).toString()}`,
      posting_date: eventDate,
      debit:        isDebitGL ? amount : 0,
      credit:       isDebitGL ? 0 : amount,
      account_code: accountCode,
      cost_center:  pick(['CC-OPS', 'CC-SALES', 'CC-ADMIN', 'CC-TECH', 'CC-HR']),
      narration:    meta.desc(counterparty),
      reference:    glRef,
      tax_code:     roll(0.06) ? null : meta.tax,
      _eventIdx:    idx,
      _misposted:   misposted,
      _type:        'standard',
    });
    glSeq++;
  });

  // ── SPLIT PAYMENTS: one bank debit split across two AP invoices ──
  for (let s = 0; s < splitCount; s++) {
    const vendor    = pick(VENDORS);
    const total     = Math.round(rndFloat(50000, 300000) * 100) / 100;
    const split1    = Math.round(total * rndFloat(0.4, 0.6) * 100) / 100;
    const split2    = Math.round((total - split1) * 100) / 100;
    const evDate    = addDays(BASE_DATE, rndInt(0, 27));
    const splitRef  = `REF-SP${(100 + s).toString()}`;

    bank.push({
      txn_id: `BNK-${(1000 + bankSeq).toString()}`,
      date: evDate, amount: -total, description: `Split payment to ${vendor}`,
      reference: splitRef, counterparty: vendor, currency: 'INR',
      _eventIdx: null, _type: 'split_bank',
    });
    bankSeq++;

    [split1, split2].forEach((amt, i) => {
      ap.push({
        invoice_id: `INV-SP${(100 + s * 2 + i).toString()}`,
        vendor, due_date: addDays(evDate, 1), amount: amt,
        currency: 'INR', status: 'PAID', payment_ref: splitRef,
        _eventIdx: null, _unmatched: false, _type: 'split_ap',
      });
      gl.push({
        gl_id: `GL-${(5000 + glSeq).toString()}`,
        posting_date: evDate, debit: amt, credit: 0,
        account_code: String(rndInt(6000, 7999)), cost_center: pick(['CC-OPS', 'CC-ADMIN']),
        narration: `Payment to ${vendor} (split ${i + 1}/2)`, reference: splitRef,
        tax_code: 'GST-ITC', _eventIdx: null, _misposted: false, _type: 'split_gl',
      });
      glSeq++;
    });
  }

  // ── ADVANCE PAYMENTS: bank debit before invoice is raised ──
  for (let a2 = 0; a2 < advanceCount; a2++) {
    const vendor   = pick(VENDORS);
    const amount2  = Math.round(rndFloat(20000, 150000) * 100) / 100;
    const bankDate = addDays(BASE_DATE, rndInt(0, 14));
    const advRef   = `REF-ADV${(10 + a2).toString()}`;

    bank.push({
      txn_id: `BNK-${(1000 + bankSeq).toString()}`,
      date: bankDate, amount: -amount2,
      description: `Advance payment to ${vendor}`,
      reference: advRef, counterparty: vendor, currency: 'INR',
      _eventIdx: null, _type: 'advance',
    });
    bankSeq++;

    // Invoice arrives later — may or may not clear in the 30-day window
    ap.push({
      invoice_id: `INV-ADV${(10 + a2).toString()}`,
      vendor, due_date: addDays(bankDate, rndInt(8, 20)), amount: amount2,
      currency: 'INR', status: roll(0.5) ? 'PENDING' : 'PAID',
      payment_ref: advRef,
      _eventIdx: null, _unmatched: false, _type: 'advance',
    });

    gl.push({
      gl_id: `GL-${(5000 + glSeq).toString()}`,
      posting_date: bankDate, debit: amount2, credit: 0,
      account_code: String(rndInt(1000, 1999)),
      cost_center: 'CC-OPS',
      narration: `Advance payment to ${vendor}`, reference: advRef,
      tax_code: null, _eventIdx: null, _misposted: false, _type: 'advance',
    });
    glSeq++;
  }

  // ── PARTIAL WRITE-OFFS ──
  for (let w = 0; w < writeOffCount; w++) {
    const originalAmt  = Math.round(rndFloat(10000, 80000) * 100) / 100;
    const writtenOff   = Math.round(originalAmt * rndFloat(0.1, 0.4) * 100) / 100;
    const settled      = Math.round((originalAmt - writtenOff) * 100) / 100;
    const woDate       = addDays(BASE_DATE, rndInt(0, 27));
    const woRef        = `REF-WO${(20 + w).toString()}`;

    // Bank only receives partial settlement
    bank.push({
      txn_id: `BNK-${(1000 + bankSeq).toString()}`,
      date: woDate, amount: settled,
      description: `Partial receipt — write-off applied`,
      reference: woRef, counterparty: pick(CUSTOMERS), currency: 'INR',
      _eventIdx: null, _type: 'write_off',
    });
    bankSeq++;

    // GL carries full original + write-off entry
    gl.push({
      gl_id: `GL-${(5000 + glSeq).toString()}`,
      posting_date: woDate, debit: 0, credit: originalAmt,
      account_code: String(rndInt(4000, 5999)), cost_center: 'CC-SALES',
      narration: `Customer receipt — partial write-off`, reference: woRef,
      tax_code: 'GST-OUT', _eventIdx: null, _misposted: false, _type: 'write_off',
    });
    glSeq++;

    gl.push({
      gl_id: `GL-${(5000 + glSeq).toString()}`,
      posting_date: woDate, debit: writtenOff, credit: 0,
      account_code: String(rndInt(8000, 8999)), cost_center: 'CC-ADMIN',
      narration: `Bad debt write-off`, reference: woRef,
      tax_code: null, _eventIdx: null, _misposted: false, _type: 'write_off',
    });
    glSeq++;
  }

  // ── ORPHAN BANK records (fees / stray deposits) ──
  const orphanBankDescs = [
    'Bank service charge', 'NEFT processing fee', 'Unidentified inward remittance',
    'Interest credit', 'Card settlement batch', 'ATM cash deposit', 'RTGS charge reversal',
    'Wire transfer fee', 'Account maintenance charge', 'Dividend credit',
  ];
  for (let i = 0; i < orphanBankCount; i++) {
    const isFee = i % 2 === 0;
    bank.push({
      txn_id: `BNK-${(1000 + bankSeq).toString()}`,
      date: addDays(BASE_DATE, rndInt(0, 27)),
      amount: isFee ? -rndFloat(150, 4500) : rndFloat(1200, 38000),
      description: orphanBankDescs[i % orphanBankDescs.length],
      reference: null, counterparty: 'Bank', currency: 'INR',
      _eventIdx: null, _type: 'orphan',
    });
    bankSeq++;
  }

  // ── DUPLICATE GL POSTINGS ──
  const dupCandidates = [];
  for (let idx = 0; idx < eventCount && dupCandidates.length < dupeCount; idx++) {
    const b = bank.find((x) => x._eventIdx === idx);
    const g = gl.find((x) => x._eventIdx === idx);
    if (b && g && b.reference && g.reference && b.reference === g.reference) dupCandidates.push(idx);
  }
  dupCandidates.forEach((srcIdx) => {
    const original = gl.find((g) => g._eventIdx === srcIdx);
    if (!original) return;
    gl.push({
      gl_id: `GL-${(5000 + glSeq).toString()}`,
      posting_date: original.posting_date,
      debit: original.debit, credit: original.credit,
      account_code: original.account_code, cost_center: original.cost_center,
      narration: original.narration + ' (dup. entry)',
      reference: original.reference,
      tax_code: original.tax_code,
      _eventIdx: null, _misposted: false, _type: 'duplicate',
    });
    glSeq++;
  });

  // ── ORPHAN GL entries (accruals / adjustments) ──
  const orphanGlNarrations = [
    'Month-end accrual', 'Depreciation adjustment',
    'Provision for expenses', 'FX revaluation entry',
    'Lease liability amortisation', 'Right-of-use asset',
  ];
  for (let i = 0; i < orphanGlCount; i++) {
    const amt = rndFloat(8000, 95000);
    gl.push({
      gl_id: `GL-${(5000 + glSeq).toString()}`,
      posting_date: addDays(BASE_DATE, rndInt(0, 27)),
      debit: i % 2 === 0 ? amt : 0, credit: i % 2 === 0 ? 0 : amt,
      account_code: String(rndInt(6000, 8999)),
      cost_center: pick(['CC-OPS', 'CC-ADMIN', 'CC-TECH']),
      narration: orphanGlNarrations[i % orphanGlNarrations.length],
      tax_code: null, _eventIdx: null, _misposted: false, _type: 'orphan',
    });
    glSeq++;
  }

  const summary = {
    bankCount: bank.length,
    glCount:   gl.length,
    apCount:   ap.length,
    total:     bank.length + gl.length + ap.length,
    eventCount,
    noiseTypes: ['date_drift','penny_rounding','missing_ref','fx_variance','misposting',
                 'split_payment','advance_payment','partial_write_off','duplicate_gl','orphan_entries'],
  };

  return { bank, gl, ap, summary };
}

const DATASET_SUMMARY = (() => {
  const ds = generateDataset({ eventCount: 65 });
  return ds.summary;
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generateDataset, SEED, DATASET_SUMMARY };
}
