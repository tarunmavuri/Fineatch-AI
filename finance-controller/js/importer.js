/* ============================================================
   importer.js — Fineatch AI Custom Dataset Importer
   ──────────────────────────────────────────────────────────
   Parses user-uploaded CSV files (Bank / GL / AP) into the
   same internal schema the reconciliation engine expects.
   
   Expected CSV column headers (case-insensitive):

   BANK:  date, amount, description, reference, counterparty, currency
   GL:    posting_date, debit, credit, account_code, cost_center,
          narration, reference, tax_code
   AP:    vendor, due_date, amount, currency, status, payment_ref

   All IDs are auto-generated. Missing optional columns default
   to null. Amount must be numeric (negative = debit for bank).
   ============================================================ */

const DataImporter = (function () {

  /* ── CSV parser (handles quoted fields with commas inside) ── */
  function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row.');

    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/[^a-z_]/g, ''));

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Handles quoted fields
      const fields = [];
      let inQuotes = false, current = '';
      for (let c = 0; c < line.length; c++) {
        if (line[c] === '"') { inQuotes = !inQuotes; }
        else if (line[c] === ',' && !inQuotes) { fields.push(current.trim()); current = ''; }
        else { current += line[c]; }
      }
      fields.push(current.trim());

      const row = {};
      headers.forEach((h, idx) => { row[h] = fields[idx] !== undefined ? fields[idx] : null; });
      rows.push(row);
    }
    return { headers, rows };
  }

  function num(v, fallback = 0) {
    const n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  }

  function str(v) { return v && v !== '' ? String(v).trim() : null; }

  /* ── Schema validators ── */
  function detectType(headers) {
    const h = new Set(headers);
    if (h.has('debit') || h.has('credit') || h.has('account_code') || h.has('narration')) return 'gl';
    if (h.has('vendor') || h.has('invoice_id') || h.has('due_date') || h.has('payment_ref')) return 'ap';
    if (h.has('description') || h.has('counterparty') || h.has('txn_id')) return 'bank';
    throw new Error('Cannot detect file type. Expected columns for Bank, GL, or AP data.');
  }

  /* ── Row mappers ── */
  function mapBank(rows, datasetId) {
    return rows.map((r, i) => ({
      txn_id:      str(r.txn_id)      || `${datasetId}-BNK-${String(i + 1).padStart(4, '0')}`,
      date:        str(r.date)         || str(r.posting_date) || '2026-01-01',
      amount:      num(r.amount),
      description: str(r.description) || str(r.narration) || '—',
      reference:   str(r.reference)   || str(r.ref) || null,
      counterparty:str(r.counterparty)|| str(r.vendor) || str(r.party) || null,
      currency:    str(r.currency)    || 'INR',
      _eventIdx:   null,
      _type:       'imported',
      _datasetId:  datasetId,
    }));
  }

  function mapGL(rows, datasetId) {
    return rows.map((r, i) => {
      const debit  = num(r.debit);
      const credit = num(r.credit);
      // If only 'amount' column: positive = credit, negative = debit
      const amt    = num(r.amount);
      return {
        gl_id:        str(r.gl_id)        || `${datasetId}-GL-${String(i + 1).padStart(4, '0')}`,
        posting_date: str(r.posting_date) || str(r.date) || '2026-01-01',
        debit:        debit || (amt < 0 ? Math.abs(amt) : 0),
        credit:       credit || (amt > 0 ? amt : 0),
        account_code: str(r.account_code) || str(r.account) || '6000',
        cost_center:  str(r.cost_center)  || str(r.costcenter) || 'CC-OPS',
        narration:    str(r.narration)    || str(r.description) || '—',
        reference:    str(r.reference)   || str(r.ref) || null,
        tax_code:     str(r.tax_code)    || str(r.taxcode) || null,
        _eventIdx:    null,
        _misposted:   false,
        _type:        'imported',
        _datasetId:   datasetId,
      };
    });
  }

  function mapAP(rows, datasetId) {
    return rows.map((r, i) => ({
      invoice_id:  str(r.invoice_id)  || `${datasetId}-INV-${String(i + 1).padStart(4, '0')}`,
      vendor:      str(r.vendor)      || str(r.counterparty) || str(r.party) || '—',
      due_date:    str(r.due_date)    || str(r.date) || '2026-01-31',
      amount:      Math.abs(num(r.amount)),
      currency:    str(r.currency)   || 'INR',
      status:      (str(r.status) || 'PAID').toUpperCase(),
      payment_ref: str(r.payment_ref)|| str(r.reference) || str(r.ref) || null,
      _eventIdx:   null,
      _unmatched:  false,
      _type:       'imported',
      _datasetId:  datasetId,
    }));
  }

  /* ── Validation ── */
  function validateBank(records) {
    const errs = [];
    records.forEach((r, i) => {
      if (r.amount === 0) errs.push(`Row ${i + 1}: amount is 0 or missing.`);
    });
    return errs;
  }

  function validateGL(records) {
    const errs = [];
    records.forEach((r, i) => {
      if (r.debit === 0 && r.credit === 0) errs.push(`Row ${i + 1}: both debit and credit are 0.`);
    });
    return errs;
  }

  function validateAP(records) {
    const errs = [];
    records.forEach((r, i) => {
      if (!r.vendor || r.vendor === '—') errs.push(`Row ${i + 1}: vendor name missing.`);
      if (r.amount === 0) errs.push(`Row ${i + 1}: amount is 0.`);
    });
    return errs;
  }

  /* ── Main import function ── */
  function importCSV(text, datasetId) {
    const { headers, rows } = parseCSV(text);
    const type = detectType(headers);

    let records, warnings;
    switch (type) {
      case 'bank':
        records  = mapBank(rows, datasetId);
        warnings = validateBank(records);
        break;
      case 'gl':
        records  = mapGL(rows, datasetId);
        warnings = validateGL(records);
        break;
      case 'ap':
        records  = mapAP(rows, datasetId);
        warnings = validateAP(records);
        break;
    }

    return { type, records, rowCount: rows.length, warnings, headers };
  }

  /* ── CSV template generator ── */
  function getTemplate(type) {
    const templates = {
      bank: `date,amount,description,reference,counterparty,currency
2026-07-05,-45000,Payment to Nimbus Cloud,REF-00001,Nimbus Cloud Services,INR
2026-07-08,120000,Receipt from Aarav Retail,REF-00002,Aarav Retail Chain,INR
2026-07-12,-18500,Bank service charge,,Bank,INR
2026-07-15,-95000,Payment to Bluepeak IT,REF-00003,Bluepeak IT Consulting,INR
2026-07-20,320000,Receipt from Dockside Exports,,Dockside Exports,INR`,

      gl: `posting_date,debit,credit,account_code,cost_center,narration,reference,tax_code
2026-07-05,45000,0,6500,CC-TECH,Payment to Nimbus Cloud Services,REF-00001,GST-ITC
2026-07-08,0,120000,4500,CC-SALES,Receipt from Aarav Retail Chain,REF-00002,GST-OUT
2026-07-12,1800,0,6000,CC-OPS,Bank service charge,,
2026-07-15,95000,0,6800,CC-TECH,Payment to Bluepeak IT Consulting,REF-00003,GST-ITC
2026-07-20,0,320000,4200,CC-SALES,Receipt from Dockside Exports,,GST-OUT`,

      ap: `vendor,due_date,amount,currency,status,payment_ref
Nimbus Cloud Services,2026-07-06,45000,INR,PAID,REF-00001
Bluepeak IT Consulting,2026-07-16,95000,INR,PAID,REF-00003
Kestrel Office Supplies,2026-07-22,28000,INR,PENDING,
Orbit Logistics Pvt Ltd,2026-07-25,67500,INR,PAID,REF-00007`,
    };
    return templates[type] || templates.bank;
  }

  /* ── Web Dataset sample generator ── */
  function getWebSampleCSV(sampleKey) {
    const samples = {
      'web-sample-bank': `date,amount,description,reference,counterparty,currency
2026-07-02,-125000,AWS Cloud Infrastructure US,REF-WEB-001,Amazon Web Services,USD
2026-07-04,340000,Stripe Online Payment Payout,REF-WEB-002,Stripe Payments,USD
2026-07-07,-42000,Google Workspace & Ads,REF-WEB-003,Google Ireland Ltd,EUR
2026-07-10,-18500,GitHub Enterprise Cloud,REF-WEB-004,GitHub Inc,USD
2026-07-14,-65000,Zoom Video Communications,REF-WEB-005,Zoom Video Communications,USD
2026-07-18,520000,PayPal Merchant Settlement,REF-WEB-006,PayPal Pte Ltd,SGD
2026-07-22,-88000,Slack Enterprise Grid,REF-WEB-007,Slack Technologies,USD
2026-07-25,195000,Shopify Payments Disbursement,REF-WEB-008,Shopify Inc,CAD`,

      'web-sample-gl': `posting_date,debit,credit,account_code,cost_center,narration,reference,tax_code
2026-07-02,125000,0,6500,CC-CLOUD,AWS Cloud Infrastructure US,REF-WEB-001,GST-ITC
2026-07-04,0,340000,4100,CC-REVENUE,Stripe Online Payment Payout,REF-WEB-002,GST-OUT
2026-07-07,42000,0,6600,CC-MKTG,Google Workspace & Ads,REF-WEB-003,GST-ITC
2026-07-10,18500,0,6500,CC-TECH,GitHub Enterprise Cloud,REF-WEB-004,GST-ITC
2026-07-14,65000,0,6100,CC-OPS,Zoom Video Communications,REF-WEB-005,GST-ITC
2026-07-18,0,520000,4100,CC-REVENUE,PayPal Merchant Settlement,REF-WEB-006,GST-OUT
2026-07-22,88000,0,6100,CC-OPS,Slack Enterprise Grid,REF-WEB-007,GST-ITC
2026-07-25,0,195000,4100,CC-REVENUE,Shopify Payments Disbursement,REF-WEB-008,GST-OUT`,

      'web-sample-ap': `vendor,due_date,amount,currency,status,payment_ref
Amazon Web Services,2026-07-03,125000,USD,PAID,REF-WEB-001
Google Ireland Ltd,2026-07-08,42000,EUR,PAID,REF-WEB-003
GitHub Inc,2026-07-11,18500,USD,PAID,REF-WEB-004
Zoom Video Communications,2026-07-15,65000,USD,PAID,REF-WEB-005
Slack Technologies,2026-07-23,88000,USD,PAID,REF-WEB-007
DataDog Inc,2026-07-28,45000,USD,PENDING,`
    };
    return samples[sampleKey] || samples['web-sample-bank'];
  }

  return { importCSV, getTemplate, detectType, parseCSV, getWebSampleCSV };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DataImporter };
}

