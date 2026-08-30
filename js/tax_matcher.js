/* ============================================================
   tax_matcher.js — classifies every GL line into a tax category
   by account-code range, and flags anomalies:
     - missing tax_code
     - account range that doesn't match the narration's own keywords
     - estimated tax exposure sitting inside open exceptions
   ============================================================ */

const TAX_RANGES = [
  { lo: 1000, hi: 1999, category: 'Asset (non-deductible)', deductible: false },
  { lo: 4000, hi: 5999, category: 'Revenue / COGS', deductible: false },
  { lo: 6000, hi: 7999, category: 'Operating expense (deductible)', deductible: true },
  { lo: 8000, hi: 8999, category: 'Capital expenditure', deductible: false },
];

const KEYWORD_EXPECTATION = [
  { keyword: 'payroll', expectRange: [6000, 6999] },
  { keyword: 'payment to', expectRange: [6000, 7999] },
  { keyword: 'receipt from', expectRange: [4000, 5999] },
  { keyword: 'transfer', expectRange: [1000, 1999] },
  { keyword: 'tax remittance', expectRange: [6000, 6999] },
];

function classifyAccount(code) {
  const n = parseInt(code, 10);
  const hit = TAX_RANGES.find((r) => n >= r.lo && n <= r.hi);
  return hit || { category: 'Unclassified', deductible: false };
}

function matchTax(gl) {
  const flagged = [];
  const categoryTotals = {};

  gl.forEach((g) => {
    const amount = g.debit || g.credit;
    const cls = classifyAccount(g.account_code);
    categoryTotals[cls.category] = (categoryTotals[cls.category] || 0) + amount;

    const issues = [];
    if (!g.tax_code) issues.push('MISSING_TAX_CODE');

    const narrationLower = (g.narration || '').toLowerCase();
    const expectation = KEYWORD_EXPECTATION.find((k) => narrationLower.includes(k.keyword));
    if (expectation) {
      const n = parseInt(g.account_code, 10);
      if (n < expectation.expectRange[0] || n > expectation.expectRange[1]) {
        issues.push('ACCOUNT_MISMATCH');
      }
    }

    if (issues.length > 0) {
      flagged.push({
        gl_id: g.gl_id,
        narration: g.narration,
        account_code: g.account_code,
        category: cls.category,
        amount,
        issues,
        estimatedExposure: issues.includes('ACCOUNT_MISMATCH') ? Math.round(amount * 0.18) : 0,
      });
    }
  });

  const totalExposure = flagged.reduce((s, f) => s + f.estimatedExposure, 0);

  return { categoryTotals, flagged, totalExposure };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { matchTax, classifyAccount, TAX_RANGES };
}
