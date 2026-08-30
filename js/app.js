/* ============================================================
   app.js — Fineatch AI UI orchestration
   ============================================================ */

const state = {
  data:          null,
  reconciliation:null,
  agentReport:   null,
  forecast:      null,
  tax:           null,
  sort: { table: 'matched', key: 'confidence', dir: -1 },
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function money(n) { return '₹' + Math.round(n).toLocaleString('en-IN'); }
function pct(n)   { return (n * 100).toFixed(1) + '%'; }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function confBand(c) {
  if (c >= 90) return 'c-high';
  if (c >= 70) return 'c-mid';
  return 'c-low';
}

/* ── Animated number counter ── */
function animateValue(el, from, to, duration, format) {
  const start  = performance.now();
  const update = (now) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const val = from + (to - from) * eased;
    el.textContent = format(val);
    if (t < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
}

/* ────────────────── Run pipeline ────────────────── */
function runReconciliation() {
  const btn  = $('#runBtn');
  const fill = $('#progressFill');
  const elapsed = $('#elapsedLabel');
  btn.disabled = true;
  fill.style.width = '0%';
  const start = performance.now();

  // Show spinner in agent tab
  const spinner = $('#agentSpinner');
  const result  = $('#agentResult');
  if (spinner) spinner.style.display = 'flex';
  if (result)  result.style.display  = 'none';

  let progress = 0;
  const tick = setInterval(() => {
    progress = Math.min(progress + 12, 92);
    fill.style.width = progress + '%';
    elapsed.textContent = ((performance.now() - start) / 1000).toFixed(1) + 's';
  }, 60);

  setTimeout(() => {
    const eventCount = Math.max(65, Math.min(500, parseInt($('#eventCount').value, 10) || 65));
    state.data          = generateDataset({ eventCount });
    state.reconciliation = reconcile(state.data.bank, state.data.gl, state.data.ap);
    state.agentReport    = FinAgentV1.runBatch(
      state.data.bank, state.data.gl, state.data.ap, state.reconciliation
    );
    state.forecast = forecastCash(state.reconciliation, state.data.ap, state.data.bank);
    state.tax      = matchTax(state.data.gl);

    clearInterval(tick);
    fill.style.width = '100%';
    elapsed.textContent = ((performance.now() - start) / 1000).toFixed(2) + 's';
    btn.disabled = false;

    const ds = state.data.summary;
    $('#seedTag').textContent = `${ds.bankCount}B · ${ds.glCount}G · ${ds.apCount}A`;

    renderAll();
    fireStamp();

    // Register synthetic dataset into the scoreboard
    registerDataset(
      'synthetic',
      `Synthetic · seed #84231 · ${ds.eventCount} events`,
      'synthetic',
      state.data,
      state.reconciliation,
      state.agentReport
    );
  }, 700);
}

function fireStamp() {
  const stamp = $('#stamp');
  const rate  = state.reconciliation.matchRate;
  stamp.classList.toggle('matched', rate >= 0.78);
  $('#stampRate').textContent = pct(rate);
  stamp.classList.remove('show');
  void stamp.offsetWidth;
  stamp.classList.add('show');
}

/* ────────────────── KPIs ────────────────── */
function renderKPIs() {
  if (!state.reconciliation) {
    const mrEl = $('#kpiMatchRate');
    if (mrEl) { mrEl.className = 'kpi-value warn'; mrEl.textContent = '0.0%'; }

    const recEl = $('#kpiRecords');
    if (recEl) { recEl.textContent = '0'; }

    const tpEl = $('#kpiThroughput');
    if (tpEl) { tpEl.textContent = '0/s'; }

    const excEl = $('#kpiExceptions');
    if (excEl) { excEl.className = 'kpi-value'; excEl.textContent = '0'; }

    const agEl = $('#kpiAgentCoverage');
    if (agEl) { agEl.className = 'kpi-value warn'; agEl.textContent = '0.0%'; }

    const cashEl = $('#kpiCash');
    if (cashEl) { cashEl.textContent = '₹0'; }

    const cashSub = $('#kpiCashSub');
    if (cashSub) { cashSub.textContent = '30d out · opening ₹0'; }
    return;
  }
  const r = state.reconciliation;
  const f = state.forecast;
  const a = state.agentReport;

  // Match rate
  const mrEl = $('#kpiMatchRate');
  mrEl.className = 'kpi-value ' + (r.matchRate >= 0.78 ? 'pos' : 'warn');
  animateValue(mrEl, 0, r.matchRate * 100, 900, (v) => v.toFixed(1) + '%');

  // Records
  const recEl = $('#kpiRecords');
  animateValue(recEl, 0, r.totalRecords, 700, (v) => Math.round(v).toLocaleString('en-IN'));

  // Throughput
  const tpEl = $('#kpiThroughput');
  animateValue(tpEl, 0, r.throughput, 700, (v) => Math.round(v).toLocaleString('en-IN') + '/s');

  // Exceptions
  const excEl = $('#kpiExceptions');
  excEl.className = 'kpi-value ' + (r.exceptions.length > 20 ? 'warn' : '');
  animateValue(excEl, 0, r.exceptions.length, 700, (v) => Math.round(v));

  // Agent coverage
  const agEl = $('#kpiAgentCoverage');
  agEl.className = 'kpi-value ' + (a.coverageRate >= 0.75 ? 'pos' : 'warn');
  animateValue(agEl, 0, a.coverageRate * 100, 900, (v) => v.toFixed(1) + '%');

  // Cash
  const cashEl = $('#kpiCash');
  const cashTarget = f.days[f.days.length - 1].balance;
  animateValue(cashEl, 0, cashTarget, 900, (v) => '₹' + Math.round(v).toLocaleString('en-IN'));
  $('#kpiCashSub').textContent = '30d out · opening ' + money(f.openingBalance);
}

/* ────────────────── Reconciliation table ────────────────── */
function renderMatchedTable() {
  const tbody  = $('#matchedBody');
  if (!state.reconciliation || !state.reconciliation.matched) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">No matches yet — click "▶ Run Reconciliation" or import CSV to start.</div></td></tr>`;
    return;
  }
  const search = $('#matchSearch').value.trim().toLowerCase();
  let rows     = state.reconciliation.matched.slice();

  if (search) {
    rows = rows.filter((m) =>
      m.bank.txn_id.toLowerCase().includes(search) ||
      m.gl.gl_id.toLowerCase().includes(search) ||
      (m.bank.counterparty || '').toLowerCase().includes(search));
  }

  const { key, dir } = state.sort;
  rows.sort((a, b) => {
    const av = key === 'confidence' ? a.confidence : key === 'amount' ? Math.abs(a.bank.amount) : a.bank.date;
    const bv = key === 'confidence' ? b.confidence : key === 'amount' ? Math.abs(b.bank.amount) : b.bank.date;
    return av > bv ? dir : av < bv ? -dir : 0;
  });

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">No matches found.</div></td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map((m, i) => `
    <tr data-idx="${i}">
      <td>${m.bank.txn_id}</td>
      <td>${m.gl.gl_id}</td>
      <td>${m.bank.date}</td>
      <td>${escapeHtml(m.bank.counterparty || '—')}</td>
      <td class="num">${money(Math.abs(m.bank.amount))}</td>
      <td><span class="pill ${confBand(m.confidence)}">${m.confidence}% · ${m.pass}</span></td>
      <td class="num">${m.bank.currency}</td>
    </tr>
    <tr class="detail-row" id="detail-${i}" style="display:none"><td colspan="7">
      <div class="row-detail">
        Bank: "${escapeHtml(m.bank.description)}" (ref ${m.bank.reference || '—'}) &nbsp;·&nbsp;
        GL: "${escapeHtml(m.gl.narration)}" acct ${m.gl.account_code}, ${m.gl.cost_center} &nbsp;·&nbsp;
        matched on the <b>${m.pass}</b> pass at <b>${m.confidence}%</b> confidence.
      </div>
    </td></tr>
  `).join('');

  $$('tr[data-idx]', tbody).forEach((tr) => {
    tr.addEventListener('click', () => {
      const d = $('#detail-' + tr.dataset.idx);
      d.style.display = d.style.display === 'none' ? '' : 'none';
    });
  });
}

/* ────────────────── Exceptions ────────────────── */
function renderExceptions() {
  const wrap   = $('#exceptionList');
  if (!state.reconciliation || !state.reconciliation.exceptions) {
    $('#exceptionCount').textContent = '0';
    $('#exceptionValue').textContent = '₹0';
    wrap.innerHTML = `<div class="empty-state">No exceptions yet — click "▶ Run Reconciliation" to analyze data.</div>`;
    return;
  }
  const filter = $('#exceptionFilter').value;
  let list     = state.reconciliation.exceptions;
  if (filter !== 'ALL') list = list.filter((e) => e.reasonCode === filter);

  $('#exceptionCount').textContent = list.length;
  $('#exceptionValue').textContent = money(list.reduce((s, e) => s + e.amount, 0));

  if (list.length === 0) {
    wrap.innerHTML = `<div class="empty-state">No exceptions in this category.</div>`;
    return;
  }

  wrap.innerHTML = list.map((e, i) => {
    const id = e.source === 'bank' ? e.record.txn_id
             : e.source === 'gl'   ? e.record.gl_id
             : e.record.invoice_id;
    return `
      <div class="exception-row" data-idx="${i}">
        <span class="code">${e.reasonCode}</span>
        <span class="reason"><b>${id}</b> (${e.source.toUpperCase()}) — ${escapeHtml(e.reason)}</span>
        <span class="amt">${money(e.amount)}</span>
        <span class="action">${escapeHtml(e.suggestedAction)}</span>
      </div>`;
  }).join('');
}

/* ────────────────── Agent Report ────────────────── */
function renderAgentReport() {
  // Show result, hide spinner
  const spinner = $('#agentSpinner');
  const result  = $('#agentResult');
  if (spinner) spinner.style.display = 'none';
  if (result)  result.style.display  = 'flex';

  if (!state.agentReport || !state.reconciliation) {
    $('#agentClosedCount').textContent = '0';
    $('#agentMatchChip').textContent   = '0.0% match rate';
    $('#agentAPChip').textContent      = '0.0% AP settled';
    $('#agentExcChip').textContent     = '0 unresolvable';

    const conf90 = $('#confBar90'); if (conf90) conf90.style.width = '0%';
    const conf70 = $('#confBar70'); if (conf70) conf70.style.width = '0%';
    const conf40 = $('#confBar40'); if (conf40) conf40.style.width = '0%';

    $('#confCount90').textContent = '0';
    $('#confCount70').textContent = '0';
    $('#confCount40').textContent = '0';

    $('#agentMeta').textContent = 'No pipeline run yet. Click "▶ Run Reconciliation" to execute.';

    $('#resolvedCount').textContent = '0';
    $('#resolvedList').innerHTML = `<div class="empty-state">0 items resolved — run reconciliation to analyze.</div>`;

    $('#unresolvableCount').textContent = '0';
    $('#unresolvableList').innerHTML = `<div class="empty-state">0 unresolvable items.</div>`;
    return;
  }
  const a = state.agentReport;
  const r = state.reconciliation;

  // Headline
  $('#agentClosedCount').textContent = a.closedItems;
  $('#agentMatchChip').textContent   = pct(a.matchRate) + ' match rate';
  $('#agentAPChip').textContent      = pct(a.apSettlementRate) + ' AP settled';
  $('#agentExcChip').textContent     = a.unresolvedCount + ' unresolvable';

  // Confidence bars
  const total = r.matched.length || 1;
  const h90 = a.confHistogram['90-100'] || 0;
  const h70 = a.confHistogram['70-89']  || 0;
  const h40 = a.confHistogram['40-69']  || 0;

  setTimeout(() => {
    $('#confBar90').style.width = Math.round((h90 / total) * 100) + '%';
    $('#confBar70').style.width = Math.round((h70 / total) * 100) + '%';
    $('#confBar40').style.width = Math.round((h40 / total) * 100) + '%';
  }, 100);

  $('#confCount90').textContent = h90;
  $('#confCount70').textContent = h70;
  $('#confCount40').textContent = h40;

  $('#agentMeta').textContent =
    `Processed ${a.datasetSummary.total} records (${a.datasetSummary.bank}B · ${a.datasetSummary.gl}G · ${a.datasetSummary.ap}A) · `
    + `${a.elapsedMs}ms · ${a.throughputRps.toLocaleString('en-IN')} rec/s · `
    + `run at ${new Date(a.timestamp).toLocaleTimeString('en-IN')}`;

  // Resolved list
  $('#resolvedCount').textContent = a.resolvedCount;
  const resolvedEl = $('#resolvedList');
  if (a.resolved.length === 0) {
    resolvedEl.innerHTML = `<div class="empty-state">All exceptions escalated.</div>`;
  } else {
    resolvedEl.innerHTML = a.resolved.map((item) => `
      <div class="agent-exc-item resolvable">
        <span class="exc-icon">✓</span>
        <div class="exc-body">
          <span class="exc-id">${escapeHtml(item.id)} <span style="color:var(--ink-faint);font-size:10px;font-weight:400">(${item.source.toUpperCase()} · ${item.reasonCode})</span></span>
          <span class="exc-reason">${escapeHtml(item.reason)}</span>
          <span class="exc-action">${escapeHtml(item.action)}</span>
        </div>
        <span class="exc-amt">${money(item.amount)}</span>
      </div>`).join('');
  }

  // Unresolved list
  $('#unresolvableCount').textContent = a.unresolvedCount;
  const unresolvableEl = $('#unresolvableList');
  if (a.unresolved.length === 0) {
    unresolvableEl.innerHTML = `<div class="empty-state" style="color:var(--emerald)">✓ Agent resolved all exceptions.</div>`;
  } else {
    unresolvableEl.innerHTML = a.unresolved.map((item) => `
      <div class="agent-exc-item unresolvable">
        <span class="exc-icon" style="color:var(--amber)">⚠</span>
        <div class="exc-body">
          <span class="exc-id">${escapeHtml(item.id)} <span style="color:var(--ink-faint);font-size:10px;font-weight:400">(${item.source.toUpperCase()} · ${item.reasonCode})</span></span>
          <span class="exc-reason">${escapeHtml(item.reason)}</span>
          <span class="exc-action" style="color:var(--amber)">${escapeHtml(item.escalationNote)}</span>
        </div>
        <span class="exc-amt" style="color:var(--amber)">${money(item.amount)}</span>
      </div>`).join('');
  }
}

/* ────────────────── Forecast chart ────────────────── */
function renderForecastChart() {
  const canvas = $('#forecastChart');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600, h = 260;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  if (!state.forecast || !state.forecast.days || !state.forecast.days.length) {
    ctx.strokeStyle = 'rgba(74,90,114,.3)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(12, h / 2); ctx.lineTo(w - 12, h / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    $('#forecastMeta').innerHTML =
      `<span><span class="dot" style="background:#A855F7"></span>Opening ₹0</span>
       <span><span class="dot" style="background:#CAEF45"></span>Day 30: ₹0</span>
       <span><span class="dot" style="background:rgba(202,239,69,0.3)"></span>p10–p90 band</span>
       <span style="margin-left:auto">0 open payables · ₹0</span>`;
    return;
  }

  const days    = state.forecast.days;
  const allVals = days.flatMap((d) => [d.p10, d.p90, d.balance]);
  const min     = Math.min(...allVals) * 1.05;
  const max     = Math.max(...allVals) * 1.05;
  const pad     = { l: 12, r: 12, t: 16, b: 24 };
  const plotW   = w - pad.l - pad.r;
  const plotH   = h - pad.t - pad.b;

  const x = (i) => pad.l + (i / (days.length - 1)) * plotW;
  const y = (v) => pad.t + plotH - ((v - min) / (max - min)) * plotH;

  // Zero line
  ctx.strokeStyle = 'rgba(74,90,114,.3)';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, y(0)); ctx.lineTo(w - pad.r, y(0));
  ctx.stroke();
  ctx.setLineDash([]);

  // Confidence band (p10-p90)
  ctx.beginPath();
  days.forEach((d, i) => { const px = x(i), py = y(d.p90); i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); });
  for (let i = days.length - 1; i >= 0; i--) { ctx.lineTo(x(i), y(days[i].p10)); }
  ctx.closePath();
  ctx.fillStyle = 'rgba(202,239,69,0.06)';
  ctx.fill();

  // Balance line — acid yellow-green
  const grad = ctx.createLinearGradient(pad.l, 0, w - pad.r, 0);
  grad.addColorStop(0, '#A855F7');
  grad.addColorStop(0.5, '#CAEF45');
  grad.addColorStop(1, '#4ADE80');

  ctx.beginPath();
  days.forEach((d, i) => { const px = x(i), py = y(d.balance); i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); });
  ctx.strokeStyle = grad;
  ctx.lineWidth   = 2.5;
  ctx.lineJoin    = 'round';
  ctx.stroke();

  // Day dots (every 5th day)
  days.forEach((d, i) => {
    if (i % 5 !== 0 && i !== days.length - 1) return;
    ctx.beginPath();
    ctx.arc(x(i), y(d.balance), i === days.length - 1 ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = i === days.length - 1 ? '#CAEF45' : 'rgba(168,85,247,0.7)';
    ctx.fill();
  });

  const last = days[days.length - 1];
  $('#forecastMeta').innerHTML =
    `<span><span class="dot" style="background:#A855F7"></span>Opening ${money(state.forecast.openingBalance)}</span>
     <span><span class="dot" style="background:#CAEF45"></span>Day 30: ${money(last.balance)}</span>
     <span><span class="dot" style="background:rgba(202,239,69,0.3)"></span>p10–p90 band</span>
     <span style="margin-left:auto">${state.forecast.openPayableCount} open payables · ${money(Math.abs(state.forecast.totalOpenPayables))}</span>`;
}

/* ────────────────── Tax donut ────────────────── */
const TAX_COLORS = {
  'Operating expense (deductible)': '#CAEF45',
  'Revenue / COGS':                 '#4ADE80',
  'Asset (non-deductible)':         '#38BDF8',
  'Capital expenditure':            '#A855F7',
  'Unclassified':                   '#52525B',
};

function renderTaxDonut() {
  const canvas = $('#taxDonut');
  if (!canvas) return;
  const dpr  = window.devicePixelRatio || 1;
  const size = 140;
  canvas.width  = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width  = size + 'px';
  canvas.style.height = size + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, size, size);

  if (!state.tax || !state.tax.categoryTotals) {
    ctx.fillStyle = '#FAFAFA';
    ctx.font = `700 11px 'JetBrains Mono', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('₹0', size / 2, size / 2 - 5);
    ctx.fillStyle = '#52525B';
    ctx.font = `9px 'JetBrains Mono', monospace`;
    ctx.fillText('flagged exposure', size / 2, size / 2 + 9);

    $('#taxLegend').innerHTML = `<div class="empty-state" style="padding:12px;font-size:12px;color:var(--ink-faint)">No tax flags — run reconciliation to analyze.</div>`;
    return;
  }

  const entries = Object.entries(state.tax.categoryTotals).filter(([, v]) => v > 0);
  const total   = entries.reduce((s, [, v]) => s + v, 0);
  const cx = size / 2, cy = size / 2, rOuter = 60, rInner = 38;
  const gap = 0.025; // radians gap between slices
  let angle = -Math.PI / 2;

  entries.forEach(([cat, val]) => {
    const slice = (val / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, angle + gap, angle + slice - gap);
    ctx.arc(cx, cy, rInner, angle + slice - gap, angle + gap, true);
    ctx.closePath();
    ctx.fillStyle = TAX_COLORS[cat] || '#52525B';
    ctx.fill();
    angle += slice;
  });

  // Centre text
  ctx.fillStyle = '#FAFAFA';
  ctx.font = `700 11px 'JetBrains Mono', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(money(state.tax.totalExposure), cx, cy - 5);
  ctx.fillStyle = '#52525B';
  ctx.font = `9px 'JetBrains Mono', monospace`;
  ctx.fillText('flagged exposure', cx, cy + 9);

  $('#taxLegend').innerHTML = entries.map(([cat, val]) => `
    <div class="tax-legend-row">
      <span><span class="swatch" style="background:${TAX_COLORS[cat] || '#4A5A72'}"></span>${cat}</span>
      <span>${money(val)}</span>
    </div>`).join('') +
    state.tax.flagged.slice(0, 7).map((f) =>
      `<div class="tax-flag-row">⚑ ${f.gl_id} — ${f.issues.join(', ')} — ${escapeHtml(f.narration)}</div>`
    ).join('');
}

/* ────────────────── Confidence summary ────────────────── */
function renderConfSummary() {
  if (!state.reconciliation || !state.reconciliation.confHistogram) {
    $('#confSummary').innerHTML = `
      <div class="legend">
        <span><span class="dot" style="background:#CAEF45"></span>90–100%: 0</span>
        <span><span class="dot" style="background:#FBBF24"></span>70–89%: 0</span>
        <span><span class="dot" style="background:#F87171"></span>40–69%: 0</span>
      </div>`;
    return;
  }
  const h = state.reconciliation.confHistogram;
  $('#confSummary').innerHTML = `
    <div class="legend">
      <span><span class="dot" style="background:#CAEF45"></span>90–100%: ${h['90-100']}</span>
      <span><span class="dot" style="background:#FBBF24"></span>70–89%: ${h['70-89']}</span>
      <span><span class="dot" style="background:#F87171"></span>40–69%: ${h['40-69']}</span>
    </div>`;
}

/* ────────────────── Render all ────────────────── */
function renderAll() {
  renderKPIs();
  renderMatchedTable();
  renderExceptions();
  renderAgentReport();
  renderForecastChart();
  renderTaxDonut();
  renderConfSummary();
}

/* ────────────────── Q&A dock ────────────────── */
function qaSend(text) {
  const log = $('#qaLog');
  log.insertAdjacentHTML('beforeend',
    `<div class="qa-msg user"><span class="who">YOU</span>${escapeHtml(text)}</div>`);
  const answer = QAAgent.ask(text, state);
  log.insertAdjacentHTML('beforeend',
    `<div class="qa-msg bot"><span class="who">AGENT</span>${escapeHtml(answer)}</div>`);
  log.scrollTop = log.scrollHeight;
}

/* ════════════════ MULTI-DATASET REGISTRY ════════════════
   Registry: array of dataset result objects.
   Each entry: { id, label, source, reconciliation, agentReport, data }
   ================================================================ */

const datasetRegistry = [];

function registerDataset(id, label, source, data, reconciliation, agentReport) {
  // Replace if same id already exists
  const existing = datasetRegistry.findIndex((d) => d.id === id);
  const entry = { id, label, source, data, reconciliation, agentReport };
  if (existing >= 0) datasetRegistry[existing] = entry;
  else datasetRegistry.push(entry);

  // Update scoreboard badge count
  const badge = $('#scoreBadge');
  if (badge) badge.textContent = datasetRegistry.length;

  renderScoreboard();
}

/* ── Composite score (0–100) ── */
function computeScore(rec, agent) {
  return Math.round(
    (rec.matchRate || 0) * 40 +
    (rec.apSettlementRate || 0) * 25 +
    (agent.coverageRate || 0) * 20 +
    (15 - Math.min((rec.exceptions.length / Math.max(rec.totalRecords, 1)) * 15, 15))
  );
}

const scoreColour = (s) => s >= 80 ? 'var(--acid)' : s >= 60 ? 'var(--amber)' : 'var(--crimson)';

/* ── SVG score ring ── */
function scoreRingHTML(score) {
  const r   = 14, circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const col  = scoreColour(score);
  return `
    <span class="score-ring-wrap">
      <span class="score-ring">
        <svg width="34" height="34" viewBox="0 0 34 34">
          <circle class="score-ring-bg"   cx="17" cy="17" r="${r}"/>
          <circle class="score-ring-fill" cx="17" cy="17" r="${r}"
            stroke="${col}"
            stroke-dasharray="${circ}"
            stroke-dashoffset="${circ - fill}"/>
        </svg>
        <span class="score-ring-val" style="color:${col}">${score}</span>
      </span>
    </span>`;
}

/* ────────────────── Scoreboard render ────────────────── */

/* Mini-KPI helper — avoids repeating the same 3-line block 8 times */
const kpi = (val, label, cls = '') =>
  `<div class="dataset-mini-kpi">
    <span class="dataset-mini-kpi-val ${cls}">${val}</span>
    <span class="dataset-mini-kpi-label">${label}</span>
  </div>`;

function renderScoreboard() {
  const badge = $('#scoreBadge');
  if (badge) badge.textContent = datasetRegistry.length;

  if (!datasetRegistry.length) {
    $('#combinedDatasetCount').textContent = '0 datasets';
    $('#combinedMatchRate').textContent    = '0.0%';
    $('#combinedAPRate').textContent       = '0.0%';
    $('#combinedCoverage').textContent     = '0.0%';
    $('#combinedRecords').textContent      = '0';
    $('#combinedExceptions').textContent   = '0';
    $('#scoreTableBody').innerHTML         = '<tr><td colspan="9"><div class="empty-state">No dataset scores available yet — click "▶ Run Reconciliation" or import CSV to generate scores.</div></td></tr>';
    $('#datasetDetailCards').innerHTML     = '<div class="empty-state" style="padding:24px;text-align:center">No dataset scores calculated yet — click "▶ Run Reconciliation" or import CSV to generate scores.</div>';
    return;
  }

  const n   = datasetRegistry.length;
  const avg = (fn) => datasetRegistry.reduce((s, d) => s + fn(d), 0) / n;
  const sum = (fn) => datasetRegistry.reduce((s, d) => s + fn(d), 0);

  $('#combinedDatasetCount').textContent = n + (n === 1 ? ' dataset' : ' datasets');
  $('#combinedMatchRate').textContent    = pct(avg(d => d.reconciliation.matchRate));
  $('#combinedAPRate').textContent       = pct(avg(d => d.reconciliation.apSettlementRate));
  $('#combinedCoverage').textContent     = pct(avg(d => d.agentReport.coverageRate));
  $('#combinedRecords').textContent      = sum(d => d.reconciliation.totalRecords).toLocaleString('en-IN');
  $('#combinedExceptions').textContent   = sum(d => d.reconciliation.exceptions.length);

  $('#scoreTableBody').innerHTML = datasetRegistry.map((d) => {
    const { reconciliation: r, agentReport: a } = d;
    const score = computeScore(r, a);
    const src = d.source === 'synthetic' ? 'synthetic' : 'imported';
    const col = (v, thr) => v >= thr ? 'var(--acid)' : 'var(--amber)';
    return `<tr>
      <td style="color:var(--ink);font-weight:600">${escapeHtml(d.label)}</td>
      <td><span class="dataset-source-tag ${src}">${d.source}</span></td>
      <td class="num">${r.totalRecords.toLocaleString('en-IN')}</td>
      <td class="num" style="color:${col(r.matchRate, 0.78)}">${pct(r.matchRate)}</td>
      <td class="num" style="color:${col(r.apSettlementRate, 0.80)}">${pct(r.apSettlementRate)}</td>
      <td class="num" style="color:${col(a.coverageRate, 0.75)}">${pct(a.coverageRate)}</td>
      <td class="num" style="color:${r.exceptions.length > 15 ? 'var(--amber)' : 'var(--ink-faint)'}">${r.exceptions.length}</td>
      <td class="num" style="color:var(--ink-faint)">${a.throughputRps.toLocaleString('en-IN')}/s</td>
      <td>${scoreRingHTML(score)}</td>
    </tr>`;
  }).join('');

  $('#datasetDetailCards').innerHTML = datasetRegistry.map((d) => {
    const { reconciliation: r, agentReport: a } = d;
    const score  = computeScore(r, a);
    const src    = d.source === 'synthetic' ? 'synthetic' : 'imported';
    const topExcs = r.exceptions.slice(0, 3).map((e) => {
      const id = e.source === 'bank' ? e.record.txn_id : e.source === 'gl' ? e.record.gl_id : e.record.invoice_id;
      return `• ${id} (${e.reasonCode}) — ${money(e.amount)}`;
    }).join('\n');

    return `
      <div class="dataset-detail-card">
        <div class="dataset-detail-header">
          <div class="dataset-detail-title">${escapeHtml(d.label)}<span class="dataset-source-tag ${src}">${d.source}</span></div>
          ${scoreRingHTML(score)}
        </div>
        <div class="dataset-mini-kpis">
          ${kpi(pct(r.matchRate),           'Match rate',    r.matchRate < 0.78 ? 'warn' : '')}
          ${kpi(pct(r.apSettlementRate),     'AP settled',    r.apSettlementRate < 0.80 ? 'warn' : '')}
          ${kpi(pct(a.coverageRate),         'Agent coverage',a.coverageRate < 0.75 ? 'warn' : '')}
          ${kpi(r.exceptions.length,         'Exceptions',    r.exceptions.length > 15 ? 'warn' : '')}
          ${kpi(r.totalRecords.toLocaleString('en-IN'), 'Records')}
          ${kpi(a.unresolvedCount,           'Unresolvable')}
          ${kpi(r.confHistogram['90-100'],   'Exact matches')}
          ${kpi(a.elapsedMs + 'ms',          'Elapsed')}
        </div>
        ${topExcs ? `<div class="dataset-exc-preview">Top exceptions:\n${escapeHtml(topExcs)}</div>` : ''}
      </div>`;
  }).join('');
}


/* Staging area for files not yet run */
const importStaging = { bank: null, gl: null, ap: null };
const IMPORT_TYPE = {
  bank: { cls: 'bank-icon', label: 'B' },
  gl:   { cls: 'gl-icon',   label: 'G' },
  ap:   { cls: 'ap-icon',   label: 'A' },
};

function renderImportedFilesList() {
  const list  = $('#importedFilesList');
  const runRow = $('#importRunRow');
  const entries = Object.values(importStaging).filter(Boolean);
  $('#importedCount').textContent = entries.length + (entries.length === 1 ? ' file' : ' files');

  if (entries.length === 0) {
    list.innerHTML = '<div class="empty-state">No files imported yet — drag a CSV above or search web to start.</div>';
    runRow.style.display = 'none';
    return;
  }

  list.innerHTML = entries.map((f) => {
    const { cls, label } = IMPORT_TYPE[f.type] || { cls: 'gl-icon', label: '?' };
    const webBadge = f.isWeb ? `<span class="dataset-source-tag web" style="font-size:9px;margin-left:4px">WEB</span>` : '';
    const status = f.warnings.length
      ? `<span style="color:var(--amber);font-size:10px">⚠ ${f.warnings.length} warn</span>`
      : `<span style="color:var(--emerald);font-size:10px">✓ OK</span>`;
    return `<div class="imported-file-row">
      <span class="imported-file-type ${cls}">${label}</span>
      <span class="imported-file-name">${escapeHtml(f.fileName)} ${webBadge}</span>
      <span class="imported-file-rows">${f.rowCount} rows</span>
      <span class="imported-file-status">${status}</span>
      <button class="imported-file-remove" data-type="${f.type}" title="Remove">✕</button>
    </div>`;
  }).join('');

  $$('.imported-file-remove', list).forEach((btn) => {
    btn.addEventListener('click', () => {
      importStaging[btn.dataset.type] = null;
      renderImportedFilesList();
      updateImportLog();
    });
  });

  runRow.style.display = 'flex';
}

function updateImportLog() {
  const allWarnings = Object.values(importStaging)
    .filter(Boolean)
    .flatMap((f) => f.warnings.map((w) => ({ fileName: f.fileName, msg: w })));

  const logCard = $('#importLogCard');
  const log     = $('#importLog');
  const warnCount = $('#importWarnCount');

  warnCount.textContent = allWarnings.length + ' warning' + (allWarnings.length !== 1 ? 's' : '');
  logCard.style.display = allWarnings.length > 0 ? '' : 'none';

  const entries = Object.values(importStaging).filter(Boolean);
  const okLines = entries.map((f) =>
    `<div class="import-log-item ok">✓ ${escapeHtml(f.fileName)} — ${f.type.toUpperCase()} · ${f.rowCount} rows parsed</div>`
  ).join('');
  const warnLines = allWarnings.map((w) =>
    `<div class="import-log-item warn">⚠ ${escapeHtml(w.fileName)}: ${escapeHtml(w.msg)}</div>`
  ).join('');
  log.innerHTML = okLines + warnLines || '<div class="import-log-item">No import activity yet.</div>';
}

async function fetchWebDataset(inputUrlOrQuery) {
  const statusEl = $('#webFetchStatus');
  const btn = $('#webFetchBtn');
  if (!statusEl || !btn) return;
  statusEl.style.display = 'block';
  statusEl.className = 'web-fetch-status';
  statusEl.textContent = '🌐 Searching and connecting to web source…';

  btn.disabled = true;

  try {
    let csvText = '';
    let fileName = '';

    if (inputUrlOrQuery === 'web-sample-bank') {
      csvText = DataImporter.getWebSampleCSV('web-sample-bank');
      fileName = '🌐 Tech_Corp_Bank_Statement_Web.csv';
    } else if (inputUrlOrQuery === 'web-sample-gl') {
      csvText = DataImporter.getWebSampleCSV('web-sample-gl');
      fileName = '🌐 Enterprise_GL_Ledger_Web.csv';
    } else if (inputUrlOrQuery === 'web-sample-ap') {
      csvText = DataImporter.getWebSampleCSV('web-sample-ap');
      fileName = '🌐 Global_Vendors_AP_Invoices_Web.csv';
    } else if (/^https?:\/\//i.test(inputUrlOrQuery.trim())) {
      const url = inputUrlOrQuery.trim();
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP Error ${res.status}: Failed to fetch ${url}`);
      csvText = await res.text();
      fileName = '🌐 ' + (url.split('/').pop().split('?')[0] || 'web_dataset.csv');
    } else {
      const query = inputUrlOrQuery.trim().toLowerCase();
      if (query.includes('gl') || query.includes('ledger') || query.includes('account')) {
        csvText = DataImporter.getWebSampleCSV('web-sample-gl');
        fileName = `🌐 Web_Search_${query.replace(/\s+/g, '_')}_GL.csv`;
      } else if (query.includes('ap') || query.includes('invoice') || query.includes('vendor')) {
        csvText = DataImporter.getWebSampleCSV('web-sample-ap');
        fileName = `🌐 Web_Search_${query.replace(/\s+/g, '_')}_AP.csv`;
      } else {
        csvText = DataImporter.getWebSampleCSV('web-sample-bank');
        fileName = `🌐 Web_Search_${query.replace(/\s+/g, '_')}_Bank.csv`;
      }
    }

    const result = DataImporter.importCSV(csvText, 'WEB');
    importStaging[result.type] = { ...result, fileName, isWeb: true };

    renderImportedFilesList();
    updateImportLog();

    statusEl.className = 'web-fetch-status success';
    statusEl.innerHTML = `✓ <b>Web dataset loaded!</b> ${escapeHtml(fileName)} (${result.rowCount} rows · ${result.type.toUpperCase()}). Click "▶ Run on imported data" below to execute.`;
  } catch (err) {
    statusEl.className = 'web-fetch-status error';
    statusEl.textContent = `✕ Web fetch error: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

function processFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const result = DataImporter.importCSV(e.target.result, 'USR');
      importStaging[result.type] = { ...result, fileName: file.name, isWeb: false };
      renderImportedFilesList();
      updateImportLog();
    } catch (err) {
      const log = $('#importLog');
      $('#importLogCard').style.display = '';
      log.insertAdjacentHTML('afterbegin',
        `<div class="import-log-item err">✕ ${escapeHtml(file.name)}: ${escapeHtml(err.message)}</div>`);
    }
  };
  reader.readAsText(file);
}

function downloadTemplate(type) {
  const csv  = DataImporter.getTemplate(type);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `fineatch-${type}-template.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function runOnImportedData() {
  const staged = Object.values(importStaging).filter(Boolean);
  if (staged.length === 0) return;

  // Build bank / gl / ap arrays; fill missing sources with empty arrays
  const bank = (importStaging.bank?.records || []);
  const gl   = (importStaging.gl?.records   || []);
  const ap   = (importStaging.ap?.records   || []);

  if (bank.length === 0 && gl.length === 0) {
    alert('Import at least a Bank or GL file to run reconciliation.');
    return;
  }

  const btn = $('#runImportBtn');
  btn.disabled = true;
  btn.textContent = 'Running…';

  setTimeout(() => {
    const rec    = reconcile(bank, gl, ap);
    const agent  = FinAgentV1.runBatch(bank, gl, ap, rec);

    const label  = staged.map((f) => f.type.toUpperCase()).join('+') + ' · ' +
                   staged.map((f) => f.fileName).join(', ');

    const hasWeb = staged.some((f) => f.isWeb);
    const srcType = hasWeb ? 'web' : 'imported';

    registerDataset('imported-' + Date.now(), label, srcType, { bank, gl, ap }, rec, agent);

    btn.disabled    = false;
    btn.textContent = '▶ Run on imported data';

    // Switch to scoreboard tab
    $$('.tab-btn').forEach((b) => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
    $$('.tab-panel').forEach((p) => p.classList.remove('active'));
    const sb = $('#tb-scoreboard');
    sb.classList.add('active');
    sb.setAttribute('aria-selected', 'true');
    $('#tab-scoreboard').classList.add('active');
  }, 400);
}

/* ────────────────── Wiring ────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  $('#runBtn').addEventListener('click', runReconciliation);

  $('#matchSearch').addEventListener('input', () => state.reconciliation && renderMatchedTable());

  $$('.ledger-table thead th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      state.sort.dir = state.sort.key === key ? -state.sort.dir : -1;
      state.sort.key = key;
      renderMatchedTable();
    });
  });

  $('#exceptionFilter').addEventListener('change', () => state.reconciliation && renderExceptions());

  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach((b) => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
      $$('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      $('#' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'tab-forecast')   renderForecastChart();
      if (btn.dataset.tab === 'tab-tax')        renderTaxDonut();
      if (btn.dataset.tab === 'tab-scoreboard') renderScoreboard();
    });
  });

  // ── Import panel wiring ──
  const dropzone  = $('#importDropzone');
  const fileInput = $('#importFileInput');

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover',  (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  dropzone.addEventListener('dragleave', ()  => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    Array.from(e.dataTransfer.files).forEach(processFile);
  });

  fileInput.addEventListener('change', () => {
    Array.from(fileInput.files).forEach(processFile);
    fileInput.value = '';
  });

  $('#importBrowseBtn').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });

  $('#dlBankTemplate').addEventListener('click', () => downloadTemplate('bank'));
  $('#dlGLTemplate').addEventListener('click',   () => downloadTemplate('gl'));
  $('#dlAPTemplate').addEventListener('click',   () => downloadTemplate('ap'));

  $('#runImportBtn').addEventListener('click', runOnImportedData);

  // ── Web Fetch wiring ──
  const webForm = $('#webFetchForm');
  if (webForm) {
    webForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = $('#webFetchUrl').value.trim();
      if (val) fetchWebDataset(val);
    });
  }

  $$('.web-pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sampleKey = btn.dataset.url;
      if (sampleKey) fetchWebDataset(sampleKey);
    });
  });

  // ── Q&A ──
  $('#qaToggle').addEventListener('click', () => $('#qaPanel').classList.toggle('open'));
  $('#qaForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#qaInput');
    const text  = input.value.trim();
    if (!text) return;
    qaSend(text);
    input.value = '';
  });
  $$('.qa-suggestions button').forEach((b) => b.addEventListener('click', () => qaSend(b.textContent)));

  window.addEventListener('resize', () => {
    renderForecastChart();
    renderTaxDonut();
  });

  // Initialize zero state on load (scores and data calculate only when user clicks Run)
  $('#seedTag').textContent = '0B · 0G · 0A';
  $('#elapsedLabel').textContent = '0.0s';
  $('#stampRate').textContent = '0.0%';
  renderAll();
  renderScoreboard();

  // How It Works panel toggle
  const hiwBtn   = $('#howItWorksBtn');
  const hiwPanel = $('#howItWorksPanel');
  const hiwClose = $('#howItWorksClose');
  if (hiwBtn && hiwPanel && hiwClose) {
    hiwBtn.addEventListener('click', () => {
      const visible = hiwPanel.style.display !== 'none';
      hiwPanel.style.display = visible ? 'none' : 'block';
      hiwBtn.style.color = visible ? '' : 'var(--acid)';
      hiwBtn.style.borderColor = visible ? '' : 'rgba(202,239,69,.3)';
    });
    hiwClose.addEventListener('click', () => {
      hiwPanel.style.display = 'none';
      hiwBtn.style.color = '';
      hiwBtn.style.borderColor = '';
    });
  }
});

