/* PigProfit AI — multi-farm SaaS frontend, farm records, transparent estimates, CSV/JSON backup. */
(function () {
  'use strict';
  const DB_KEY = 'pigprofit_ai_db_v1';
  const ACTIVE_KEY = 'pigprofit_ai_active_batch_v1';
  const ACTIVE_FARM_KEY = 'pigprofit_ai_active_farm_v1';
  const memoryStore = new Map();
  let storagePersistent = true;
  function storageGet(key) { try { return window.localStorage.getItem(key); } catch (_) { storagePersistent = false; return memoryStore.has(key) ? memoryStore.get(key) : null; } }
  function storageSet(key, value) { try { window.localStorage.setItem(key, String(value)); } catch (_) { storagePersistent = false; memoryStore.set(key, String(value)); } }
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function localDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function id() { return (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : `pp-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function num(v) { if (v === null || v === undefined || v === '') return 0; const n = Number(v); return Number.isFinite(n) ? n : 0; }
  function fmt(v, digits = 1) { return Number.isFinite(Number(v)) ? Number(v).toLocaleString('vi-VN', { maximumFractionDigits: digits }) : '—'; }
  function money(v) { return Number.isFinite(Number(v)) ? `${Math.round(Number(v)).toLocaleString('vi-VN')} ₫` : '—'; }
  function shortMoney(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    if (Math.abs(n) >= 1e9) return `${fmt(n / 1e9, 2)} tỷ`;
    if (Math.abs(n) >= 1e6) return `${fmt(n / 1e6, 1)} tr`;
    if (Math.abs(n) >= 1e3) return `${fmt(n / 1e3, 0)} nghìn`;
    return fmt(n, 0);
  }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function attr(s) { return esc(s).replace(/`/g, '&#96;'); }
  function sum(arr, fieldOrFn) { return arr.reduce((acc, x) => acc + (typeof fieldOrFn === 'function' ? num(fieldOrFn(x)) : num(x[fieldOrFn])), 0); }
  function sorted(items, field = 'date', desc = true) { return [...items].sort((a, b) => (a[field] || '').localeCompare(b[field] || '') * (desc ? -1 : 1)); }

  function blankDB() {
    const now = new Date().toISOString(); const farmId = 'farm-' + (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now()); return { version: 4, settings: { farmName: 'Trang trại của tôi', farms: [{ id: farmId, name: 'Trang trại của tôi', createdAt: now }] }, batches: [], feedTypes: [], logs: [], weighings: [], costs: [], sales: [], pigs: [], createdAt: now, updatedAt: now };
  }
  function loadDB() {
    try {
      const raw = storageGet(DB_KEY);
      if (!raw) return blankDB();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.batches) || !Array.isArray(parsed.logs) || !Array.isArray(parsed.weighings) || !Array.isArray(parsed.costs)) return blankDB();
      parsed.settings = parsed.settings || { farmName: 'Trang trại của tôi' };
      if (!Array.isArray(parsed.settings.farms) || !parsed.settings.farms.length) { const firstFarm = { id: 'farm-' + (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now()), name: parsed.settings.farmName || 'Trang trại của tôi', createdAt: parsed.createdAt || new Date().toISOString() }; parsed.settings.farms = [firstFarm]; parsed.batches.forEach(b => { if (!b.farmId) b.farmId = firstFarm.id; }); }
      else { const validFarmIds = new Set(parsed.settings.farms.map(f => f.id)); parsed.batches.forEach(b => { if (!b.farmId || !validFarmIds.has(b.farmId)) b.farmId = parsed.settings.farms[0].id; }); }
      parsed.settings.farmName = parsed.settings.farmName || parsed.settings.farms[0].name;
      parsed.feedTypes = Array.isArray(parsed.feedTypes) ? parsed.feedTypes : [];
      parsed.sales = Array.isArray(parsed.sales) ? parsed.sales : [];
      parsed.pigs = Array.isArray(parsed.pigs) ? parsed.pigs : [];
      parsed.logs = parsed.logs.map(l => ({ ...l }));
      parsed.version = 4;
      return parsed;
    } catch (e) { console.warn('Could not read PigProfit AI local data:', e); return blankDB(); }
  }
  let db = loadDB();
  let activeTab = 'dashboard';
  let activeFarmId = storageGet(ACTIVE_FARM_KEY) || db.settings.farms?.[0]?.id || '';
  let activeBatchId = storageGet(ACTIVE_KEY) || db.batches.find(b => b.farmId === activeFarmId)?.id || '';
  let backendAvailable = false, serverReady = false, syncRevision = 0, authToken = storageGet('pigprofit_ai_session_v1') || '', userInfo = null, syncTimer = null, syncInFlight = false, syncQueued = false, syncConflict = false, syncErrorShown = false, teamMembers = [], auditEvents = [];
  let passwordResetToken = new URLSearchParams(window.location.search).get('reset_token') || '';
  let readOnlyMode = false;
  let toastTimer = null;
  let costView = { from: '', to: '', category: 'all' };
  let reportView = { batchId: '', from: '', to: '' };
  let pigSearchTerm = '';
  let pigStatusFilter = 'all';
  let dashboardAlertFilter = 'all';
  let qrStream = null;
  let qrScanActive = false;

  function saveDB() {
    db.updatedAt = new Date().toISOString();
    try {
      storageSet(DB_KEY, JSON.stringify(db));
      storageSet(ACTIVE_KEY, activeBatchId || '');
      storageSet(ACTIVE_FARM_KEY, activeFarmId || '');
      if (backendAvailable && serverReady) queueSnapshotSync();
      if (!backendAvailable) $('#saveState').innerHTML = storagePersistent ? '<i></i> Đã lưu trên thiết bị' : '<i style="background:#d1a451"></i> Chỉ lưu tạm trong phiên';
      return true;
    } catch (e) {
      $('#saveState').innerHTML = '<i style="background:#cf766d"></i> Chưa lưu được';
      toast('Không lưu được. Có thể bộ nhớ trình duyệt đã đầy; hãy xuất bản sao lưu và thử lại.', 'error');
      return false;
    }
  }
  function toast(message, type = '') {
    const region = $('#toastRegion');
    while (region.children.length >= 3) region.firstElementChild.remove();
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    region.appendChild(el);
    window.setTimeout(() => el.remove(), 3800);
  }
  function currentFarm() { return (db.settings.farms || []).find(f => f.id === activeFarmId) || (db.settings.farms || [])[0] || { id: '', name: db.settings.farmName || 'Trang trại của tôi' }; }
  function farmNameForBatch(batchId) { const batch = db.batches.find(b => b.id === batchId); return (db.settings.farms || []).find(f => f.id === batch?.farmId)?.name || db.settings.farmName || 'Trang trại của tôi'; }
  function activeBatch() { return db.batches.find(b => b.id === activeBatchId && (!b.farmId || b.farmId === activeFarmId)) || db.batches.find(b => b.farmId === activeFarmId) || null; }
  function logsFor(batchId) { return db.logs.filter(x => x.batchId === batchId); }
  function weightsFor(batchId) { return db.weighings.filter(x => x.batchId === batchId); }
  function costsFor(batchId) { return db.costs.filter(x => x.batchId === batchId); }
  function salesFor(batchId) { return (db.sales || []).filter(x => x.batchId === batchId); }
  function pigsFor(batchId) { return (db.pigs || []).filter(x => x.batchId === batchId); }
  function salesForDate(batchId, date) { return salesFor(batchId).filter(x => x.date === date); }
  function hasSalesTickets(batchId, date) { return salesForDate(batchId, date).length > 0; }
  function ticketSaleCount(batchId, date) { return sum(salesForDate(batchId, date), 'count'); }
  function ticketSaleWeight(batchId, date) { return sum(salesForDate(batchId, date), 'totalWeightKg'); }
  function ticketSaleRevenue(batchId, date) { return sum(salesForDate(batchId, date), x => num(x.totalWeightKg) * num(x.pricePerKg)); }
  function salesCountForLog(log) { return hasSalesTickets(log.batchId, log.date) ? ticketSaleCount(log.batchId, log.date) : num(log.soldCount); }
  function salesWeightForLog(log) { return hasSalesTickets(log.batchId, log.date) ? ticketSaleWeight(log.batchId, log.date) : num(log.soldWeightTotal); }
  function salesRevenueForLog(log) { return hasSalesTickets(log.batchId, log.date) ? ticketSaleRevenue(log.batchId, log.date) : num(log.soldWeightTotal) * num(log.salePricePerKg); }
  function soldCountForBatch(batchId) { return sum(logsFor(batchId), l => hasSalesTickets(batchId,l.date) ? 0 : num(l.soldCount)) + sum(salesFor(batchId), 'count'); }
  function soldWeightForBatch(batchId, startDate='', endDate=localDate()) { return sum(logsFor(batchId).filter(l=>l.date<=endDate&&(!startDate||l.date>=startDate)&&!hasSalesTickets(batchId,l.date)), 'soldWeightTotal') + sum(salesFor(batchId).filter(x=>x.date<=endDate&&(!startDate||x.date>=startDate)), 'totalWeightKg'); }
  function salesRevenueForBatch(batchId, startDate='', endDate=localDate()) { return sum(logsFor(batchId).filter(l=>l.date<=endDate&&(!startDate||l.date>=startDate)&&!hasSalesTickets(batchId,l.date)), l=>num(l.soldWeightTotal)*num(l.salePricePerKg)) + sum(salesFor(batchId).filter(x=>x.date<=endDate&&(!startDate||x.date>=startDate)), x=>num(x.totalWeightKg)*num(x.pricePerKg)); }
  function feedTypeById(feedTypeId) { return db.feedTypes.find(x => x.id === feedTypeId) || null; }
  function priceHistoryFor(type) {
    if (!type) return [];
    const history = Array.isArray(type.priceHistory) ? type.priceHistory : [];
    if (!history.length && num(type.unitPrice) > 0) return [{ effectiveFrom: type.effectiveFrom || '0000-00-00', unitPrice: num(type.unitPrice) }];
    return history.slice().sort((a, b) => (a.effectiveFrom || '').localeCompare(b.effectiveFrom || ''));
  }
  function priceForFeedType(typeOrId, date = localDate()) {
    const type = typeof typeOrId === 'string' ? feedTypeById(typeOrId) : typeOrId;
    const eligible = priceHistoryFor(type).filter(p => (p.effectiveFrom || '0000-00-00') <= date);
    if (!eligible.length) return null;
    return eligible[eligible.length - 1];
  }
  function feedLinesForLog(log) {
    if (Array.isArray(log.feedItems) && log.feedItems.length) return log.feedItems;
    if (num(log.feedKg) > 0 || num(log.feedPricePerKg) > 0) return [{ feedTypeId: null, feedName: 'Cám (dữ liệu cũ/chưa phân loại)', stage: '', brand: '', quantityKg: num(log.feedKg), unitPricePerKg: num(log.feedPricePerKg), legacy: true }];
    return [];
  }
  function feedKgForLog(log) {
    return Array.isArray(log.feedItems) && log.feedItems.length ? sum(log.feedItems, 'quantityKg') : num(log.feedKg);
  }
  function feedCostForLog(log) {
    return Array.isArray(log.feedItems) && log.feedItems.length
      ? sum(log.feedItems, x => num(x.quantityKg) * num(x.unitPricePerKg))
      : num(log.feedKg) * num(log.feedPricePerKg);
  }
  function feedPriceMissingForLog(log) {
    if (Array.isArray(log.feedItems) && log.feedItems.length) return log.feedItems.some(x => num(x.quantityKg) > 0 && !(num(x.unitPricePerKg) > 0));
    return num(log.feedKg) > 0 && !(num(log.feedPricePerKg) > 0);
  }
  function feedSummaryForLog(log) {
    const lines = feedLinesForLog(log);
    if (!lines.length) return '—';
    return lines.map(x => `${x.feedName || 'Cám chưa phân loại'}${x.stage ? ` [${x.stage}]` : ''}: ${fmt(x.quantityKg, 1)} kg @ ${money(num(x.unitPricePerKg))}/kg`).join(' · ');
  }
  function batchName(batchId) { return db.batches.find(b => b.id === batchId)?.name || 'Lứa đã xóa'; }
  function setActiveBatch(idValue) {
    activeBatchId = idValue || '';
    const selected = db.batches.find(b => b.id === activeBatchId); if (selected?.farmId) { activeFarmId = selected.farmId; storageSet(ACTIVE_FARM_KEY, activeFarmId); }
    storageSet(ACTIVE_KEY, activeBatchId);
    syncContext();
    render();
  }
  function syncContext() {
    const farmSelect = $('#activeFarm');
    const farms = Array.isArray(db.settings.farms) ? db.settings.farms : [];
    if (!farms.some(f => f.id === activeFarmId)) activeFarmId = farms[0]?.id || '';
    if (farmSelect) farmSelect.innerHTML = farms.length ? farms.map(f => `<option value="${attr(f.id)}" ${f.id === activeFarmId ? 'selected' : ''}>${esc(f.name)}</option>`).join('') : '<option value="">Chưa có trang trại</option>';
    $('#farmTitle').textContent = currentFarm().name || db.settings.farmName || 'Trang trại của tôi';
    const select = $('#activeBatch');
    const options = db.batches.filter(b => !b.farmId || b.farmId === activeFarmId).slice().sort((a, b) => (b.status === 'active') - (a.status === 'active') || (a.name || '').localeCompare(b.name || ''));
    if (!options.some(b => b.id === activeBatchId)) activeBatchId = options[0]?.id || '';
    select.innerHTML = options.length ? options.map(b => `<option value="${attr(b.id)}" ${b.id === activeBatchId ? 'selected' : ''}>${esc(b.name)}${b.status === 'closed' ? ' · Đã kết thúc' : ''}</option>`).join('') : '<option value="">Chưa có lứa nuôi tại trại này</option>';
    storageSet(ACTIVE_FARM_KEY, activeFarmId || ''); storageSet(ACTIVE_KEY, activeBatchId || '');
    const status = $('#saveState'); if (status) { if (backendAvailable && serverReady) status.innerHTML = syncConflict ? '<i style="background:#d1a451"></i> Xung đột đồng bộ' : '<i></i> Đã đồng bộ máy chủ'; else if (backendAvailable) status.innerHTML = '<i style="background:#d1a451"></i> Chưa đăng nhập'; else status.innerHTML = storagePersistent ? '<i></i> Đã lưu trên thiết bị' : '<i style="background:#d1a451"></i> Chỉ lưu tạm trong phiên'; }
    const userLabel = $('#accountUser'); if (userLabel) userLabel.textContent = userInfo ? `${userInfo.name} · ${userInfo.role}` : 'Tài khoản';
    const accountControls = $('#accountControls'); if (accountControls) accountControls.hidden = !backendAvailable || !userInfo;
    const syncButton=$('#syncNow'); if(syncButton){syncButton.title=syncConflict?'Tải lại dữ liệu từ máy chủ': 'Đồng bộ dữ liệu';syncButton.setAttribute('aria-label',syncButton.title);}
  }

  function observationFor(batch) {
    if (!batch) return null;
    const observations = [];
    weightsFor(batch.id).filter(w => w.date <= localDate() && (!batch.startDate || w.date >= batch.startDate) && num(w.avgWeight) > 0).forEach(w => observations.push({ date: w.date, avgWeight: num(w.avgWeight), source: w.method || 'sample', sampleCount: num(w.sampleCount), notes: w.notes || '', origin: 'weighing' }));
    logsFor(batch.id).filter(l => l.date <= localDate() && (!batch.startDate || l.date >= batch.startDate) && num(l.estimatedAvgWeight) > 0).forEach(l => observations.push({ date: l.date, avgWeight: num(l.estimatedAvgWeight), source: 'estimate', sampleCount: 0, notes: l.notes || '', origin: 'daily' }));
    return sorted(observations, 'date', true)[0] || null;
  }
  function eventWeights(batch, l, fallbackAvg = 0) {
    const sameLogAvg = num(l.estimatedAvgWeight) || num(fallbackAvg) || (observationFor(batch)?.avgWeight || 0);
    const deadWeight = num(l.deadCount) * (num(l.deadAvgWeight) || sameLogAvg);
    const cullWeight = num(l.cullWeightTotal) || (num(l.cullCount) * sameLogAvg);
    const transferWeight = num(l.transferOutWeightTotal) || (num(l.transferOutCount) * sameLogAvg);
    return { deadWeight, cullWeight, transferWeight, estimated: (num(l.deadCount) > 0 && !num(l.deadAvgWeight)) || (num(l.cullCount) > 0 && !num(l.cullWeightTotal)) || (num(l.transferOutCount) > 0 && !num(l.transferOutWeightTotal)) };
  }
  function logsAfterStart(batch) { return logsFor(batch.id).filter(l => !batch.startDate || l.date >= batch.startDate); }
  function countAt(batch, date = localDate()) {
    const ls = logsAfterStart(batch).filter(l => l.date <= date);
    const legacySales = sum(ls, l => hasSalesTickets(batch.id,l.date) ? 0 : num(l.soldCount));
    const ticketSales = sum(salesFor(batch.id).filter(x => (!batch.startDate || x.date >= batch.startDate) && x.date <= date), 'count');
    return num(batch.initialCount) + sum(ls, 'addedCount') - sum(ls, 'deadCount') - sum(ls, 'cullCount') - legacySales - ticketSales - sum(ls, 'transferOutCount');
  }
  function missingProfitReason(x) {
    if (x.countNegative) return 'Số heo đang âm; cần kiểm tra cân đối đàn';
    if (x.missingWeight || x.inventoryValue === null) return 'Thiếu trọng lượng hoặc giá heo hơi để định giá đàn tồn';
    if (!num(x.batch.initialPurchaseCost)) return 'Thiếu vốn mua heo ban đầu';
    if (x.feedMissingPrice) return 'Thiếu giá cám ở một hoặc nhiều ngày';
    if (x.unpricedSales) return 'Có heo bán nhưng thiếu kg bán hoặc giá bán';
    if (x.uncostedAdditions) return 'Có heo nhập thêm nhưng chưa có giá vốn/giá trị chuyển vào';
    return '';
  }
  function allBatchMetrics(batch) {
    if (!batch) return null;
    const logs = logsAfterStart(batch).filter(l => l.date <= localDate()).sort((a, b) => a.date.localeCompare(b.date));
    const currentCount = countAt(batch);
    const observation = observationFor(batch);
    const avgWeight = observation?.avgWeight || 0;
    const biomass = Math.max(0, currentCount) * avgWeight;
    const initialBiomass = num(batch.initialCount) * num(batch.initialAvgWeight);
    const feedKg = sum(logs, feedKgForLog);
    const feedCost = sum(logs, feedCostForLog);
    const soldWeight = soldWeightForBatch(batch.id, batch.startDate || '', localDate());
    const addedWeight = sum(logs, 'addedWeightTotal');
    let mortalityWeight = 0, cullWeight = 0, transferWeight = 0, eventWeightEstimated = false;
    logs.forEach(l => { const ew = eventWeights(batch, l, avgWeight); mortalityWeight += ew.deadWeight; cullWeight += ew.cullWeight; transferWeight += ew.transferWeight; eventWeightEstimated ||= ew.estimated; });
    const gain = biomass + soldWeight + mortalityWeight + cullWeight + transferWeight - initialBiomass - addedWeight;
    // FCR is calculated for the latest usable weight interval, not blindly from the batch's entire history.
    // If this is an older active batch, a recent explicit weighing can establish a new baseline.
    const explicitWeighings = sorted(weightsFor(batch.id).filter(w => w.date >= (batch.startDate || '0000-00-00') && w.date <= localDate() && num(w.avgWeight) > 0), 'date', false);
    let fcrStartObservation = null;
    let fcrEndObservation = observation;
    if (fcrEndObservation) {
      const priorExplicit = explicitWeighings.filter(w => w.date < fcrEndObservation.date);
      const prior = priorExplicit[priorExplicit.length - 1];
      if (prior) {
        fcrStartObservation = { date: prior.date, avgWeight: num(prior.avgWeight), source: prior.method || 'sample', origin: 'weighing', isInitial: false };
      } else {
        fcrStartObservation = { date: batch.startDate, avgWeight: num(batch.initialAvgWeight), source: 'initial', origin: 'batch', isInitial: true };
      }
      // If the only explicit weighing was on day one and the endpoint is a later estimate, use it as baseline.
      if (fcrEndObservation.date <= fcrStartObservation.date && explicitWeighings.length === 1 && observation?.origin === 'weighing') {
        fcrStartObservation = { date: batch.startDate, avgWeight: num(batch.initialAvgWeight), source: 'initial', origin: 'batch', isInitial: true };
      }
    }
    const fcrStartDate = fcrStartObservation?.date || '';
    const fcrEndDate = fcrEndObservation?.date || '';
    const fcrStartCount = !fcrStartObservation ? 0 : fcrStartObservation.isInitial ? num(batch.initialCount) : countAt(batch, fcrStartDate);
    const fcrStartBiomass = fcrStartCount * num(fcrStartObservation?.avgWeight);
    const fcrEndCount = fcrEndObservation ? countAt(batch, fcrEndDate) : 0;
    const fcrEndBiomass = fcrEndObservation ? Math.max(0, fcrEndCount) * num(fcrEndObservation.avgWeight) : 0;
    const fcrLogs = fcrStartObservation && fcrEndObservation && fcrEndDate > fcrStartDate
      ? logs.filter(l => (fcrStartObservation.isInitial ? l.date >= fcrStartDate : l.date > fcrStartDate) && l.date <= fcrEndDate)
      : [];
    const fcrFeedKg = sum(fcrLogs, feedKgForLog);
    const fcrFeedCost = sum(fcrLogs, feedCostForLog);
    const fcrMissingFeedPrice = fcrLogs.some(feedPriceMissingForLog);
    let fcrMortalityWeight = 0, fcrCullWeight = 0, fcrTransferWeight = 0, fcrEventsEstimated = false;
    fcrLogs.forEach(l => { const ew = eventWeights(batch, l, num(fcrEndObservation?.avgWeight)); fcrMortalityWeight += ew.deadWeight; fcrCullWeight += ew.cullWeight; fcrTransferWeight += ew.transferWeight; fcrEventsEstimated ||= ew.estimated; });
    const fcrSoldWeight = soldWeightForBatch(batch.id, fcrStartDate, fcrEndDate);
    const fcrAddedWeight = sum(fcrLogs, 'addedWeightTotal');
    const fcrGain = fcrEndBiomass + fcrSoldWeight + fcrMortalityWeight + fcrCullWeight + fcrTransferWeight - fcrStartBiomass - fcrAddedWeight;
    const fcrElapsedDays = fcrStartObservation && fcrEndObservation ? Math.max(0, (new Date(`${fcrEndDate}T12:00:00`) - new Date(`${fcrStartDate}T12:00:00`)) / 86400000) : 0;
    const avgHeadsInPeriod = fcrStartObservation && fcrEndObservation ? (Math.max(0, fcrStartCount) + Math.max(0, fcrEndCount)) / 2 : 0;
    const averageDailyGain = fcrElapsedDays > 0 && avgHeadsInPeriod > 0 ? fcrGain / (fcrElapsedDays * avgHeadsInPeriod) : null;
    const fcrGrowthAnomaly = averageDailyGain !== null && averageDailyGain > 1.5;
    let fcrMissingDays = 0;
    if (fcrStartObservation && fcrEndObservation && fcrEndDate > fcrStartDate) {
      const recordedDates = new Set(fcrLogs.filter(l => l.feedRecorded === true || feedKgForLog(l) > 0 || (Array.isArray(l.feedItems) && l.feedItems.length > 0)).map(l => l.date));
      const d = new Date(`${fcrStartDate}T12:00:00`);
      if (!fcrStartObservation.isInitial) d.setDate(d.getDate() + 1);
      const end = new Date(`${fcrEndDate}T12:00:00`);
      while (d <= end) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (!recordedDates.has(key)) fcrMissingDays++;
        d.setDate(d.getDate() + 1);
      }
    }
    const fcr = fcrGain > 0 && fcrFeedKg > 0 && fcrElapsedDays > 0 && fcrMissingDays === 0 && fcrEndCount >= 0 && !fcrGrowthAnomaly ? fcrFeedKg / fcrGain : null;
    const salesRevenue = salesRevenueForBatch(batch.id, batch.startDate || '', localDate());
    const cullRevenue = sum(logs, 'cullRevenue');
    const applicableCosts = costsFor(batch.id).filter(c => (!batch.startDate || c.date >= batch.startDate) && c.date <= localDate());
    const otherCosts = sum(applicableCosts, 'amount');
    const addedPigCosts = sum(logs, 'addedCost');
    const totalCosts = num(batch.initialPurchaseCost) + addedPigCosts + feedCost + otherCosts;
    const marketPrice = num(batch.marketPrice) || 0;
    const inventoryValue = currentCount >= 0 && avgWeight > 0 && marketPrice > 0 ? Math.max(0, currentCount) * avgWeight * marketPrice : null;
    const daily = logs.slice().sort((a, b) => b.date.localeCompare(a.date));
    const countNegative = currentCount < 0;
    const feedMissingPrice = logs.some(feedPriceMissingForLog);
    const unpricedLegacySales = logs.some(l => !hasSalesTickets(l.batchId,l.date) && num(l.soldCount) > 0 && (!(num(l.soldWeightTotal) > 0) || !(num(l.salePricePerKg) > 0)));
    const unpricedTicketSales = salesFor(batch.id).some(x => x.date <= localDate() && (!batch.startDate || x.date >= batch.startDate) && num(x.count)>0 && (!(num(x.totalWeightKg)>0) || !(num(x.pricePerKg)>0)));
    const unpricedSales = unpricedLegacySales || unpricedTicketSales;
    const uncostedAdditions = logs.some(l => num(l.addedCount) > 0 && !(num(l.addedCost) > 0));
    const missingWeight = !observation || avgWeight <= 0;
    const missingMarket = marketPrice <= 0;
    const missingPigCost = num(batch.initialPurchaseCost) <= 0;
    const profitIncompleteReason = missingProfitReason({ inventoryValue, batch, feedMissingPrice, unpricedSales, uncostedAdditions, countNegative, missingWeight });
    const profit = profitIncompleteReason ? null : salesRevenue + cullRevenue + inventoryValue - totalCosts;
    const weightAgeDays = observation ? Math.max(0, Math.floor((new Date(`${localDate()}T12:00:00`) - new Date(`${observation.date}T12:00:00`)) / 86400000)) : null;
    const weightStale = weightAgeDays !== null && weightAgeDays > 7;
    const feedCostPerKgGain = fcr !== null && !fcrMissingFeedPrice && fcrGain > 0 ? fcrFeedCost / fcrGain : null;
    const profitPerKgLiveweight = profit !== null && biomass > 0 ? profit / biomass : null;
    return { batch, logs, currentCount, observation, avgWeight, biomass, initialBiomass, feedKg, feedCost, soldWeight, addedWeight, mortalityWeight, cullWeight, transferWeight, eventWeightEstimated, gain, fcr, fcrGain, fcrFeedKg, fcrFeedCost, fcrMissingFeedPrice, feedCostPerKgGain, profitPerKgLiveweight, fcrMissingDays, fcrEventsEstimated, fcrStartObservation, fcrEndObservation, fcrElapsedDays, fcrStartDate, fcrEndDate, averageDailyGain, fcrGrowthAnomaly, weightAgeDays, weightStale, salesRevenue, cullRevenue, otherCosts, addedPigCosts, totalCosts, inventoryValue, profit, profitIncompleteReason, daily, countNegative, feedMissingPrice, unpricedSales, uncostedAdditions, missingWeight, missingMarket, missingPigCost };
  }
  function typeLabel(source) { return ({ actual: 'Cân thực tế', sample: 'Cân mẫu', estimate: 'Ước tính' })[source] || source || 'Chưa có'; }
  function statusTag(text, kind = 'gray') { return `<span class="tag tag-${kind}">${esc(text)}</span>`; }
  function pageHead(title, subtitle, actions = '') { return `<div class="page-head"><div><div class="eyebrow">PIGPROFIT AI / ${esc(title)}</div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="head-actions">${actions}</div></div>`; }
  function noBatchBlock() {
    return `<section class="card empty-dashboard"><div class="illustration">🐖</div><div class="eyebrow">BẮT ĐẦU TỪ DỮ LIỆU THẬT</div><h2>Tạo lứa nuôi đầu tiên</h2><p>Hãy khai báo số heo đầu lứa, khối lượng đầu vào và giá mua. Sau đó PigProfit AI sẽ nối nhật ký thức ăn, biến động đàn, cân heo và chi phí để tính các chỉ số.</p><button class="btn btn-primary" data-go="settings">＋ Tạo lứa nuôi</button><div class="empty-steps"><div class="empty-step"><span>1</span><strong>Khai báo đàn</strong><small>Số con, ngày bắt đầu và vốn heo ban đầu.</small></div><div class="empty-step"><span>2</span><strong>Ghi hằng ngày</strong><small>Cám tiêu thụ, chết/loại/bán và các phát sinh.</small></div><div class="empty-step"><span>3</span><strong>Cân định kỳ</strong><small>Dùng trọng lượng để nâng độ tin cậy FCR.</small></div></div><div class="footnote">Ứng dụng không tự tạo số liệu trang trại. Chỉ số được tính sau khi bạn nhập dữ liệu thực tế.</div></section>`;
  }

  function renderDashboard() {
    const b = activeBatch();
    if (!b) return noBatchBlock();
    const m = allBatchMetrics(b);
    const lastLog = m.daily[0];
    const fcrLabel = m.fcr === null ? 'Chưa đủ dữ liệu' : fmt(m.fcr, 2);
    const valueText = m.inventoryValue === null ? 'Chưa đủ dữ liệu' : money(m.inventoryValue);
    const profitText = m.profit === null ? 'Chưa đủ dữ liệu' : `${m.profit < 0 ? '−' : ''}${money(Math.abs(m.profit))}`;
    const profitFoot = m.profit === null ? (m.profitIncompleteReason || 'Cần hoàn thiện dữ liệu') : 'Có tính giá trị đàn tồn cuối kỳ';
    const latestWeightTag = m.observation ? statusTag(typeLabel(m.observation.source), m.observation.source === 'actual' ? 'green' : 'amber') : statusTag('Chưa ghi cân', 'gray');
    const alerts = [];
    if (!m.observation) alerts.push(['pending', 'Chưa có dữ liệu trọng lượng', 'Nhập lần cân hoặc trọng lượng ước tính để ước tính sinh khối.']);
    else if (m.observation.source !== 'actual') alerts.push(['pending', 'Trọng lượng chưa phải cân toàn đàn thực tế', 'Sinh khối và FCR hiện là ước tính; cân mẫu/cân kiểm tra giúp giảm sai số.']);
    if (m.weightStale) alerts.push(['pending', `Trọng lượng gần nhất đã cách ${m.weightAgeDays} ngày`, 'Giá trị đàn hiện tại đang dùng trọng lượng cũ; hãy cân lại để cập nhật sinh khối.']);
    if (m.countNegative) alerts.push(['error', 'Cân đối đàn đang âm', 'Kiểm tra số con đầu lứa và sự kiện chết, loại, bán, chuyển đàn.']);
    if (m.feedMissingPrice) alerts.push(['pending', 'Thiếu giá cám ở một số ngày', 'Chi phí thức ăn chưa đầy đủ cho các ngày đó.']);
    if (m.missingPigCost) alerts.push(['pending', 'Chưa nhập vốn mua heo ban đầu', 'Chưa thể tính chỉ tiêu lãi/lỗ kinh tế.']);
    if (m.missingMarket) alerts.push(['pending', 'Chưa có giá heo hơi tham chiếu', 'Nhập giá tham chiếu để định giá đàn tồn cuối kỳ.']);
    if (m.unpricedSales) alerts.push(['pending', 'Có heo bán thiếu khối lượng hoặc giá bán', 'Bổ sung kg bán và giá bán để doanh thu/lãi lỗ không bị thiếu.']);
    if (m.uncostedAdditions) alerts.push(['pending', 'Có heo nhập thêm thiếu giá vốn', 'Bổ sung giá vốn hoặc giá trị chuyển vào trong nhật ký.']);
    if (m.eventWeightEstimated) alerts.push(['pending', 'Có khối lượng biến động đàn đang được ước tính', 'Bổ sung cân nặng lúc chết/loại/chuyển đi nếu có để cải thiện FCR.']);
    if (m.fcrMissingDays > 0) alerts.push(['pending', `Thiếu nhật ký ${m.fcrMissingDays} ngày trong kỳ FCR`, `Ghi thức ăn mỗi ngày trong kỳ ${m.fcrStartDate} đến ${m.fcrEndDate}; sau lần cân gần nhất, có thể cần thêm mốc cân để hoàn thiện kỳ mới.`]);
    if (m.fcrGrowthAnomaly) alerts.push(['error', 'Tăng trọng bình quân ngày cao bất thường', `Ước tính đang là ${fmt(m.averageDailyGain, 2)} kg/con/ngày. Kiểm tra khối lượng, số heo đầu/cuối kỳ, ngày cân và biến động đàn; FCR tạm ẩn để tránh hiểu sai.`]);
    if (!alerts.length) alerts.push(['ok', 'Dữ liệu cơ bản đã có', 'Tiếp tục cập nhật hằng ngày và cân định kỳ để theo dõi xu hướng.']);
    const attentionAlerts = alerts.filter(a => a[0] === 'pending' || a[0] === 'error');
    const infoAlerts = alerts.filter(a => a[0] === 'ok');
    const visibleAlerts = dashboardAlertFilter === 'attention' ? attentionAlerts : dashboardAlertFilter === 'info' ? infoAlerts : alerts;
    const last7 = [];
    const byDate = new Map(m.logs.map(l => [l.date, l]));
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      last7.push({ date: key, feed: byDate.has(key) ? num(byDate.get(key).feedKg) : 0 });
    }
    const maxFeed = Math.max(...last7.map(x => x.feed), 1);
    const bars = last7.map(x => `<div class="bar-group"><div class="bar ${x.feed ? '' : 'zero'}" style="height:${Math.max(x.feed ? 5 : 2, x.feed / maxFeed * 100)}%" title="${esc(x.date)}: ${fmt(x.feed, 1)} kg"></div><div class="bar-label">${esc(x.date.slice(8))}</div></div>`).join('');
    const recentRows = m.daily.slice(0, 5).map(l => {
      const ev = num(l.deadCount) + num(l.cullCount) + num(salesCountForLog(l)) + num(l.transferOutCount);
      const out = ev ? `−${fmt(ev, 0)}` : '—';
      const feedCost = feedCostForLog(l);
      return `<tr><td><div class="table-primary">${esc(l.date)}</div><div class="table-muted">${esc((l.notes || '').slice(0, 46))}</div></td><td class="num">${fmt(l.feedKg, 1)} kg</td><td class="num">${out}</td><td class="num">${feedCost > 0 ? money(feedCost) : '—'}</td><td><button class="btn btn-small" data-edit-log="${attr(l.id)}">Sửa</button></td></tr>`;
    }).join('');
    return `${pageHead('Tổng quan', `${b.name} · Cập nhật gần nhất: ${lastLog ? lastLog.date : 'chưa có nhật ký'}`, `<button class="btn" data-go="reports">Xem báo cáo ↗</button><button class="btn btn-primary" data-go="daily">＋ Nhập nhật ký</button>`)}
      ${m.countNegative || m.feedMissingPrice || m.missingWeight || m.missingPigCost || m.missingMarket || m.unpricedSales || m.uncostedAdditions ? `<div class="notice"><div>⚑</div><div><strong>Một số chỉ số hiện chưa đủ điều kiện để kết luận</strong>Hãy xử lý các cảnh báo dữ liệu bên dưới. PigProfit AI không thay số liệu thiếu bằng kết quả có vẻ chính xác.</div></div>` : ''}
      <div class="grid kpi-grid">
        <div class="card kpi"><div class="kpi-top"><span>ĐÀN CÒN LẠI (ước tính từ nhật ký)</span><span class="kpi-icon">🐖</span></div><div class="kpi-value">${m.countNegative ? 'Lỗi' : fmt(m.currentCount, 0)} <span class="unit">con</span></div><div class="kpi-foot ${m.countNegative ? 'warn' : ''}">${fmt(sum(m.logs, 'deadCount'), 0)} chết · ${fmt(soldCountForBatch(b.id), 0)} đã bán</div></div>
        <div class="card kpi"><div class="kpi-top"><span>TRỌNG LƯỢNG BÌNH QUÂN GẦN NHẤT</span><span class="kpi-icon">⚖</span></div><div class="kpi-value">${m.avgWeight ? fmt(m.avgWeight, 1) : '—'} <span class="unit">kg/con</span></div><div class="kpi-foot">${m.observation ? `${esc(m.observation.date)} · ${latestWeightTag}` : 'Cần nhập lần cân đầu tiên'}</div></div>
        <div class="card kpi"><div class="kpi-top"><span>THỨC ĂN TÍCH LŨY</span><span class="kpi-icon">🌾</span></div><div class="kpi-value">${fmt(m.feedKg, 0)} <span class="unit">kg</span></div><div class="kpi-foot">Chi phí đã tính: ${money(m.feedCost)}</div></div>
        <div class="card kpi"><div class="kpi-top"><span>FCR KỲ GẦN NHẤT</span><span class="kpi-icon">↗</span></div><div class="kpi-value">${fcrLabel}</div><div class="kpi-foot ${m.fcr === null ? 'warn' : m.observation?.source === 'actual' ? 'good' : 'warn'}">${m.fcr === null ? (m.fcrGrowthAnomaly ? 'Tăng trọng/ngày bất thường — kiểm tra dữ liệu' : m.fcrMissingDays > 0 ? `Thiếu nhật ký ${m.fcrMissingDays} ngày trong kỳ` : !m.fcrEndDate || m.fcrElapsedDays <= 0 ? 'Cần hai mốc trọng lượng ở hai ngày khác nhau' : 'Cần tăng trọng ròng dương và nhật ký thức ăn đầy đủ') : `${m.fcrStartDate} → ${m.fcrEndDate} · ${m.fcrEndObservation?.source === 'actual' ? 'Cân thực tế' : 'Ước tính/cân mẫu'}`}</div></div>
        <div class="card kpi"><div class="kpi-top"><span>GIÁ TRỊ ĐÀN TỒN</span><span class="kpi-icon">₫</span></div><div class="kpi-value">${valueText}</div><div class="kpi-foot">${m.inventoryValue === null ? 'Cần số con, trọng lượng và giá heo hơi' : `${shortMoney(m.biomass)} kg sinh khối ước tính`}</div></div>
        <div class="card kpi"><div class="kpi-top"><span>LÃI/LỖ KINH TẾ ƯỚC TÍNH</span><span class="kpi-icon">◈</span></div><div class="kpi-value ${m.profit === null ? '' : m.profit >= 0 ? 'profit-positive' : 'profit-negative'}">${profitText}</div><div class="kpi-foot ${m.profit === null ? 'warn' : ''}">${profitFoot}</div></div>
        <div class="card kpi"><div class="kpi-top"><span>CHI PHÍ CÁM / KG TĂNG TRỌNG</span><span class="kpi-icon">🌾</span></div><div class="kpi-value">${m.feedCostPerKgGain === null ? 'Chưa tính được' : `${money(m.feedCostPerKgGain)} <span class="unit">/kg tăng trọng</span>`}</div><div class="kpi-foot ${m.feedCostPerKgGain === null ? 'warn' : ''}">${m.fcrMissingFeedPrice ? 'Thiếu giá cám trong kỳ FCR' : m.fcr === null ? 'Cần FCR hợp lệ và giá cám' : 'Chỉ tính chi phí thức ăn, chưa gồm chi phí khác'}</div></div>
        <div class="card kpi"><div class="kpi-top"><span>LÃI/LỖ / KG SINH KHỐI ĐÀN CÒN</span><span class="kpi-icon">₫</span></div><div class="kpi-value ${m.profitPerKgLiveweight === null ? '' : m.profitPerKgLiveweight >= 0 ? 'profit-positive' : 'profit-negative'}">${m.profitPerKgLiveweight === null ? 'Chưa đủ dữ liệu' : `${money(m.profitPerKgLiveweight)} <span class="unit">/kg heo hơi</span>`}</div><div class="kpi-foot">Phân bổ lãi/lỗ toàn lứa trên sinh khối còn lại; không phải biên lãi riêng cho heo đã bán.</div></div>
      </div>
      <div class="grid content-grid">
        <section class="card"><div class="card-heading"><div><h2>Tiêu thụ thức ăn · 7 ngày gần đây</h2><p>Chỉ hiển thị ngày đã có nhật ký; ngày không ghi nhận được biểu diễn là 0.</p></div><span class="tag tag-gray">kg/ngày</span></div><div class="chart-bars">${bars}</div><div class="chart-caption"><span>7 ngày trước</span><span>Hôm nay</span></div><div class="split-numbers"><div class="split-box"><span>Thức ăn trung bình/ngày đã ghi</span><strong>${m.logs.length ? fmt(m.feedKg / m.logs.length, 1) : '—'} kg</strong></div><div class="split-box"><span>Chi phí thức ăn tích lũy</span><strong>${shortMoney(m.feedCost)} ₫</strong></div></div></section>
        <section class="card"><div class="card-heading"><div><h2>Cảnh báo & chất lượng dữ liệu</h2><p>Giải quyết cảnh báo trước khi ra quyết định.</p></div><span class="tag ${attentionAlerts.length ? 'tag-amber' : 'tag-green'}">${attentionAlerts.length} cần chú ý</span></div><div class="alert-filter-tabs" role="group" aria-label="Lọc cảnh báo"><button type="button" class="${dashboardAlertFilter === 'all' ? 'selected' : ''}" data-alert-filter="all">Tất cả (${alerts.length})</button><button type="button" class="${dashboardAlertFilter === 'attention' ? 'selected' : ''}" data-alert-filter="attention">Cần chú ý (${attentionAlerts.length})</button><button type="button" class="${dashboardAlertFilter === 'info' ? 'selected' : ''}" data-alert-filter="info">Thông tin (${infoAlerts.length})</button></div><div>${visibleAlerts.length ? visibleAlerts.map(a => `<div class="check-item"><span class="check-icon ${a[0] === 'ok' ? '' : 'pending'}">${a[0] === 'ok' ? '✓' : '!'}</span><div><strong>${esc(a[1])}</strong><small>${esc(a[2])}</small></div></div>`).join('') : '<div class="empty"><p>Không có cảnh báo thuộc bộ lọc này.</p></div>'}</div><div class="footnote">FCR và lãi/lỗ là chỉ số quản trị. Khi dữ liệu cân hoặc sự kiện đàn ước tính, kết quả cũng mang tính ước tính.</div></section>
      </div>
      <section class="card"><div class="card-heading"><div><h2>Nhật ký gần đây</h2><p>Nhập đầy đủ mỗi ngày để dữ liệu chi phí và cân đối đàn không bị đứt quãng.</p></div><button class="btn btn-small" data-go="daily">Mở nhật ký →</button></div>${recentRows ? `<div class="table-wrap"><table><thead><tr><th>NGÀY</th><th class="num">THỨC ĂN</th><th class="num">BIẾN ĐỘNG</th><th class="num">CHI PHÍ CÁM</th><th></th></tr></thead><tbody>${recentRows}</tbody></table></div>` : `<div class="empty"><div class="empty-icon">▤</div><h3>Chưa có nhật ký nào</h3><p>Bắt đầu ghi lượng cám tiêu thụ, biến động đàn và trọng lượng ước tính trong ngày.</p><button class="btn btn-primary" data-go="daily">＋ Tạo nhật ký đầu tiên</button></div>`}</section>`;
  }

  function renderFeedLine(line = {}, date = localDate(), index = 0) {
    const selectedId = line.legacy ? '__legacy__' : (line.feedTypeId || '');
    const activeTypes = db.feedTypes.slice().sort((a, b) => (a.stage || '').localeCompare(b.stage || '') || (a.name || '').localeCompare(b.name || ''));
    const selectedType = selectedId && selectedId !== '__legacy__' ? feedTypeById(selectedId) : null;
    const options = [`<option value="">Chọn loại cám…</option>`, ...activeTypes.map(t => {
      const selected = t.id === selectedId ? 'selected' : '';
      const disabled = t.active === false && t.id !== selectedId ? 'disabled' : '';
      return `<option value="${attr(t.id)}" ${selected} ${disabled}>${esc(t.name)} · ${esc(t.stage || 'Chưa phân giai đoạn')}${t.active === false ? ' · Ngừng dùng' : ''}</option>`;
    })];
    if (selectedId === '__legacy__' || (!selectedId && line.feedName)) options.push(`<option value="__legacy__" selected>Cám chưa phân loại (dữ liệu cũ)</option>`);
    let price = line.unitPricePerKg;
    if (price === undefined || price === null || price === '') price = selectedType ? (priceForFeedType(selectedType, date)?.unitPrice ?? '') : '';
    const productLabel = selectedType ? `${selectedType.name} · ${selectedType.stage || ''}` : (line.feedName || 'Cám chưa phân loại');
    return `<div class="feed-line" data-feed-line data-feed-index="${index}">
      <div class="feed-line-top"><span class="feed-line-number">Loại cám ${index + 1}</span><button type="button" class="btn btn-small btn-danger" data-remove-feed-line aria-label="Xóa dòng cám">Xóa</button></div>
      <div class="feed-line-grid">
        <div class="field feed-product-field"><label>Loại cám / giai đoạn</label><select data-feed-type aria-label="Loại cám">${options.join('')}</select><span class="hint" data-feed-meta>${esc(selectedType ? `${selectedType.brand || 'Không ghi hãng'} · ${selectedType.stage}` : (line.legacy ? 'Đơn giá được giữ từ nhật ký cũ' : 'Quản lý sản phẩm trong Cài đặt'))}</span></div>
        <div class="field"><label>Lượng dùng (kg)</label><input data-feed-quantity type="number" min="0" step="0.1" value="${attr(line.quantityKg ?? '')}" placeholder="Kg thực tế" aria-label="Lượng cám kg"></div>
        <div class="field"><label>Đơn giá (đồng/kg)</label><input data-feed-price type="number" min="0" step="1" value="${attr(price)}" placeholder="Giá áp dụng" aria-label="Đơn giá cám"></div>
      </div>
    </div>`;
  }
  function renderFeedLines(log, date) {
    let lines = Array.isArray(log.feedItems) && log.feedItems.length ? log.feedItems : [];
    if (!lines.length && (num(log.feedKg) > 0 || num(log.feedPricePerKg) > 0)) lines = feedLinesForLog(log);
    if (!lines.length) lines = [{ feedTypeId: '', quantityKg: '', unitPricePerKg: '' }];
    return lines.map((line, i) => renderFeedLine(line, date, i)).join('');
  }
  function updateFeedTotals() {
    const container = $('#feedLines'); if (!container) return;
    let totalKg = 0, totalCost = 0, missingPrice = false;
    $$('[data-feed-line]', container).forEach(row => {
      const qty = Math.max(0, num(row.querySelector('[data-feed-quantity]')?.value));
      const priceInput = row.querySelector('[data-feed-price]');
      const price = Math.max(0, num(priceInput?.value));
      totalKg += qty; totalCost += qty * price;
      if (qty > 0 && !(price > 0)) missingPrice = true;
    });
    const kg = $('#feedTotalKg'), cost = $('#feedTotalCost'), avg = $('#feedAveragePrice');
    if (kg) kg.textContent = `${fmt(totalKg, 1)} kg`;
    if (cost) cost.textContent = money(totalCost);
    if (avg) avg.textContent = totalKg > 0 && !missingPrice ? `${money(totalCost / totalKg)}/kg` : (totalKg > 0 ? 'Thiếu giá' : '—');
    const summary = $('#feedTotalSummary');
    if (summary) summary.classList.toggle('has-missing-price', missingPrice);
  }
  function addFeedLine(line = {}) {
    const container = $('#feedLines'); if (!container) return;
    const date = $('#dailyDate')?.value || localDate();
    const index = $$('[data-feed-line]', container).length;
    container.insertAdjacentHTML('beforeend', renderFeedLine(line, date, index));
    updateFeedTotals();
  }
  function captureFeedLines(form, date) {
    const rows = $$('[data-feed-line]', form);
    const items = [];
    for (const row of rows) {
      const select = row.querySelector('[data-feed-type]');
      const quantityKg = num(row.querySelector('[data-feed-quantity]')?.value);
      const unitPricePerKg = num(row.querySelector('[data-feed-price]')?.value);
      const selectedId = select?.value || '';
      if (quantityKg <= 0 && !selectedId) continue;
      if (quantityKg <= 0 && selectedId !== '__legacy__') continue;
      if (quantityKg > 0 && !selectedId) throw new Error('Mỗi dòng có lượng cám lớn hơn 0 phải chọn loại cám trong danh mục.');
      if (quantityKg < 0 || unitPricePerKg < 0) throw new Error('Lượng cám và đơn giá không thể âm.');
      const type = selectedId && selectedId !== '__legacy__' ? feedTypeById(selectedId) : null;
      if (selectedId !== '__legacy__' && selectedId && !type) throw new Error('Một loại cám đã bị xóa khỏi danh mục. Hãy chọn lại loại cám.');
      const legacy = selectedId === '__legacy__';
      const selectedOption = select?.selectedOptions?.[0];
      const applicablePrice = type ? priceForFeedType(type, date) : null;
      items.push({
        feedTypeId: type?.id || null,
        feedName: type?.name || (legacy ? 'Cám chưa phân loại (dữ liệu cũ)' : (selectedOption?.textContent || 'Cám chưa phân loại')),
        stage: type?.stage || '', brand: type?.brand || '', quantityKg, unitPricePerKg,
        priceEffectiveFrom: applicablePrice?.effectiveFrom || date,
        priceSource: type && applicablePrice && num(applicablePrice.unitPrice) === unitPricePerKg ? 'catalog' : 'manual',
        legacy
      });
    }
    return items;
  }
  function renderFeedTypeFormFor(typeId) {
    const form = $('#feedTypeForm'); const type = feedTypeById(typeId); if (!form || !type) return;
    const latest = priceHistoryFor(type).slice(-1)[0];
    form.elements.namedItem('feedTypeId').value = type.id;
    form.elements.namedItem('feedName').value = type.name || '';
    form.elements.namedItem('feedStage').value = type.stage || '';
    form.elements.namedItem('feedBrand').value = type.brand || '';
    form.elements.namedItem('feedPricePerKg').value = latest?.unitPrice ?? '';
    form.elements.namedItem('feedEffectiveDate').value = latest?.effectiveFrom || localDate();
    $('#feedTypeFormTitle').textContent = `Sửa sản phẩm: ${type.name}`;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function resetFeedTypeForm() {
    const form = $('#feedTypeForm'); if (!form) return;
    form.reset(); form.elements.namedItem('feedTypeId').value = '';
    form.elements.namedItem('feedEffectiveDate').value = localDate();
    $('#feedTypeFormTitle').textContent = 'Thêm sản phẩm cám';
  }
  function renderDaily() {
    const b = activeBatch();
    if (!b) return noBatchBlock();
    const date = $('#mainContent')?.dataset?.editDate || localDate();
    const existing = logsFor(b.id).find(x => x.date === date) || null;
    const curObs = observationFor(b);
    const currentAverage = curObs?.avgWeight || 75;
    const l = existing || { date, feedKg: 0, feedPricePerKg: num(b.defaultFeedPrice) || 0, feedItems: [], deadCount: 0, deadAvgWeight: '', cullCount: 0, cullWeightTotal: 0, cullRevenue: 0, soldCount: 0, soldWeightTotal: 0, salePricePerKg: 0, transferOutCount: 0, transferOutWeightTotal: 0, addedCount: 0, addedWeightTotal: 0, addedCost: 0, estimatedAvgWeight: currentAverage, notes: '' };
    const m = allBatchMetrics(b);
    return `${pageHead('Nhật ký hằng ngày', `Lưu thức ăn và mọi biến động của ${b.name}. Mỗi ngày, mỗi lứa chỉ có một bản ghi nhật ký.`, `<button class="btn" data-go="reports">Xem báo cáo</button>`)}
      <div class="notice notice-blue"><div>i</div><div><strong>Ghi nhận theo sự kiện thực tế</strong>Nhập lượng cám đã tiêu thụ (không phải lượng xuất kho). Chết, loại, bán, chuyển đàn và nhập đàn phải tách riêng để cân đối số con và sinh khối chính xác.</div></div>
      <div class="form-layout"><section class="card form-card"><h2>${existing ? 'Sửa nhật ký ngày' : 'Tạo nhật ký ngày'}</h2><p class="sub">Các trường có dấu * là bắt buộc. Khi lưu cùng ngày/lứa đã tồn tại, bản ghi đó sẽ được cập nhật.</p>
        <form id="dailyForm"><input type="hidden" name="id" value="${attr(existing?.id || '')}"><div class="form-grid">
          <div class="field"><label for="dailyDate">Ngày ghi nhận *</label><input id="dailyDate" name="date" type="date" value="${attr(l.date)}" required></div>
          <div class="field full feed-entry-area"><label>Thức ăn tiêu thụ trong ngày *</label>
            <div class="feed-lines" id="feedLines">${renderFeedLines(l, date)}</div>
            <div class="feed-line-actions"><button type="button" class="btn btn-small" data-add-feed-line>＋ Thêm loại cám</button><button type="button" class="btn btn-small" data-go="settings">Quản lý danh mục cám →</button></div>
            <div class="feed-total-summary" id="feedTotalSummary"><div><span>Tổng thức ăn</span><strong id="feedTotalKg">${fmt(feedKgForLog(l), 1)} kg</strong></div><div><span>Tổng chi phí cám</span><strong id="feedTotalCost">${money(feedCostForLog(l))}</strong></div><div><span>Giá bình quân gia quyền</span><strong id="feedAveragePrice">${feedKgForLog(l) > 0 ? money(feedCostForLog(l) / feedKgForLog(l)) + '/kg' : '—'}</strong></div></div>
            <span class="hint">Chọn từng sản phẩm theo giai đoạn, nhập lượng kg thực tế và đơn giá áp dụng. Giá được lưu cố định trong nhật ký để thay đổi bảng giá sau này không làm sai lịch sử chi phí.</span>
          </div>
          <div class="field"><label for="avgWeight">Trọng lượng bình quân hiện tại (kg/con)</label><input id="avgWeight" name="estimatedAvgWeight" type="number" min="0" step="0.1" value="${attr(l.estimatedAvgWeight ?? '')}" placeholder="Ví dụ: 75"><span class="hint">Đây là số ước tính. Cân mẫu/thực tế lưu ở mục “Cân heo”.</span></div>
          <div class="field"><label for="deadCount">Heo chết (con)</label><input id="deadCount" name="deadCount" type="number" min="0" step="1" value="${attr(l.deadCount ?? 0)}"></div>
          <div class="field"><label for="deadAvgWeight">Cân nặng bình quân heo chết (kg/con)</label><input id="deadAvgWeight" name="deadAvgWeight" type="number" min="0" step="0.1" value="${attr(l.deadAvgWeight ?? '')}" placeholder="Nếu không cân, để trống"><span class="hint">Để trống sẽ ước tính theo trọng lượng bình quân hiện tại.</span></div>
          <div class="field"><label for="cullCount">Heo loại/thải (con)</label><input id="cullCount" name="cullCount" type="number" min="0" step="1" value="${attr(l.cullCount ?? 0)}"></div>
          <div class="field"><label for="cullWeightTotal">Tổng cân nặng heo loại (kg)</label><input id="cullWeightTotal" name="cullWeightTotal" type="number" min="0" step="0.1" value="${attr(l.cullWeightTotal ?? '')}" placeholder="Để trống nếu chưa cân"></div>
          <div class="field"><label for="cullRevenue">Tiền thu từ heo loại (đồng)</label><input id="cullRevenue" name="cullRevenue" type="number" min="0" step="1" value="${attr(l.cullRevenue ?? 0)}"><span class="hint">Chỉ nhập khoản thực thu từ heo loại/thải.</span></div>
          <div class="field"><label for="soldCount">Heo bán (con)</label><input id="soldCount" name="soldCount" type="number" min="0" step="1" value="${attr(l.soldCount ?? 0)}"></div>
          <div class="field"><label for="soldWeightTotal">Tổng cân nặng heo bán (kg)</label><input id="soldWeightTotal" name="soldWeightTotal" type="number" min="0" step="0.1" value="${attr(l.soldWeightTotal ?? '')}" placeholder="Theo phiếu cân/lò mổ"></div>
          <div class="field"><label for="salePrice">Giá bán bình quân (đồng/kg)</label><input id="salePrice" name="salePricePerKg" type="number" min="0" step="1" value="${attr(l.salePricePerKg ?? '')}" placeholder="Giá giao dịch thực tế"></div>
          <div class="field"><label for="transferOutCount">Chuyển ra lứa/ô khác (con)</label><input id="transferOutCount" name="transferOutCount" type="number" min="0" step="1" value="${attr(l.transferOutCount ?? 0)}"></div>
          <div class="field"><label for="transferOutWeightTotal">Tổng cân nặng chuyển ra (kg)</label><input id="transferOutWeightTotal" name="transferOutWeightTotal" type="number" min="0" step="0.1" value="${attr(l.transferOutWeightTotal ?? '')}" placeholder="Nếu biết"><span class="hint">Chuyển giữa các lứa cần ghi nhận cả lứa nhận để tránh mất cân đối toàn trại.</span></div>
          <div class="field"><label for="addedCount">Heo nhập thêm (con)</label><input id="addedCount" name="addedCount" type="number" min="0" step="1" value="${attr(l.addedCount ?? 0)}"></div>
          <div class="field"><label for="addedWeightTotal">Tổng cân nặng heo nhập thêm (kg)</label><input id="addedWeightTotal" name="addedWeightTotal" type="number" min="0" step="0.1" value="${attr(l.addedWeightTotal ?? '')}" placeholder="Theo cân khi nhập"><span class="hint">Không có cân nặng thì có thể làm sai FCR tích lũy.</span></div>
          <div class="field"><label for="addedCost">Giá vốn/giá trị heo nhập thêm (đồng)</label><input id="addedCost" name="addedCost" type="number" min="0" step="1" value="${attr(l.addedCost ?? '')}" placeholder="Bắt buộc để tính lời/lỗ khi nhập thêm"><span class="hint">Nếu chuyển từ lứa khác, nhập giá trị chuyển vào để không thiếu giá vốn.</span></div>
          <div class="field full"><label for="dailyNotes">Ghi chú</label><textarea id="dailyNotes" name="notes" placeholder="Bệnh, thay đổi khẩu phần, cám rơi vãi, bất thường...">${esc(l.notes || '')}</textarea></div>
        </div><div class="form-actions"><button type="button" class="btn" data-go="dashboard">Hủy</button><button type="submit" class="btn btn-primary">${existing ? 'Lưu thay đổi' : 'Lưu nhật ký ngày'}</button></div></form>
      </section><aside class="side-panel"><section class="card"><div class="card-heading"><div><h2>Tóm tắt lứa hiện tại</h2><p>Trước khi ghi nhật ký hôm nay.</p></div></div><div class="mini-stat-grid"><div class="mini-stat"><span>Heo hiện có</span><strong>${fmt(m.currentCount, 0)} con</strong></div><div class="mini-stat"><span>Trọng lượng gần nhất</span><strong>${m.avgWeight ? `${fmt(m.avgWeight, 1)} kg` : '—'}</strong></div><div class="mini-stat"><span>FCR tích lũy</span><strong>${m.fcr === null ? '—' : fmt(m.fcr, 2)}</strong></div><div class="mini-stat"><span>Tổng cám ghi nhận</span><strong>${fmt(m.feedKg, 0)} kg</strong></div></div><div class="footnote">Tóm tắt cập nhật sau khi lưu. Số heo hiện có được suy ra từ số đầu lứa và các biến động đã ghi.</div></section><section class="card"><h2 class="section-title">Quy tắc nhập</h2><div class="check-item"><span class="check-icon">✓</span><div><strong>Nhập theo ngày, đúng lứa</strong><small>Một nhật ký mỗi ngày cho mỗi lứa nuôi.</small></div></div><div class="check-item"><span class="check-icon">✓</span><div><strong>Tách chết và loại</strong><small>Heo loại có thể có doanh thu; heo chết không phải doanh thu.</small></div></div><div class="check-item"><span class="check-icon">✓</span><div><strong>Phân biệt đo và ước tính</strong><small>Trọng lượng ở biểu mẫu này được ghi là ước tính.</small></div></div></section></aside></div>
      <div class="section-row"><h2>Nhật ký đã ghi</h2><span class="tag tag-gray">${m.logs.length} bản ghi</span></div><section class="card">${renderLogsTable(m.logs)}</section>`;
  }

  function renderLogsTable(logs) {
    if (!logs.length) return `<div class="empty"><div class="empty-icon">▤</div><h3>Chưa có dữ liệu</h3><p>Bản ghi sẽ xuất hiện tại đây sau khi lưu.</p></div>`;
    return `<div class="table-wrap"><table><thead><tr><th>NGÀY</th><th>CÁM THEO LOẠI / GIAI ĐOẠN</th><th class="num">TỔNG THỨC ĂN</th><th class="num">CHI PHÍ CÁM</th><th class="num">CHẾT</th><th class="num">LOẠI</th><th class="num">BÁN</th><th class="num">TRỌNG LƯỢNG ƯỚC TÍNH</th><th></th></tr></thead><tbody>${sorted(logs).slice(0, 30).map(l => `<tr><td><span class="table-primary">${esc(l.date)}</span></td><td>${esc(feedSummaryForLog(l))}</td><td class="num">${fmt(feedKgForLog(l), 1)} kg</td><td class="num">${money(feedCostForLog(l))}</td><td class="num">${fmt(l.deadCount, 0)}</td><td class="num">${fmt(l.cullCount, 0)}</td><td class="num">${fmt(l.soldCount, 0)}</td><td class="num">${l.estimatedAvgWeight ? `${fmt(l.estimatedAvgWeight, 1)} kg` : '—'}</td><td><button class="btn btn-small" data-edit-log="${attr(l.id)}">Sửa</button> <button class="btn btn-small btn-danger" data-delete="log:${attr(l.id)}">Xóa</button></td></tr>`).join('')}</tbody></table></div>`;
  }

  function renderWeighing() {
    const b = activeBatch();
    if (!b) return noBatchBlock();
    const m = allBatchMetrics(b);
    const rows = sorted(weightsFor(b.id)).map(w => `<tr><td>${esc(w.date)}</td><td class="num">${fmt(w.sampleCount, 0)} con</td><td class="num">${fmt(w.avgWeight, 2)} kg</td><td>${statusTag(typeLabel(w.method), w.method === 'actual' ? 'green' : w.method === 'sample' ? 'amber' : 'gray')}</td><td>${esc(w.notes || '—')}</td><td><button class="btn btn-small btn-danger" data-delete="weighing:${attr(w.id)}">Xóa</button></td></tr>`).join('');
    return `${pageHead('Cân heo', `Lưu lần cân toàn đàn hoặc cân mẫu. Đây là dữ liệu quan trọng nhất để kiểm chứng sinh khối và FCR của ${b.name}.`)}
      <div class="notice"><div>⚖</div><div><strong>Không đánh đồng cân mẫu với cân toàn đàn</strong>Nhập số con được cân và trọng lượng bình quân thực đo. Chọn đúng phương pháp; cân mẫu vẫn là ước tính cho toàn đàn.</div></div>
      <div class="form-layout"><section class="card form-card"><h2>Ghi nhận lần cân</h2><p class="sub">Mỗi lần cân được lưu riêng, không ghi đè lần cân trước.</p><form id="weighingForm"><div class="form-grid">
        <div class="field"><label for="weighDate">Ngày cân *</label><input id="weighDate" type="date" name="date" value="${localDate()}" required></div>
        <div class="field"><label for="weighMethod">Phương pháp *</label><select name="method" id="weighMethod"><option value="actual">Cân thực tế (toàn đàn)</option><option value="sample" selected>Cân mẫu đại diện</option><option value="estimate">Ước tính/chưa cân</option></select></div>
        <div class="field"><label for="sampleCount">Số con được cân (con)</label><input id="sampleCount" type="number" min="0" step="1" name="sampleCount" value="10"><span class="hint">Với cân toàn đàn, nhập số con đã cân thực tế.</span></div>
        <div class="field"><label for="weighAvg">Trọng lượng bình quân (kg/con) *</label><input id="weighAvg" type="number" name="avgWeight" min="0.1" step="0.1" placeholder="Ví dụ: 75" required></div>
        <div class="field full"><label for="weighNotes">Ghi chú / phương pháp lấy mẫu</label><textarea id="weighNotes" name="notes" placeholder="Ví dụ: cân 20 con/ô, cân buổi sáng trước khi cho ăn..."></textarea></div>
      </div><div class="form-actions"><button type="submit" class="btn btn-primary">Lưu lần cân</button></div></form></section>
      <aside class="side-panel"><section class="card"><h2 class="section-title">Trọng lượng đang dùng</h2><div class="kpi-value">${m.avgWeight ? fmt(m.avgWeight, 2) : '—'} <span class="unit">kg/con</span></div><div class="kpi-foot">${m.observation ? `${esc(m.observation.date)} · ${statusTag(typeLabel(m.observation.source), m.observation.source === 'actual' ? 'green' : 'amber')}` : 'Chưa có trọng lượng'}</div><div class="formula"><code>Sinh khối ≈ số heo còn × kg/con</code><p>Khối lượng đàn hiện tại được ước tính từ số lượng heo và trọng lượng bình quân gần nhất. Cân mẫu không đồng nghĩa với đã cân toàn đàn.</p></div><div class="mini-stat-grid"><div class="mini-stat"><span>Số heo còn</span><strong>${fmt(m.currentCount, 0)}</strong></div><div class="mini-stat"><span>Sinh khối ước tính</span><strong>${fmt(m.biomass, 0)} kg</strong></div></div></section></aside></div>
      <div class="section-row"><h2>Lịch sử cân</h2><span class="tag tag-gray">${weightsFor(b.id).length} lần cân</span></div><section class="card">${rows ? `<div class="table-wrap"><table><thead><tr><th>NGÀY CÂN</th><th class="num">SỐ CON CÂN</th><th class="num">TRỌNG LƯỢNG</th><th>PHƯƠNG PHÁP</th><th>GHI CHÚ</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty"><div class="empty-icon">⚖</div><h3>Chưa có lần cân</h3><p>Ghi lại các lần cân thật hoặc cân mẫu để theo dõi tăng trọng.</p></div>`}</section>`;
  }

  function renderCosts() {
    const b = activeBatch();
    if (!b) return noBatchBlock();
    const m = allBatchMetrics(b);
    const categories = ['Thuốc/vaccine','Thú y','Điện/nước','Nhân công','Vận chuyển','Vệ sinh/sát trùng','Sửa chữa/khấu hao','Khác'];
    const allCosts = sorted(costsFor(b.id));
    const filteredCosts = allCosts.filter(c => (!costView.from || c.date >= costView.from) && (!costView.to || c.date <= costView.to) && (costView.category === 'all' || c.category === costView.category));
    const rows = filteredCosts.map(c => `<tr><td>${esc(c.date)}</td><td>${esc(c.category)}</td><td>${esc(c.description || '—')}</td><td class="num">${money(c.amount)}</td><td><button class="btn btn-small btn-danger" data-delete="cost:${attr(c.id)}">Xóa</button></td></tr>`).join('');
    return `${pageHead('Chi phí', `Ghi các khoản ngoài thức ăn cho ${b.name}. Chi phí cám được tính tự động từ từng nhật ký ngày.`, `<button class="btn" data-go="reports">Xem báo cáo</button>`)}
      <div class="grid kpi-grid"><div class="card kpi"><div class="kpi-top"><span>CHI PHÍ THỨC ĂN</span><span class="kpi-icon">🌾</span></div><div class="kpi-value">${shortMoney(m.feedCost)} <span class="unit">₫</span></div><div class="kpi-foot">Tổng từ nhật ký ngày có giá cám</div></div><div class="card kpi"><div class="kpi-top"><span>CHI PHÍ PHÁT SINH</span><span class="kpi-icon">▤</span></div><div class="kpi-value">${shortMoney(m.otherCosts)} <span class="unit">₫</span></div><div class="kpi-foot">${costsFor(b.id).length} khoản đã ghi</div></div><div class="card kpi"><div class="kpi-top"><span>VỐN MUA HEO BAN ĐẦU</span><span class="kpi-icon">₫</span></div><div class="kpi-value">${shortMoney(b.initialPurchaseCost)} <span class="unit">₫</span></div><div class="kpi-foot">Sửa trong Cài đặt → Thông tin lứa</div></div><div class="card kpi"><div class="kpi-top"><span>TỔNG CHI PHÍ ĐÃ GHI</span><span class="kpi-icon">Σ</span></div><div class="kpi-value">${shortMoney(m.totalCosts)} <span class="unit">₫</span></div><div class="kpi-foot">Chưa bao gồm khoản chưa nhập</div></div></div>
      <div class="form-layout"><section class="card form-card"><h2>Thêm khoản chi phí</h2><p class="sub">Không nhập tiền thức ăn ở đây để tránh tính trùng; giá cám được lưu trong nhật ký hằng ngày.</p><form id="costForm"><div class="form-grid"><div class="field"><label for="costDate">Ngày phát sinh *</label><input id="costDate" type="date" name="date" value="${localDate()}" required></div><div class="field"><label for="costCategory">Loại chi phí *</label><select id="costCategory" name="category">${categories.map(c => `<option>${esc(c)}</option>`).join('')}</select></div><div class="field full"><label for="costAmount">Số tiền (đồng) *</label><input id="costAmount" name="amount" type="number" min="1" step="1" placeholder="Ví dụ: 250000" required></div><div class="field full"><label for="costDescription">Nội dung / chứng từ</label><input id="costDescription" name="description" placeholder="Ví dụ: vaccine, hóa đơn điện tháng..."></div></div><div class="form-actions"><button type="submit" class="btn btn-primary">＋ Lưu khoản chi</button></div></form></section><aside class="side-panel"><section class="card"><h2 class="section-title">Cách ghi nhận chi phí</h2><div class="check-item"><span class="check-icon">1</span><div><strong>Chi phí con giống</strong><small>Nhập tổng tiền mua heo ban đầu trong thông tin lứa; không nhập lại ở đây.</small></div></div><div class="check-item"><span class="check-icon">2</span><div><strong>Chi phí thức ăn</strong><small>Trong nhật ký ngày, chọn từng loại cám theo giai đoạn và nhập kg tiêu thụ; giá theo ngày hiệu lực, chi phí tự cộng.</small></div></div><div class="check-item"><span class="check-icon">3</span><div><strong>Chi phí khác</strong><small>Ghi ngày phát sinh và số tiền thực tế; giữ chứng từ để đối chiếu.</small></div></div><div class="footnote">Có thể ghi nhiều loại cám trong cùng một ngày. Mỗi dòng lưu riêng sản phẩm, giai đoạn, lượng kg và đơn giá áp dụng.</div></section></aside></div>
      <div class="section-row"><h2>Lịch sử chi phí phát sinh</h2><span class="tag tag-gray">Hiển thị ${filteredCosts.length}/${allCosts.length} khoản</span></div><section class="card"><form id="costFilterForm" class="filter-row"><div class="field"><label>Từ ngày</label><input type="date" name="from" value="${attr(costView.from)}"></div><div class="field"><label>Đến ngày</label><input type="date" name="to" value="${attr(costView.to)}"></div><div class="field"><label>Loại chi phí</label><select name="category"><option value="all" ${costView.category==='all'?'selected':''}>Tất cả loại</option>${categories.map(c=>`<option value="${attr(c)}" ${costView.category===c?'selected':''}>${esc(c)}</option>`).join('')}</select></div><button class="btn btn-primary" type="submit">Lọc</button><button class="btn" type="button" data-reset-cost-filter>Đặt lại</button></form>${rows ? `<div class="table-wrap"><table><thead><tr><th>NGÀY</th><th>LOẠI</th><th>NỘI DUNG</th><th class="num">SỐ TIỀN</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty"><div class="empty-icon">₫</div><h3>${allCosts.length ? 'Không có khoản chi khớp bộ lọc' : 'Chưa có khoản chi phát sinh'}</h3><p>${allCosts.length ? 'Thử đổi khoảng ngày hoặc loại chi phí.' : 'Thêm thuốc, thú y, điện nước, nhân công và chi phí thực tế khác.'}</p></div>`}</section>`;
  }

  function qrImageUrl(tag, size=140) {
    // QR encodes only an internal tag (PP:<tag>); never place personal data inside a QR label.
    return backendAvailable ? `/api/qr?size=${size}&text=${encodeURIComponent('PP:'+tag)}` : `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=4&data=${encodeURIComponent('PP:'+tag)}`;
  }
  function statusName(status) {
    return ({normal:'Bình thường',watch:'Theo dõi',treatment:'Đang điều trị',isolation:'Cách ly',sold:'Đã bán',dead:'Đã chết',culled:'Đã loại thải'})[status] || status || 'Chưa rõ';
  }
  function pigStatusTag(status) {
    const kind = ({normal:'green',watch:'amber',treatment:'amber',isolation:'red',sold:'gray',dead:'red',culled:'gray'})[status] || 'gray';
    return statusTag(statusName(status), kind);
  }
  function blankDailyLog(batch, date, weight=0) {
    return { id:id(), batchId:batch.id, date, feedRecorded:false, feedItems:[], feedKg:0, feedPricePerKg:0, estimatedAvgWeight:num(weight)||0,
      deadCount:0, deadAvgWeight:0, cullCount:0, cullWeightTotal:0, cullRevenue:0, soldCount:0, soldWeightTotal:0, salePricePerKg:0,
      transferOutCount:0, transferOutWeightTotal:0, addedCount:0, addedWeightTotal:0, addedCost:0, notes:'', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
  }
  function ensureDailyLog(batch, date, weight=0) {
    let log=logsFor(batch.id).find(x=>x.date===date);
    if(!log) { log=blankDailyLog(batch,date,weight); db.logs.push(log); }
    return log;
  }
  function migrateLegacySaleToTicket(batchId, date) {
    const log=logsFor(batchId).find(x=>x.date===date);
    if(!log || !num(log.soldCount) || hasSalesTickets(batchId,date)) return;
    db.sales.push({id:id(),batchId,date,count:num(log.soldCount),totalWeightKg:num(log.soldWeightTotal),pricePerKg:num(log.salePricePerKg),buyer:'Chuyển từ nhật ký ngày',reference:'',notes:'Giao dịch trước đây nhập gộp trong nhật ký',migratedFromDailyLog:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    log.soldCount=0; log.soldWeightTotal=0; log.salePricePerKg=0; log.updatedAt=new Date().toISOString();
  }
  function renderSales() {
    const b=activeBatch(); if(!b) return noBatchBlock();
    const m=allBatchMetrics(b);
    const editingId=$('#mainContent')?.dataset?.editSale || '';
    const editing=db.sales.find(x=>x.id===editingId&&x.batchId===b.id)||null;
    const qrLinkedSale=!!editing?.sourcePigId;
    const tickets=salesFor(b.id).slice().sort((a,b)=>b.date.localeCompare(a.date));
    const legacyRows=logsFor(b.id).filter(l=>num(l.soldCount)>0&&!hasSalesTickets(b.id,l.date)).map(l=>`<tr><td>${esc(l.date)}</td><td>Nhật ký ngày (gộp)</td><td class="num">${fmt(l.soldCount,0)}</td><td class="num">${fmt(l.soldWeightTotal,1)}</td><td class="num">${money(l.salePricePerKg)}</td><td class="num">${money(num(l.soldWeightTotal)*num(l.salePricePerKg))}</td><td><span class="tag tag-amber">Dữ liệu cũ</span></td></tr>`).join('');
    const rows=tickets.map(x=>`<tr><td>${esc(x.date)}</td><td><div class="table-primary">${esc(x.buyer||'—')}</div><div class="table-muted">${esc(x.reference||x.notes||'')}</div></td><td class="num">${fmt(x.count,0)}</td><td class="num">${fmt(x.totalWeightKg,1)} kg</td><td class="num">${money(x.pricePerKg)}</td><td class="num">${money(num(x.totalWeightKg)*num(x.pricePerKg))}</td><td><button type="button" class="btn btn-small" data-edit-sale="${attr(x.id)}">Sửa</button> ${x.sourcePigId?'<span class="tag tag-gray">Từ QR</span>':`<button type="button" class="btn btn-small btn-danger" data-delete="sale:${attr(x.id)}">Xóa</button>`}</td></tr>`).join('');
    const totalCount=soldCountForBatch(b.id), totalWeight=soldWeightForBatch(b.id,b.startDate||'',localDate()), revenue=salesRevenueForBatch(b.id,b.startDate||'',localDate());
    return `${pageHead('Doanh thu / xuất bán',`Ghi từng phiếu bán, giá bán thực tế và khối lượng; báo cáo kinh tế tự cập nhật cho ${b.name}.`,`<button class="btn" data-go="reports">Báo cáo lứa ↗</button>`)}
      <div class="grid kpi-grid"><div class="card kpi"><div class="kpi-top"><span>DOANH THU BÁN HEO</span><span class="kpi-icon">↗</span></div><div class="kpi-value">${shortMoney(revenue)} ₫</div><div class="kpi-foot">Tổng theo kg bán × đơn giá thực tế</div></div><div class="card kpi"><div class="kpi-top"><span>SỐ HEO ĐÃ BÁN</span><span class="kpi-icon">🐖</span></div><div class="kpi-value">${fmt(totalCount,0)} <span class="unit">con</span></div><div class="kpi-foot">Đối chiếu với cân đối đàn</div></div><div class="card kpi"><div class="kpi-top"><span>KHỐI LƯỢNG ĐÃ BÁN</span><span class="kpi-icon">⚖</span></div><div class="kpi-value">${fmt(totalWeight,1)} <span class="unit">kg</span></div><div class="kpi-foot">Theo phiếu cân / giao nhận</div></div><div class="card kpi"><div class="kpi-top"><span>GIÁ BÁN BÌNH QUÂN</span><span class="kpi-icon">₫</span></div><div class="kpi-value">${totalWeight>0?money(revenue/totalWeight):'—'}</div><div class="kpi-foot">Đồng/kg heo hơi</div></div></div>
      <div class="form-layout"><section class="card form-card"><h2>${editing?'Sửa phiếu xuất bán':'Tạo phiếu xuất bán'}</h2><p class="sub">Mỗi lần xuất bán ghi thành một phiếu. Lưu phiếu sẽ cập nhật số heo còn, doanh thu và mở báo cáo lứa.</p><form id="saleForm"><input type="hidden" name="saleId" value="${attr(editing?.id||'')}"><div class="form-grid"><div class="field"><label>Ngày xuất bán *</label><input type="date" name="date" value="${attr(editing?.date||localDate())}" ${qrLinkedSale?'readonly title="Ngày sự kiện lấy từ hồ sơ QR"':''} required></div><div class="field"><label>Số heo bán (con) *</label><input type="number" name="count" min="1" step="1" value="${attr(editing?.count??'')}" ${qrLinkedSale?'readonly title="Số heo lấy từ hồ sơ QR"':''} required></div><div class="field"><label>Tổng khối lượng (kg) *</label><input type="number" name="totalWeightKg" min="0.1" step="0.1" value="${attr(editing?.totalWeightKg??'')}" ${qrLinkedSale?'readonly title="Trọng lượng lấy từ hồ sơ QR"':''} required></div><div class="field"><label>Giá bán bình quân (đồng/kg) *</label><input type="number" name="pricePerKg" min="1" step="1" value="${attr(editing?.pricePerKg??'')}" required></div><div class="field"><label>Khách mua / thương lái</label><input name="buyer" maxlength="120" value="${attr(editing?.buyer||'')}" placeholder="Tên người mua"></div><div class="field"><label>Số phiếu / hóa đơn</label><input name="reference" maxlength="100" value="${attr(editing?.reference||'')}" placeholder="Mã phiếu cân hoặc phiếu giao nhận"></div><div class="field full"><label>Ghi chú</label><textarea name="notes" placeholder="Loại heo, địa điểm cân, phí vận chuyển...">${esc(editing?.notes||'')}</textarea></div></div><div class="form-actions"><button type="button" class="btn" data-reset-sale>Nhập phiếu mới</button><button type="submit" class="btn btn-primary">${editing?'Lưu sửa đổi':'＋ Lưu phiếu và cập nhật báo cáo'}</button></div></form><div class="footnote">${qrLinkedSale?'Phiếu này được tạo từ hồ sơ QR. Ngày, số con và kg được khóa theo hồ sơ để tránh lệch cân đối đàn; chỉ nên sửa giá và thông tin giao dịch. ':''}Doanh thu = tổng khối lượng × đơn giá. Phí vận chuyển/hoa hồng nếu tính riêng cần ghi vào Chi phí; không cộng vào đơn giá nếu cần so sánh giá giao dịch.</div></section>
      <aside class="side-panel"><section class="card"><h2 class="section-title">Cách ghi phiếu</h2><div class="check-item"><span class="check-icon">1</span><div><strong>Đếm đúng số con</strong><small>Khớp số lượng xuất bán thực tế.</small></div></div><div class="check-item"><span class="check-icon">2</span><div><strong>Dùng tổng kg thực tế</strong><small>Theo phiếu cân, không suy ra từ trọng lượng ước tính nếu đã có cân.</small></div></div><div class="check-item"><span class="check-icon">3</span><div><strong>Ghi giá bán thực tế</strong><small>Không dùng giá heo hơi tham chiếu thay cho giá giao dịch.</small></div></div><div class="footnote">Đừng ghi cùng giao dịch vừa ở sổ phiếu bán vừa điền lại số heo bán trong nhật ký ngày.</div></section></aside></div>
      <div class="section-row"><h2>Sổ phiếu bán</h2><span class="tag tag-gray">${tickets.length} phiếu chi tiết</span></div><section class="card">${rows||legacyRows?`<div class="table-wrap"><table><thead><tr><th>NGÀY</th><th>KHÁCH MUA / THAM CHIẾU</th><th class="num">SỐ CON</th><th class="num">TỔNG KG</th><th class="num">GIÁ/KG</th><th class="num">DOANH THU</th><th>THAO TÁC</th></tr></thead><tbody>${rows}${legacyRows}</tbody></table></div>`:`<div class="empty"><div class="empty-icon">↗</div><h3>Chưa có phiếu bán</h3><p>Nhập phiếu xuất bán đầu tiên để có doanh thu thực tế và báo cáo lứa nuôi.</p></div>`}</section>`;
  }
  function pigTagPrefixForBatch(batch) {
    const siblingBatches = db.batches.filter(x => x.farmId === batch.farmId);
    const index = Math.max(1, siblingBatches.findIndex(x => x.id === batch.id) + 1);
    return `L${index}`;
  }
  function generateBulkPigTags(form) {
    if (readOnlyMode) { toast('Tài khoản chỉ xem không thể tạo hồ sơ heo.', 'error'); return; }
    const b = activeBatch(); if (!b) return;
    const d = formObject(form);
    const prefix = String(d.prefix || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
    const quantity = num(d.quantity);
    if (!prefix) { toast('Nhập tiền tố mã heo, ví dụ L1.', 'error'); return; }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 300) { toast('Số lượng mỗi lần tạo phải từ 1 đến 300 tem để bảo đảm tải QR ổn định.', 'error'); return; }
    const taken = new Set(db.pigs.map(p => String(p.tag || '').toLowerCase()));
    const pattern = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[-_](\\d+)$', 'i');
    let next = 1;
    for (const pig of db.pigs) { const match = String(pig.tag || '').match(pattern); if (match) next = Math.max(next, Number(match[1]) + 1); }
    const created = [];
    while (created.length < quantity) {
      const tag = `${prefix}-${String(next++).padStart(3, '0')}`;
      if (taken.has(tag.toLowerCase())) continue;
      taken.add(tag.toLowerCase());
      const record = { id: id(), batchId: b.id, tag, pen: String(d.pen || '').trim(), weightKg: 0, weightDate: '', status: 'normal', salePricePerKg: 0, notes: '', weightHistory: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), statusDate: '' };
      db.pigs.push(record); created.push(record);
    }
    saveDB();
    $('#mainContent').dataset.editPig = '';
    toast(`Đã tạo ${created.length} hồ sơ mã QR. Hồ sơ QR không tự cộng thêm số con trong cân đối đàn; số con đàn vẫn lấy từ nhật ký biến động.`);
    render();
    printQrLabels(created);
  }
  function renderPigs() {
    const b=activeBatch(); if(!b) return noBatchBlock();
    const editId=$('#mainContent')?.dataset?.editPig||'';
    const editing=db.pigs.find(p=>p.id===editId&&p.batchId===b.id)||null;
    const statuses=['normal','watch','treatment','isolation','sold','dead','culled'];
    const all=pigsFor(b.id);
    const view=all.filter(p=>(!pigSearchTerm||(p.tag+' '+p.pen).toLowerCase().includes(pigSearchTerm.toLowerCase()))&&(pigStatusFilter==='all'||p.status===pigStatusFilter));
    const rows=view.slice().sort((a,b)=>a.tag.localeCompare(b.tag)).map(p=>`<tr><td><div class="pig-cell"><img loading="lazy" src="${attr(qrImageUrl(p.tag,88))}" alt="QR ${attr(p.tag)}"><div><strong>${esc(p.tag)}</strong><small>${esc(p.pen||'Chưa gắn ô chuồng')}</small></div></div></td><td>${pigStatusTag(p.status)}</td><td class="num">${p.weightKg>0?fmt(p.weightKg,1)+' kg':'—'}</td><td>${esc(p.weightDate||'—')}</td><td>${esc(p.notes||'—')}</td><td><div class="row-actions"><button type="button" class="btn btn-small" data-edit-pig="${attr(p.id)}">Cập nhật</button><button type="button" class="btn btn-small" data-print-one-qr="${attr(p.id)}">In QR</button>${['sold','dead','culled'].includes(p.status)?'':`<button type="button" class="btn btn-small btn-danger" data-delete="pig:${attr(p.id)}">Xóa</button>`}</div></td></tr>`).join('');
    const statusOptions=statuses.map(x=>`<option value="${x}" ${((editing?.status||'normal')===x)?'selected':''}>${statusName(x)}</option>`).join('');
    const history=editing?.weightHistory?.length?`<div class="section-row"><h2>Lịch sử cân heo ${esc(editing.tag)}</h2></div><div class="table-wrap"><table><thead><tr><th>NGÀY</th><th class="num">KG/CON</th><th>GHI CHÚ</th></tr></thead><tbody>${editing.weightHistory.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(w=>`<tr><td>${esc(w.date)}</td><td class="num">${fmt(w.weightKg,1)}</td><td>${esc(w.notes||'—')}</td></tr>`).join('')}</tbody></table></div>`:'';
    return `${pageHead('Hồ sơ heo / Mã QR',`Tạo mã nhận diện, in tem, quét tìm hồ sơ và cập nhật cân nặng/tình trạng cho ${b.name}.`,`<button class="btn" id="printQrTags">In tem QR đàn đang nuôi</button>`)}
      <section class="card form-card" style="margin-bottom:15px"><div class="card-heading"><div><h2>Tạo hàng loạt mã QR</h2><p>Tạo nhanh danh sách tem cho đàn hiện có. Mỗi mã là một hồ sơ cá thể; không tự thay đổi số lượng đàn trong nhật ký.</p></div></div><form id="bulkPigForm" class="filter-row"><div class="field"><label>Tiền tố mã *</label><input name="prefix" value="${attr(pigTagPrefixForBatch(b))}" required maxlength="24" placeholder="L1"></div><div class="field"><label>Số tem cần tạo *</label><input name="quantity" type="number" min="1" max="300" step="1" value="50" required></div><div class="field"><label>Ô chuồng mặc định</label><input name="pen" maxlength="60" placeholder="Dãy A / Ô 03"></div><button class="btn btn-primary" type="submit">Tạo hồ sơ và in tem QR</button></form><div class="footnote">Mã được tự tăng theo số cuối của tiền tố (ví dụ L1-001). Mã đã tồn tại sẽ được bỏ qua để tránh trùng lặp. Sau khi tạo, trình duyệt mở hộp thoại in; chọn máy in tem hoặc lưu PDF.</div></section>
      <div class="grid kpi-grid"><div class="card kpi"><div class="kpi-top"><span>HỒ SƠ CÁ THỂ</span><span class="kpi-icon">▦</span></div><div class="kpi-value">${all.length}</div><div class="kpi-foot">Có thể quản lý theo mã heo/ô chuồng</div></div><div class="card kpi"><div class="kpi-top"><span>ĐANG NUÔI / THEO DÕI</span><span class="kpi-icon">🐖</span></div><div class="kpi-value">${all.filter(p=>!['sold','dead','culled'].includes(p.status)).length}</div><div class="kpi-foot">Hồ sơ chưa kết thúc</div></div><div class="card kpi"><div class="kpi-top"><span>ĐÃ BÁN / CHẾT / LOẠI</span><span class="kpi-icon">✓</span></div><div class="kpi-value">${all.filter(p=>['sold','dead','culled'].includes(p.status)).length}</div><div class="kpi-foot">Giữ lại lịch sử để đối chiếu</div></div><div class="card kpi"><div class="kpi-top"><span>HỒ SƠ CẦN CHÚ Ý</span><span class="kpi-icon">!</span></div><div class="kpi-value">${all.filter(p=>['watch','treatment','isolation'].includes(p.status)).length}</div><div class="kpi-foot">Theo dõi / điều trị / cách ly</div></div></div>
      <div class="form-layout"><section class="card form-card"><h2>${editing?'Cập nhật hồ sơ '+esc(editing.tag):'Tạo hồ sơ heo mới'}</h2><p class="sub">Mã heo duy nhất trong lứa. Khi đổi trọng lượng, ứng dụng lưu lịch sử cân. Chuyển trạng thái sang Đã bán/Đã chết/Đã loại thải sẽ ghi biến động đàn.</p><form id="pigForm"><input type="hidden" name="pigId" value="${attr(editing?.id||'')}"><div class="form-grid"><div class="field"><label>Mã heo / mã tem *</label><input name="tag" maxlength="60" value="${attr(editing?.tag||'')}" required placeholder="Ví dụ L1-006"></div><div class="field"><label>Ô chuồng</label><input name="pen" maxlength="60" value="${attr(editing?.pen||'')}" placeholder="Dãy A · Ô 03"></div><div class="field"><label>Trọng lượng gần nhất (kg)</label><input type="number" name="weightKg" min="0" step="0.1" value="${attr(editing?.weightKg??'')}" placeholder="Cân thực tế / ước tính"></div><div class="field"><label>Ngày cân / ước tính</label><input type="date" name="weightDate" value="${attr(editing?.weightDate||localDate())}" max="${localDate()}"></div><div class="field"><label>Tình trạng *</label><select name="status">${statusOptions}</select></div><div class="field"><label>Giá bán thực tế/dự kiến (đồng/kg)</label><input type="number" name="salePricePerKg" min="0" step="1" value="${attr(editing?.salePricePerKg??'')}" placeholder="Bắt buộc nếu chuyển sang Đã bán"></div><div class="field"><label>Ngày sự kiện trạng thái</label><input type="date" name="eventDate" value="${localDate()}" max="${localDate()}"></div><div class="field full"><label>Ghi chú</label><textarea name="notes" placeholder="Triệu chứng, điều trị, lịch kiểm tra...">${esc(editing?.notes||'')}</textarea></div></div><div class="form-actions"><button type="button" class="btn" data-reset-pig>Nhập mới</button><button type="submit" class="btn btn-primary">Lưu hồ sơ heo</button></div></form>${history}</section>
      <aside class="side-panel"><section class="card"><h2 class="section-title">Quét mã QR</h2><p class="sub">Camera cần HTTPS và quyền truy cập. Nếu trình duyệt không hỗ trợ quét tự động, hãy nhập mã tem bên dưới.</p><video id="qrVideo" class="qr-video" playsinline muted></video><div class="form-actions"><button type="button" class="btn btn-primary" id="startQrScan">Mở camera quét QR</button><button type="button" class="btn" id="stopQrScan">Dừng camera</button></div><form id="qrManualForm" class="field" style="margin-top:12px"><label>Hoặc nhập mã tem thủ công</label><div class="inline-field"><input name="tag" placeholder="Ví dụ PP:L1-006" required><button class="btn" type="submit">Tìm hồ sơ</button></div></form><div id="qrScanMessage" class="footnote">Trên trình duyệt hỗ trợ BarcodeDetector, camera sẽ nhận mã QR. Nếu không, dùng nhập mã thủ công.</div><div class="footnote">Mã QR hiện được tạo bởi dịch vụ ảnh bên ngoài và chỉ chứa mã heo nội bộ; không đưa tên chủ trại, số điện thoại hoặc thông tin nhạy cảm vào mã.</div></section></aside></div>
      <div class="section-row"><h2>Danh sách hồ sơ heo</h2><span class="tag tag-gray">${view.length}/${all.length} hồ sơ</span></div><section class="card"><form id="pigSearchForm" class="filter-row"><div class="field"><label>Tìm mã heo / ô chuồng</label><input name="query" value="${attr(pigSearchTerm)}" placeholder="L1-006, ô A03..."></div><div class="field"><label>Lọc tình trạng</label><select name="status"><option value="all" ${pigStatusFilter==='all'?'selected':''}>Tất cả</option>${statuses.map(x=>`<option value="${x}" ${pigStatusFilter===x?'selected':''}>${statusName(x)}</option>`).join('')}</select></div><button class="btn btn-primary" type="submit">Tìm</button><button class="btn" type="button" data-reset-pig-search>Xóa lọc</button></form>${rows?`<div class="table-wrap"><table><thead><tr><th>MÃ HEO / QR</th><th>TÌNH TRẠNG</th><th class="num">TRỌNG LƯỢNG</th><th>NGÀY CÂN</th><th>GHI CHÚ</th><th>THAO TÁC</th></tr></thead><tbody>${rows}</tbody></table></div>`:`<div class="empty"><div class="empty-icon">▦</div><h3>${all.length?'Không tìm thấy hồ sơ':'Chưa có hồ sơ heo'}</h3><p>${all.length?'Thử đổi từ khóa hoặc bộ lọc.':'Tạo mã heo đầu tiên để in tem QR và cập nhật thông tin cá thể.'}</p><button class="btn btn-primary" type="button" data-reset-pig>＋ Thêm hồ sơ heo</button></div>`}</section>`;
  }
  function addPigEventToBatch(pig, eventDate, newStatus, salePrice) {
    const b=db.batches.find(x=>x.id===pig.batchId); if(!b) return;
    const weight=num(pig.weightKg);
    if(newStatus==='sold') {
      migrateLegacySaleToTicket(b.id,eventDate);
      db.sales.push({id:id(),batchId:b.id,date:eventDate,count:1,totalWeightKg:weight,pricePerKg:num(salePrice),buyer:'Xuất bán từ hồ sơ QR',reference:pig.tag,notes:`Bán heo mã ${pig.tag}`,sourcePigId:pig.id,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
      return;
    }
    const log=ensureDailyLog(b,eventDate,weight);
    if(newStatus==='dead') { const n=num(log.deadCount), avg=num(log.deadAvgWeight); log.deadCount=n+1; if(weight>0) log.deadAvgWeight=(n*avg+weight)/(n+1); log.notes=[log.notes,`Heo mã ${pig.tag} chết (${weight?fmt(weight,1)+' kg':'chưa cân'}).`].filter(Boolean).join(' '); }
    if(newStatus==='culled') { log.cullCount=num(log.cullCount)+1; if(weight>0) log.cullWeightTotal=num(log.cullWeightTotal)+weight; if(weight>0&&num(salePrice)>0) log.cullRevenue=num(log.cullRevenue)+weight*num(salePrice); log.notes=[log.notes,`Heo mã ${pig.tag} loại thải.`].filter(Boolean).join(' '); }
    log.updatedAt=new Date().toISOString();
  }
  function saveSale(form) {
    const b=activeBatch(); if(!b) return;
    const d=formObject(form); const saleId=d.saleId||'';
    if(!d.date||!(num(d.count)>0)||!Number.isInteger(num(d.count))||!(num(d.totalWeightKg)>0)||!(num(d.pricePerKg)>0)) { toast('Nhập ngày, số heo nguyên dương, tổng kg và giá bán lớn hơn 0.','error'); return; }
    if(d.date>localDate()||(b.startDate&&d.date<b.startDate)) { toast('Ngày bán phải trong thời gian lứa nuôi và không ở tương lai.','error'); return; }
    const existing=saleId?db.sales.find(x=>x.id===saleId&&x.batchId===b.id):null;
    if(saleId&&!existing) { toast('Không tìm thấy phiếu bán cần sửa.','error'); return; }
    if(!existing) { const oldLog=logsFor(b.id).find(x=>x.date===d.date&&num(x.soldCount)>0); if(oldLog&&!hasSalesTickets(b.id,d.date)) { if(!window.confirm(`Ngày ${d.date} đã có ${fmt(oldLog.soldCount,0)} con bán ghi gộp trong nhật ký. Chuyển giao dịch cũ sang sổ phiếu rồi thêm phiếu này?`)) return; migrateLegacySaleToTicket(b.id,d.date); } }
    if(existing?.sourcePigId) {
      const linkedPig=db.pigs.find(p=>p.id===existing.sourcePigId&&p.batchId===b.id);
      if(!linkedPig || linkedPig.status!=='sold') { toast('Phiếu bán QR không còn khớp hồ sơ heo. Hãy kiểm tra hồ sơ trước khi sửa.', 'error'); return; }
      if(d.date!==existing.date || num(d.count)!==num(existing.count) || Math.abs(num(d.totalWeightKg)-num(existing.totalWeightKg))>0.0001) { toast('Ngày, số con và khối lượng của phiếu QR phải giữ nguyên theo hồ sơ heo.', 'error'); return; }
    }
    const rec={id:existing?.id||id(),batchId:b.id,date:d.date,count:num(d.count),totalWeightKg:num(d.totalWeightKg),pricePerKg:num(d.pricePerKg),buyer:(d.buyer||'').trim(),reference:(d.reference||'').trim(),notes:(d.notes||'').trim(),sourcePigId:existing?.sourcePigId||null,createdAt:existing?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
    if(existing) db.sales=db.sales.map(x=>x.id===existing.id?rec:x); else db.sales.push(rec);
    if(existing?.sourcePigId) db.pigs=db.pigs.map(p=>p.id===existing.sourcePigId?{...p,salePricePerKg:num(d.pricePerKg),updatedAt:new Date().toISOString()}:p);
    saveDB(); $('#mainContent').dataset.editSale=''; toast('Đã lưu phiếu bán. Doanh thu, số heo còn lại và báo cáo lứa đã cập nhật.'); goTab('reports');
  }
  function savePig(form) {
    const b=activeBatch(); if(!b) return;
    const d=formObject(form), pigId=d.pigId||'', prev=pigId?db.pigs.find(p=>p.id===pigId&&p.batchId===b.id):null;
    const tag=(d.tag||'').trim(), status=d.status||'normal', weight=num(d.weightKg), eventDate=d.eventDate||localDate(), price=num(d.salePricePerKg);
    if(!tag) { toast('Mã heo là trường bắt buộc.','error'); return; }
    if(db.pigs.some(p=>p.batchId===b.id&&p.tag.toLowerCase()===tag.toLowerCase()&&p.id!==pigId)) { toast(`Mã heo “${tag}” đã tồn tại trong lứa này.`,'error'); return; }
    if(weight<0||price<0) { toast('Trọng lượng và giá bán không thể âm.','error'); return; }
    if(d.weightDate&&d.weightDate>localDate()) { toast('Ngày cân không thể ở tương lai.','error'); return; }
    const terminal=['sold','dead','culled'];
    if(prev&&terminal.includes(prev.status)&&(status!==prev.status||weight!==num(prev.weightKg))) { toast('Hồ sơ đã kết thúc (bán/chết/loại). Không đổi trạng thái hoặc cân nặng để tránh sai lịch sử.', 'error'); return; }
    if(!prev&&terminal.includes(status)) { toast('Hồ sơ mới phải bắt đầu ở trạng thái đang nuôi. Tạo hồ sơ rồi cập nhật trạng thái sau.', 'error'); return; }
    if(prev&&prev.status!==status&&terminal.includes(status)) {
      if(!eventDate||eventDate>localDate()||(b.startDate&&eventDate<b.startDate)) { toast('Ngày sự kiện phải thuộc thời gian lứa nuôi và không ở tương lai.','error'); return; }
      if(status==='sold'&&(!(weight>0)||!(price>0))) { toast('Khi chuyển sang “Đã bán”, cần nhập trọng lượng và giá bán/kg.','error'); return; }
      if(!window.confirm(`Xác nhận chuyển heo ${tag} sang “${statusName(status)}” ngày ${eventDate}? Ứng dụng sẽ cập nhật đàn và lịch sử.`)) return;
    }
    const date=d.weightDate||localDate();
    const pig={id:prev?.id||id(),batchId:b.id,tag,pen:(d.pen||'').trim(),weightKg:weight,weightDate:date,status,salePricePerKg:price,notes:(d.notes||'').trim(),weightHistory:Array.isArray(prev?.weightHistory)?prev.weightHistory.slice():[],createdAt:prev?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),statusDate:prev?.statusDate||''};
    if(weight>0&&(!prev||weight!==num(prev.weightKg)||date!==prev.weightDate)) { const wi=pig.weightHistory.findIndex(w=>w.date===date); const point={date,weightKg:weight,notes:(d.notes||'').trim()}; if(wi>=0)pig.weightHistory[wi]=point;else pig.weightHistory.push(point); }
    if(prev&&prev.status!==status&&terminal.includes(status)) { pig.statusDate=eventDate; addPigEventToBatch(pig,eventDate,status,price); }
    if(prev) db.pigs=db.pigs.map(p=>p.id===prev.id?pig:p); else db.pigs.push(pig);
    saveDB(); $('#mainContent').dataset.editPig=''; toast('Đã lưu hồ sơ heo và lịch sử cân.'); render();
  }
  function stopQrScanner() { qrScanActive=false; if(qrStream){qrStream.getTracks().forEach(t=>t.stop());qrStream=null;} const v=$('#qrVideo'); if(v){v.srcObject=null;v.style.display='none';} }
  async function startQrScanner() {
    const video=$('#qrVideo'), msg=$('#qrScanMessage'); if(!video)return;
    if(!('BarcodeDetector' in window)){if(msg)msg.textContent='Trình duyệt này chưa hỗ trợ quét QR tự động. Hãy nhập mã tem thủ công.';toast('Trình duyệt chưa hỗ trợ quét QR tự động.','error');return;}
    if(!navigator.mediaDevices?.getUserMedia){if(msg)msg.textContent='Camera cần trang HTTPS và quyền truy cập.';return;}
    try { stopQrScanner(); const detector=new BarcodeDetector({formats:['qr_code']}); qrStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false}); video.srcObject=qrStream;video.style.display='block';await video.play();qrScanActive=true;if(msg)msg.textContent='Đưa tem QR vào khung camera; hồ sơ sẽ tự mở khi nhận được mã.'; const scan=async()=>{if(!qrScanActive||!$('#qrVideo'))return;try{const codes=await detector.detect(video);if(codes.length&&codes[0].rawValue){const val=codes[0].rawValue.trim();stopQrScanner();openPigByTag(val);return;}}catch(_e){}if(qrScanActive)window.setTimeout(scan,280);};scan(); }
    catch(_e){stopQrScanner();if(msg)msg.textContent='Không mở được camera. Hãy cấp quyền camera hoặc nhập mã heo thủ công.';toast('Không mở được camera. Kiểm tra quyền và HTTPS.','error');}
  }
  function openPigByTag(raw) { const tag=String(raw||'').replace(/^PP:/i,'').trim(); const pig=db.pigs.find(p=>p.tag.toLowerCase()===tag.toLowerCase()); if(!pig){const msg=$('#qrScanMessage');if(msg)msg.textContent=`Không tìm thấy mã “${tag}”. Kiểm tra bộ dữ liệu/lứa nuôi.`;toast(`Không tìm thấy mã heo ${tag}.`,'error');return;} activeBatchId=pig.batchId;const pigBatch=db.batches.find(x=>x.id===pig.batchId);if(pigBatch?.farmId){activeFarmId=pigBatch.farmId;storageSet(ACTIVE_FARM_KEY,activeFarmId);}storageSet(ACTIVE_KEY,activeBatchId);activeTab='pigs';$('#mainContent').dataset.editPig=pig.id;render();$('#pigForm')?.scrollIntoView({behavior:'smooth',block:'center'});toast(`Đã tìm thấy hồ sơ ${pig.tag}.`); }
  async function printQrLabels(pigs) {
    if(!pigs.length){toast('Không có hồ sơ heo để in tem.','error');return;}
    const overlay=document.createElement('div'); overlay.id='qrPrintOverlay';
    overlay.innerHTML=`<div class="qr-print-area"><h1>${esc(farmNameForBatch(pigs[0]?.batchId))} · PigProfit AI</h1><p>Tem nhận diện heo — ${esc(activeBatch()?.name||'')}</p><div class="qr-print-grid">${pigs.map(p=>`<div class="qr-print-card"><img src="${attr(qrImageUrl(p.tag,220))}" alt="QR ${attr(p.tag)}"><strong>${esc(p.tag)}</strong><span>${esc(p.pen||batchName(p.batchId))}</span></div>`).join('')}</div></div>`;
    document.body.appendChild(overlay); document.body.classList.add('print-qr');
    const cleanup=()=>{document.body.classList.remove('print-qr');overlay.remove();window.removeEventListener('afterprint',cleanup);};
    window.addEventListener('afterprint',cleanup);
    // Wait for QR images to decode so labels don't print as blank placeholders.
    const images=Array.from(overlay.querySelectorAll('img'));
    await Promise.race([Promise.all(images.map(img => (img.decode ? img.decode() : new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;})).catch(()=>{}))),new Promise(resolve=>window.setTimeout(resolve,1800))]);
    window.print(); window.setTimeout(cleanup,5000);
  }

  function renderReports() {
    const b = activeBatch();
    if (!b) return noBatchBlock();
    if (reportView.batchId !== b.id) {
      reportView = { batchId: b.id, from: b.startDate || localDate(), to: localDate() };
    }
    const from = reportView.from || b.startDate || localDate();
    const to = reportView.to || localDate();
    const inRange = date => !!date && date >= from && date <= to;
    const m = allBatchMetrics(b); // Accumulated/livestock inventory metrics remain batch-to-date.
    const periodLogs = logsAfterStart(b).filter(l => inRange(l.date)).sort((a, z) => a.date.localeCompare(z.date));
    const reportCosts = costsFor(b.id).filter(c => inRange(c.date));
    const periodSales = salesFor(b.id).filter(s => inRange(s.date));
    const legacySalesLogs = periodLogs.filter(l => !hasSalesTickets(b.id, l.date));
    const periodFeedKg = sum(periodLogs, feedKgForLog);
    const periodFeedCost = sum(periodLogs, feedCostForLog);
    const periodOtherCosts = sum(reportCosts, 'amount');
    const periodInitialCost = !b.startDate || inRange(b.startDate) ? num(b.initialPurchaseCost) : 0;
    const periodAddedCost = sum(periodLogs, 'addedCost');
    const periodSalesCount = sum(periodSales, 'count') + sum(legacySalesLogs, 'soldCount');
    const periodSalesWeight = sum(periodSales, 'totalWeightKg') + sum(legacySalesLogs, 'soldWeightTotal');
    const periodSalesRevenue = sum(periodSales, s => num(s.totalWeightKg) * num(s.pricePerKg)) + sum(legacySalesLogs, l => num(l.soldWeightTotal) * num(l.salePricePerKg));
    const periodCullRevenue = sum(periodLogs, 'cullRevenue');
    const periodDeadCount = sum(periodLogs, 'deadCount');
    const periodCullCount = sum(periodLogs, 'cullCount');
    const periodTotalCosts = periodInitialCost + periodAddedCost + periodFeedCost + periodOtherCosts;
    // Period result is transaction-based and intentionally excludes the current value of unsold inventory.
    const periodResult = periodSalesRevenue + periodCullRevenue - periodTotalCosts;
    const periodDays = Math.max(1, Math.floor((new Date(`${to}T12:00:00`) - new Date(`${from}T12:00:00`)) / 86400000) + 1);
    const rangeUnpricedSales = periodSales.some(s => num(s.count) > 0 && (!(num(s.totalWeightKg) > 0) || !(num(s.pricePerKg) > 0))) || legacySalesLogs.some(l => num(l.soldCount) > 0 && (!(num(l.soldWeightTotal) > 0) || !(num(l.salePricePerKg) > 0)));
    const rangeMissingFeedPrice = periodLogs.some(feedPriceMissingForLog);
    const logRows = periodLogs.map(l => `<tr><td>${esc(l.date)}</td><td>${esc(feedSummaryForLog(l))}</td><td class="num">${fmt(feedKgForLog(l), 1)}</td><td class="num">${money(feedCostForLog(l))}</td><td class="num">${fmt(l.deadCount, 0)}</td><td class="num">${fmt(l.cullCount, 0)}</td><td class="num">${fmt(salesCountForLog(l), 0)}</td><td class="num">${fmt(l.estimatedAvgWeight, 1)}</td></tr>`).join('');
    const completeness = [
      ['Thông tin lứa và số heo đầu kỳ', num(b.initialCount) > 0 && num(b.initialAvgWeight) > 0],
      ['Vốn mua heo ban đầu', num(b.initialPurchaseCost) > 0],
      ['Có nhật ký thức ăn', m.logs.length > 0],
      ['Giá cám đã nhập cho tất cả ngày có tiêu thụ', !m.feedMissingPrice && m.feedKg > 0],
      ['Giá cám đủ dữ liệu trong kỳ FCR', !m.fcrMissingFeedPrice],
      ['Có trọng lượng gần nhất', !m.missingWeight],
      ['Có nhật ký hằng ngày đủ ngày đến lần cân gần nhất', m.fcrMissingDays === 0],
      ['Giá heo hơi tham chiếu', !m.missingMarket],
      ['Doanh thu bán đủ kg và giá', !m.unpricedSales],
      ['Heo nhập thêm có giá vốn/giá trị chuyển vào', !m.uncostedAdditions],
      ['Cân đối đàn không âm', !m.countNegative]
    ];
    const score = Math.round(completeness.filter(x => x[1]).length / completeness.length * 100);
    const costCategoryMap = new Map();
    const addCostCategory = (label, amount) => { if (num(amount) > 0) costCategoryMap.set(label, (costCategoryMap.get(label) || 0) + num(amount)); };
    addCostCategory('Thức ăn', periodFeedCost);
    addCostCategory('Con giống / vốn đầu kỳ', periodInitialCost);
    addCostCategory('Heo nhập thêm', periodAddedCost);
    reportCosts.forEach(c => addCostCategory(c.category || 'Khác', c.amount));
    const totalCostForChart = [...costCategoryMap.values()].reduce((a, v) => a + v, 0);
    const costCategoryRows = [...costCategoryMap.entries()].sort((a,b)=>b[1]-a[1]).map(([label,amount]) => `<div class="report-bar-row"><div class="report-bar-label"><span>${esc(label)}</span><strong>${money(amount)} <small>${totalCostForChart>0?fmt(amount/totalCostForChart*100,1)+'%':'0%'}</small></strong></div><div class="report-track"><div class="report-fill cost-fill" style="width:${totalCostForChart>0?Math.max(1,amount/totalCostForChart*100):0}%"></div></div></div>`).join('');
    const comparisonItems = [
      ['Doanh thu bán heo trong kỳ', periodSalesRevenue, 'revenue-fill'],
      ['Thu từ heo loại trong kỳ', periodCullRevenue, 'income-fill'],
      ['Tổng chi phí trong kỳ', periodTotalCosts, 'cost-fill'],
      ['Kết quả giao dịch trong kỳ', periodResult, periodResult >= 0 ? 'revenue-fill' : 'cost-fill']
    ];
    const compareMax = Math.max(1, ...comparisonItems.map(x=>Math.abs(num(x[1]))));
    const comparisonRows = comparisonItems.map(([label,amount,kind])=>`<div class="report-bar-row"><div class="report-bar-label"><span>${esc(label)}</span><strong>${amount<0?'−':''}${money(Math.abs(amount))}</strong></div><div class="report-track"><div class="report-fill ${kind}" style="width:${Math.abs(amount)>0?Math.max(1,Math.abs(num(amount))/compareMax*100):0}%"></div></div></div>`).join('');
    const daysInBatch = b.startDate ? Math.max(0, Math.floor((new Date(`${localDate()}T12:00:00`)-new Date(`${b.startDate}T12:00:00`))/86400000)+1) : 0;
    const deadTotal = sum(m.logs,'deadCount'); const cullTotal = sum(m.logs,'cullCount');
    const filterFromMin = b.startDate ? `min="${attr(b.startDate)}"` : '';
    return `${pageHead('Báo cáo lứa nuôi', `Báo cáo giao dịch theo kỳ và chỉ số kỹ thuật tích lũy của ${b.name}.`, `<button class="btn" id="exportReportCsv">⇩ Xuất CSV kỳ báo cáo</button><button class="btn" id="exportCsv">Xuất CSV nhật ký</button><button class="btn btn-primary" id="printReport">In / Lưu PDF</button>`)}
      <section class="card report-filter-card"><div class="card-heading"><div><h2>Kỳ báo cáo</h2><p>Lọc giao dịch, thức ăn, chi phí và nhật ký theo ngày.</p></div><span class="tag tag-gray">${periodDays} ngày</span></div><form id="reportFilterForm" class="filter-row"><div class="field"><label for="reportFrom">Từ ngày</label><input id="reportFrom" name="from" type="date" value="${attr(from)}" ${filterFromMin} max="${attr(localDate())}" required></div><div class="field"><label for="reportTo">Đến ngày</label><input id="reportTo" name="to" type="date" value="${attr(to)}" min="${attr(from)}" max="${attr(localDate())}" required></div><button class="btn btn-primary" type="submit">Áp dụng bộ lọc</button><button class="btn" type="button" data-reset-report-filter>Toàn bộ thời gian nuôi</button></form><div class="footnote">Kết quả giao dịch trong kỳ không bao gồm biến động giá trị đàn tồn. Chỉ số FCR, sinh khối hiện tại và lãi/lỗ kinh tế tích lũy được trình bày riêng theo dữ liệu toàn lứa đến nay.</div></section>
      <div class="kpi-grid period-summary-grid"><section class="card kpi"><div class="kpi-top">TỔNG CHI PHÍ TRONG KỲ <span class="kpi-icon">₫</span></div><div class="kpi-value">${shortMoney(periodTotalCosts)} <span class="unit">đ</span></div><div class="kpi-foot">${money(periodTotalCosts)} theo các khoản đã ghi</div></section><section class="card kpi"><div class="kpi-top">DOANH THU BÁN TRONG KỲ <span class="kpi-icon">↗</span></div><div class="kpi-value">${shortMoney(periodSalesRevenue)} <span class="unit">đ</span></div><div class="kpi-foot">${fmt(periodSalesCount,0)} con · ${fmt(periodSalesWeight,1)} kg</div></section><section class="card kpi"><div class="kpi-top">KẾT QUẢ GIAO DỊCH <span class="kpi-icon">◈</span></div><div class="kpi-value ${periodResult>=0?'profit-positive':'profit-negative'}">${periodResult<0?'−':''}${shortMoney(Math.abs(periodResult))} <span class="unit">đ</span></div><div class="kpi-foot">${periodResult<0?'Âm':'Dương'} trước thay đổi giá trị đàn tồn</div></section><section class="card kpi"><div class="kpi-top">THỨC ĂN TRONG KỲ <span class="kpi-icon">🌾</span></div><div class="kpi-value">${fmt(periodFeedKg,0)} <span class="unit">kg</span></div><div class="kpi-foot">Chi phí cám ${money(periodFeedCost)}</div></section></div>
      ${(rangeUnpricedSales || rangeMissingFeedPrice) ? `<div class="notice"><div>!</div><div><strong>Kỳ báo cáo có dữ liệu chưa đầy đủ</strong>${rangeUnpricedSales?'Có phiếu bán thiếu khối lượng hoặc đơn giá. ':''}${rangeMissingFeedPrice?'Có ngày dùng cám thiếu đơn giá. ':''}Kết quả giao dịch chưa phản ánh đầy đủ doanh thu hoặc chi phí; hãy bổ sung trước khi dùng cho quyết định tài chính.</div></div>` : ''}
      <div class="notice notice-blue"><div>i</div><div><strong>Kỳ giao dịch: ${esc(from)} đến ${esc(to)}</strong>FCR bên dưới là chỉ số của kỳ cân hợp lệ gần nhất, không tự động tính lại theo bộ lọc ngày. Giá trị đàn tồn và lãi/lỗ kinh tế tích lũy được tính đến lần ghi nhận hiện tại.</div></div>
      <section class="card report-batch-overview"><div class="card-heading"><div><h2>Thông tin lứa nuôi đến hiện tại</h2><p>Số lượng, sinh khối, các lần xuất đàn và thời gian theo dõi toàn lứa.</p></div><span class="tag tag-gray">${daysInBatch} ngày</span></div><div class="mini-stat-grid"><div class="mini-stat"><span>Số heo nhập đầu kỳ</span><strong>${fmt(b.initialCount,0)} con</strong></div><div class="mini-stat"><span>Sinh khối đầu kỳ</span><strong>${fmt(m.initialBiomass,1)} kg</strong></div><div class="mini-stat"><span>Heo đã bán</span><strong>${fmt(soldCountForBatch(b.id),0)} con</strong></div><div class="mini-stat"><span>Khối lượng đã bán</span><strong>${fmt(soldWeightForBatch(b.id,b.startDate||'',localDate()),1)} kg</strong></div><div class="mini-stat"><span>Heo chết</span><strong>${fmt(deadTotal,0)} con</strong></div><div class="mini-stat"><span>Heo loại/thải</span><strong>${fmt(cullTotal,0)} con</strong></div></div></section>
      <section class="card"><div class="card-heading"><div><h2>Tổng hợp kỹ thuật tích lũy</h2><p>Chỉ số dựa trên dữ liệu toàn lứa đến hiện tại, không phải chỉ riêng khoảng ngày đã lọc.</p></div>${statusTag(`Đủ trường dữ liệu: ${score}%`, score >= 85 ? 'green' : score >= 60 ? 'amber' : 'red')}</div><div class="mini-stat-grid"><div class="mini-stat"><span>Số con hiện tại</span><strong>${fmt(m.currentCount, 0)} con</strong></div><div class="mini-stat"><span>Sinh khối cuối kỳ ước tính</span><strong>${fmt(m.biomass, 1)} kg</strong></div><div class="mini-stat"><span>Sinh khối đầu kỳ</span><strong>${fmt(m.initialBiomass, 1)} kg</strong></div><div class="mini-stat"><span>Tổng thức ăn đã ghi</span><strong>${fmt(m.feedKg, 1)} kg</strong></div><div class="mini-stat"><span>Tăng trọng ròng kỳ FCR</span><strong>${fmt(m.fcrGain, 1)} kg</strong></div><div class="mini-stat"><span>FCR tích lũy ước tính</span><strong>${m.fcr === null ? 'Chưa tính được' : fmt(m.fcr, 3)}</strong></div><div class="mini-stat"><span>Chi phí cám/kg tăng trọng</span><strong>${m.feedCostPerKgGain === null ? 'Chưa tính được' : money(m.feedCostPerKgGain)}</strong></div><div class="mini-stat"><span>Lãi/lỗ/kg sinh khối còn</span><strong>${m.profitPerKgLiveweight === null ? 'Chưa tính được' : money(m.profitPerKgLiveweight)}</strong></div></div><div class="footnote">Công thức tăng trọng cân đối: sinh khối cuối + khối lượng bán + khối lượng chết/loại/chuyển ra − sinh khối đầu − khối lượng nhập thêm. Nếu thiếu khối lượng sự kiện, hệ thống có thể dùng trọng lượng bình quân gần nhất và sẽ cảnh báo.</div></section>
      <div class="grid content-grid" style="margin-top:15px"><section class="card"><div class="card-heading"><div><h2>Hiệu quả kinh tế tích lũy</h2><p>Định giá tồn đàn theo giá heo hơi tham chiếu hiện tại.</p></div></div><div class="progress-list"><div><div class="progress-label"><span>Doanh thu bán heo từ đầu lứa</span><strong>${money(m.salesRevenue)}</strong></div></div><div><div class="progress-label"><span>Thu từ heo loại</span><strong>${money(m.cullRevenue)}</strong></div></div><div><div class="progress-label"><span>Giá trị đàn tồn cuối kỳ</span><strong>${m.inventoryValue === null ? 'Chưa đủ dữ liệu' : money(m.inventoryValue)}</strong></div></div><div><div class="progress-label"><span>Vốn mua heo ban đầu</span><strong>${money(b.initialPurchaseCost)}</strong></div></div><div><div class="progress-label"><span>Chi phí thức ăn tích lũy</span><strong>${money(m.feedCost)}</strong></div></div><div><div class="progress-label"><span>Chi phí khác tích lũy</span><strong>${money(m.otherCosts)}</strong></div></div><div class="split-box"><span>LÃI/LỖ KINH TẾ ƯỚC TÍNH TÍCH LŨY</span><strong class="${m.profit === null ? '' : m.profit >= 0 ? 'profit-positive' : 'profit-negative'}">${m.profit === null ? `Chưa đủ dữ liệu · ${esc(m.profitIncompleteReason || '')}` : `${m.profit < 0 ? '−' : ''}${money(Math.abs(m.profit))}`}</strong></div></div><div class="footnote">Kết quả tích lũy = doanh thu bán + thu từ loại + giá trị đàn tồn − giá vốn đầu kỳ − chi phí cám − chi phí khác − giá vốn heo nhập thêm. Đây là chỉ số quản trị ước tính, không thay thế sổ kế toán/thuế.</div></section><section class="card"><div class="card-heading"><div><h2>Kiểm tra độ đầy đủ dữ liệu</h2><p>Các điều kiện cần đối chiếu trước khi dùng số liệu.</p></div></div>${completeness.map(([label, ok]) => `<div class="check-item"><span class="check-icon ${ok ? '' : 'pending'}">${ok ? '✓' : '!'}</span><div><strong>${esc(label)}</strong><small>${ok ? 'Đã có dữ liệu.' : 'Cần bổ sung hoặc xác minh.'}</small></div></div>`).join('')}<div class="footnote">Trạng thái “đã có” không bảo đảm dữ liệu đúng; cần đối chiếu sổ trại, phiếu cân, hóa đơn và giao dịch thực tế.</div></section></div>
      <div class="grid content-grid report-visual-grid" style="margin-top:15px"><section class="card"><div class="card-heading"><div><h2>Cơ cấu chi phí trong kỳ</h2><p>Tỷ trọng các khoản ghi nhận từ ${esc(from)} đến ${esc(to)}.</p></div></div>${costCategoryRows?`<div class="report-bars">${costCategoryRows}</div><div class="split-box"><span>TỔNG CHI PHÍ TRONG KỲ</span><strong>${money(totalCostForChart)}</strong></div>`:`<div class="empty"><h3>Chưa có chi phí trong kỳ</h3><p>Ghi cám, vốn heo hoặc chi phí phát sinh trong khoảng ngày đã chọn.</p></div>`}</section><section class="card"><div class="card-heading"><div><h2>Doanh thu, chi phí và kết quả kỳ</h2><p>Không đưa giá trị đàn tồn hiện tại vào kết quả giao dịch trong kỳ.</p></div></div><div class="report-bars">${comparisonRows}</div><div class="notice notice-blue report-chart-note"><div>i</div><div><strong>Phân biệt hai chỉ số</strong>Kết quả giao dịch kỳ không bao gồm thay đổi giá trị tồn đàn. Lãi/lỗ kinh tế tích lũy được hiển thị riêng ở phần trên và có tính giá trị đàn còn lại.</div></div></section></div>
      <div class="section-row"><h2>Chi tiết nhật ký thức ăn và biến động trong kỳ</h2><span class="tag tag-gray">${periodLogs.length} ngày có nhật ký</span></div><section class="card">${logRows ? `<div class="table-wrap"><table><thead><tr><th>NGÀY</th><th>CÁM THEO LOẠI / GIAI ĐOẠN</th><th class="num">TỔNG KG</th><th class="num">CHI PHÍ CÁM</th><th class="num">CHẾT</th><th class="num">LOẠI</th><th class="num">BÁN</th><th class="num">KG/CON*</th></tr></thead><tbody>${logRows}</tbody></table></div><div class="footnote">* Kg/con là trọng lượng ước tính trong nhật ký, không phải cân thực tế trừ khi ghi nhận riêng ở mục Cân heo.</div>` : `<div class="empty"><h3>Không có nhật ký trong kỳ đã chọn</h3><p>Thử mở rộng khoảng ngày hoặc tiếp tục nhập nhật ký hằng ngày.</p></div>`}</section>`;
  }

  function renderSettings() {
    const b = activeBatch();
    const status = b?.status || 'active';
    const restrictedFarmScope = !!(backendAvailable && serverReady && userInfo && userInfo.allFarms === false);
    const batchOptions = db.batches.map(x => `<option value="${attr(x.id)}" ${x.id === activeBatchId ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    const batchRows = db.batches.map(x => `<tr><td><div class="table-primary">${esc(x.name)}</div><div class="table-muted">${esc(x.startDate || 'Chưa khai báo ngày bắt đầu')} · ${esc(farmNameForBatch(x.id))}</div></td><td class="num">${fmt(x.initialCount, 0)} con</td><td class="num">${money(x.initialPurchaseCost)}</td><td>${x.status === 'closed' ? statusTag('Đã kết thúc') : statusTag('Đang nuôi', 'green')}</td><td><button class="btn btn-small" data-select-batch="${attr(x.id)}">Mở</button> ${x.status === 'closed' ? `<button class="btn btn-small" data-reopen-batch="${attr(x.id)}">Mở lại</button>` : `<button class="btn btn-small" data-close-batch="${attr(x.id)}">Kết thúc</button>`}</td></tr>`).join('');
    return `${pageHead('Cài đặt', 'Thông tin trang trại, lứa nuôi, giá heo hơi tham chiếu và sao lưu dữ liệu.')}
      ${restrictedFarmScope ? `<div class="notice notice-blue"><div>⌁</div><div><strong>Phạm vi truy cập có giới hạn</strong>Tài khoản này chỉ xem và cập nhật các trang trại được chủ workspace cấp quyền. Liên hệ chủ workspace để thay đổi phạm vi truy cập.</div></div>` : `<section class="card form-card" style="margin-bottom:16px"><div class="card-heading"><div><h2>Quản lý nhiều trang trại</h2><p>Mỗi trang trại có danh sách lứa nuôi riêng; các lứa và dữ liệu lịch sử được giữ lại khi chuyển trại.</p></div><span class="tag tag-green">${(db.settings.farms||[]).length} trang trại</span></div><form id="farmCreateForm" class="filter-row"><div class="field"><label>Tên trang trại mới</label><input name="newFarmName" maxlength="100" required placeholder="Ví dụ: Trại 2 · Khu B"></div><button type="submit" class="btn btn-primary">＋ Tạo trang trại</button></form><div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>TRANG TRẠI</th><th>SỐ LỨA</th><th></th></tr></thead><tbody>${(db.settings.farms||[]).map(f=>`<tr><td><strong>${esc(f.name)}</strong>${f.id===activeFarmId?' <span class="tag tag-green">Đang xem</span>':''}</td><td>${db.batches.filter(x=>x.farmId===f.id).length}</td><td><button type="button" class="btn btn-small" data-select-farm="${attr(f.id)}">Mở trại</button></td></tr>`).join('')}</tbody></table></div></section>`}
      <div class="settings-layout"><section class="card form-card"><h2>Thông tin trang trại</h2><p class="sub">Tên trang trại hiển thị ở thanh đầu ứng dụng.</p><form id="farmSettingsForm"><div class="field"><label for="farmName">Tên trang trại *</label><input id="farmName" name="farmName" value="${attr(currentFarm().name || db.settings.farmName || '')}" required maxlength="100"></div><div class="form-actions"><button class="btn btn-primary" type="submit">Lưu thông tin</button></div></form></section>
      <section class="card form-card"><h2>${b ? 'Thông tin lứa nuôi đang chọn' : 'Tạo lứa nuôi đầu tiên'}</h2><p class="sub">Vốn mua heo ban đầu cần được nhập để tính lãi/lỗ kinh tế.</p><form id="batchForm"><input type="hidden" name="batchId" value="${attr(b?.id || '')}"><div class="form-grid">
        <div class="field full"><label for="batchName">Tên lứa / ô chuồng *</label><input id="batchName" name="name" value="${attr(b?.name || '')}" placeholder="Ví dụ: Lứa heo thịt 01" required maxlength="100"></div>
        <div class="field"><label for="batchStart">Ngày bắt đầu *</label><input id="batchStart" name="startDate" type="date" value="${attr(b?.startDate || localDate())}" required></div>
        <div class="field"><label for="batchCount">Số heo đầu kỳ (con) *</label><input id="batchCount" name="initialCount" type="number" min="1" step="1" value="${attr(b?.initialCount ?? '')}" required></div>
        <div class="field"><label for="batchWeight">Trọng lượng đầu kỳ (kg/con) *</label><input id="batchWeight" name="initialAvgWeight" type="number" min="0.1" step="0.1" value="${attr(b?.initialAvgWeight ?? '')}" required></div>
        <div class="field"><label for="batchCost">Tổng tiền mua heo đầu kỳ (đồng) *</label><input id="batchCost" name="initialPurchaseCost" type="number" min="1" step="1" value="${attr(b?.initialPurchaseCost ?? '')}" required><span class="hint">Dùng cho công thức lãi/lỗ kinh tế. Nhập một lần.</span></div>
        <div class="field"><label for="marketPrice">Giá heo hơi tham chiếu hiện tại (đồng/kg)</label><input id="marketPrice" name="marketPrice" type="number" min="0" step="100" value="${attr(b?.marketPrice ?? '')}" placeholder="Ví dụ: 65000"><span class="hint">Cập nhật theo thị trường tại địa phương.</span></div>
        <div class="field full"><div class="notice notice-blue"><div>🌾</div><div><strong>Giá cám được quản lý theo từng sản phẩm và giai đoạn</strong>Thêm các mã cám và lịch sử giá tại danh mục cám bên dưới. Mỗi nhật ký ngày có thể dùng nhiều loại cám cùng lúc.</div></div></div>
      </div><div class="form-actions">${b ? '<button type="button" class="btn" data-go="dashboard">Hủy</button>' : ''}<button type="submit" class="btn btn-primary">${b ? 'Lưu thông tin lứa' : '＋ Tạo lứa nuôi'}</button></div></form></section></div>
      <div class="section-row"><h2>Danh mục cám và lịch sử giá</h2><span class="tag tag-gray">${db.feedTypes.length} sản phẩm</span></div>
      <div class="settings-layout feed-catalog-layout">${restrictedFarmScope ? `<section class="card"><h2>Danh mục cám dùng chung</h2><p class="sub">Bạn có thể chọn các sản phẩm cám trong nhật ký, nhưng chỉ tài khoản có quyền toàn trại mới được thay đổi danh mục và bảng giá dùng chung.</p></section>` : `<section class="card form-card"><h2 id="feedTypeFormTitle">Thêm sản phẩm cám</h2><p class="sub">Mỗi sản phẩm có thể có nhiều mức giá theo ngày hiệu lực. Lịch sử cũ được giữ nguyên.</p>
        <form id="feedTypeForm"><input type="hidden" name="feedTypeId" value=""><div class="form-grid">
          <div class="field"><label for="feedName">Tên cám / mã cám *</label><input id="feedName" name="feedName" required maxlength="100" placeholder="Ví dụ: Grower 20%"></div>
          <div class="field"><label for="feedStage">Giai đoạn sử dụng *</label><input id="feedStage" name="feedStage" required maxlength="80" placeholder="Úm / tập ăn / 25–50 kg / vỗ béo"></div>
          <div class="field"><label for="feedBrand">Hãng / nhà cung cấp</label><input id="feedBrand" name="feedBrand" maxlength="100" placeholder="Không bắt buộc"></div>
          <div class="field"><label for="feedPricePerKg">Đơn giá (đồng/kg) *</label><input id="feedPricePerKg" name="feedPricePerKg" type="number" min="1" step="1" required placeholder="Giá mua thực tế"></div>
          <div class="field"><label for="feedEffectiveDate">Ngày giá có hiệu lực *</label><input id="feedEffectiveDate" name="feedEffectiveDate" type="date" value="${localDate()}" required></div>
        </div><div class="form-actions"><button type="button" class="btn" data-reset-feed-type>Nhập mới</button><button type="submit" class="btn btn-primary">Lưu sản phẩm / cập nhật giá</button></div></form>
        <div class="footnote">Cập nhật giá không sửa lại đơn giá đã lưu trong nhật ký trước đó. Có thể nhập ngày hiệu lực trước hoặc sau hôm nay nếu đang nhập dữ liệu lịch sử/kế hoạch; nhật ký chỉ áp dụng giá có hiệu lực tại ngày ghi nhận.</div>
      </section>`}<section class="card"><div class="card-heading"><div><h2>Các sản phẩm cám</h2><p>Chọn “Sửa / cập nhật giá” để thêm giá mới cho sản phẩm hiện có.</p></div></div>
        ${db.feedTypes.length ? `<div class="table-wrap"><table><thead><tr><th>SẢN PHẨM</th><th>GIAI ĐOẠN</th><th>HÃNG</th><th class="num">GIÁ HIỆN HÀNH</th><th>HIỆU LỰC TỪ</th><th></th></tr></thead><tbody>${db.feedTypes.slice().sort((a,b)=>(a.stage||'').localeCompare(b.stage||'')||(a.name||'').localeCompare(b.name||'')).map(t=>{const pr=priceForFeedType(t,localDate());const latest=priceHistoryFor(t).slice(-1)[0];return `<tr class="${t.active===false?'feed-inactive':''}"><td><div class="table-primary">${esc(t.name)}</div><div class="table-muted">${t.active===false?'Đã ngừng sử dụng':'Đang sử dụng'}</div></td><td>${esc(t.stage||'—')}</td><td>${esc(t.brand||'—')}</td><td class="num">${pr?money(pr.unitPrice):'Chưa có giá'}</td><td>${pr?esc(pr.effectiveFrom):latest?`Giá tiếp theo: ${esc(latest.effectiveFrom)}`:'—'}</td><td>${restrictedFarmScope ? '<span class="tag tag-gray">Chỉ xem</span>' : `<button type="button" class="btn btn-small" data-edit-feed-type="${attr(t.id)}">Sửa / cập nhật giá</button> ${t.active===false?`<button type="button" class="btn btn-small" data-activate-feed-type="${attr(t.id)}">Kích hoạt</button>`:`<button type="button" class="btn btn-small" data-deactivate-feed-type="${attr(t.id)}">Ngừng dùng</button>`}`}</td></tr>`}).join('')}</tbody></table></div>` : `<div class="empty"><div class="empty-icon">🌾</div><h3>Chưa có danh mục cám</h3><p>Thêm cám theo giai đoạn và nhập giá mua để dùng trong nhật ký hằng ngày.</p></div>`}
      </section></div>
      ${db.feedTypes.some(t=>priceHistoryFor(t).length>1)?`<section class="card" style="margin-top:14px"><div class="card-heading"><div><h2>Lịch sử thay đổi giá</h2><p>Các mức giá được giữ theo ngày hiệu lực.</p></div></div><div class="table-wrap"><table><thead><tr><th>SẢN PHẨM</th><th>GIAI ĐOẠN</th><th>HIỆU LỰC TỪ</th><th class="num">GIÁ (ĐỒNG/KG)</th></tr></thead><tbody>${db.feedTypes.flatMap(t=>priceHistoryFor(t).map(p=>({t,p}))).sort((a,b)=>b.p.effectiveFrom.localeCompare(a.p.effectiveFrom)).map(({t,p})=>`<tr><td>${esc(t.name)}</td><td>${esc(t.stage||'—')}</td><td>${esc(p.effectiveFrom)}</td><td class="num">${money(p.unitPrice)}</td></tr>`).join('')}</tbody></table></div></section>`:''}
      <div class="section-row"><h2>Quản lý các lứa nuôi</h2><span class="tag tag-gray">${db.batches.length} lứa</span></div><section class="card">${batchRows ? `<div class="table-wrap"><table><thead><tr><th>LỨA NUÔI</th><th class="num">SỐ CON ĐẦU KỲ</th><th class="num">VỐN MUA HEO</th><th>TRẠNG THÁI</th><th></th></tr></thead><tbody>${batchRows}</tbody></table></div>` : `<div class="empty"><h3>Chưa có lứa nuôi</h3><p>Tạo lứa đầu tiên từ biểu mẫu phía trên.</p></div>`}</section>
      ${storageGet('pigprofit_ai_pre_sync_backup_v1') ? `<div class="notice notice-blue"><div>↶</div><div><strong>Có bản sao dữ liệu cục bộ chưa nhập</strong><p>Bản sao này được giữ khi dữ liệu trên thiết bị chưa được nhập vào workspace. Bạn có thể tải riêng tệp JSON để lưu trữ hoặc phục hồi có chủ đích.</p><button type="button" class="btn btn-small" id="downloadPreSyncBackup">Tải bản sao dữ liệu cục bộ</button></div></div>` : ''}
      <div class="section-row"><h2>Sao lưu và khôi phục</h2></div><section class="card"><div class="settings-actions"><div class="settings-action"><div><strong>Xuất bản sao lưu đầy đủ (JSON)</strong><p>Bao gồm lứa nuôi, nhật ký, cân heo, chi phí và cài đặt.</p></div><button class="btn btn-primary" id="exportJson">Xuất JSON ⇩</button></div><div class="settings-action"><div><strong>Khôi phục từ bản sao lưu</strong><p>Thay toàn bộ dữ liệu hiện tại bằng tệp JSON đã xuất trước đó.</p></div><button class="btn" id="importJson">Chọn tệp</button></div><div class="settings-action"><div><strong>Xuất báo cáo nhật ký CSV</strong><p>Mở bằng Excel hoặc Google Sheets để đối chiếu sổ trại.</p></div><button class="btn" id="exportCsvSettings">Xuất CSV ⇩</button></div></div><div class="notice" style="margin:14px 0 0"><div>!</div><div><strong>${backendAvailable && serverReady ? 'Dữ liệu đang đồng bộ lên workspace' : 'Dữ liệu cục bộ cần được sao lưu'}</strong>${backendAvailable && serverReady ? 'Bản ghi được đồng bộ đến máy chủ của workspace sau khi lưu. Tải bản sao lưu định kỳ vẫn được khuyến nghị.' : 'Trong chế độ chạy độc lập, dữ liệu chỉ lưu trên trình duyệt. Khi đổi thiết bị, cần khôi phục từ tệp JSON.'}</div></div></section>
      <div class="section-row"><h2>Trạng thái ứng dụng</h2></div><section class="card"><div class="check-item"><span class="check-icon">✓</span><div><strong>Phiên bản dữ liệu: ${db.version || 1}</strong><small>Ngày cập nhật cục bộ: ${esc((db.updatedAt || '').replace('T', ' ').slice(0, 19) || 'Chưa xác định')}</small></div></div><div class="check-item"><span class="check-icon">✓</span><div><strong>${backendAvailable && serverReady ? 'Đồng bộ backend hoạt động' : 'Lưu cục bộ'}</strong><small>${backendAvailable && serverReady ? `Workspace: ${esc(userInfo?.tenantName || '')} · Người dùng: ${esc(userInfo?.email || '')}` : 'Chưa kết nối tài khoản máy chủ trong phiên này.'}</small></div></div><div class="check-item"><span class="check-icon pending">!</span><div><strong>${backendAvailable ? 'Tài khoản và đồng bộ workspace' : 'Chưa cấu hình backend'}</strong><small>${backendAvailable ? 'Mỗi workspace có dữ liệu được cách ly; chủ workspace có thể thêm tài khoản thành viên. Bản này chưa tích hợp Zalo/SMS/push tự động.' : 'Khi chạy qua server.py, đăng nhập, phân quyền và đồng bộ máy chủ sẽ được bật.'}</small></div></div></section>${renderTeamSection()}`;
  }

  function render() {
    $$('.nav-item[data-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === activeTab));
    const moreToggle = $('[data-more-nav]');
    if (moreToggle) moreToggle.classList.toggle('active', ['sales', 'pigs', 'settings'].includes(activeTab));
    const main = $('#mainContent');
    main.dataset.editDate = '';
    switch (activeTab) {
      case 'daily': main.innerHTML = renderDaily(); break;
      case 'weighing': main.innerHTML = renderWeighing(); break;
      case 'costs': main.innerHTML = renderCosts(); break;
      case 'sales': main.innerHTML = renderSales(); break;
      case 'pigs': main.innerHTML = renderPigs(); break;
      case 'reports': main.innerHTML = renderReports(); break;
      case 'settings': main.innerHTML = renderSettings(); break;
      default: activeTab = 'dashboard'; main.innerHTML = renderDashboard(); break;
    }
    $$('.nav-item[data-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === activeTab));
    const moreMenu = $('#navMoreMenu');
    if (moreMenu) moreMenu.hidden = true;
    if (moreToggle) moreToggle.setAttribute('aria-expanded', 'false');
    syncContext();
  }
  function goTab(tab) {
    if (!['dashboard', 'daily', 'weighing', 'costs', 'sales', 'pigs', 'reports', 'settings'].includes(tab)) return;
    if(tab!=='pigs') stopQrScanner();
    if(tab!=='sales') $('#mainContent').dataset.editSale='';
    if(tab!=='pigs') $('#mainContent').dataset.editPig='';
    activeTab = tab;
    $('#mainContent').dataset.editDate = '';
    render();
    $('#mainContent').focus({ preventScroll: true });
  }
  function formObject(form) { return Object.fromEntries(new FormData(form).entries()); }
  function readNum(obj, key) { return obj[key] === '' || obj[key] == null ? 0 : num(obj[key]); }
  function validateNonNegative(obj, fields) { return fields.every(k => obj[k] === '' || obj[k] == null || (Number.isFinite(Number(obj[k])) && Number(obj[k]) >= 0)); }

  function saveDaily(form) {
    const b = activeBatch(); if (!b) { toast('Hãy tạo lứa nuôi trước.', 'error'); return; }
    const d = formObject(form);
    let feedItems;
    try { feedItems = captureFeedLines(form, d.date); } catch (err) { toast(err.message || 'Kiểm tra danh mục cám.', 'error'); return; }
    const totalFeedKg = sum(feedItems, 'quantityKg');
    const totalFeedCost = sum(feedItems, x => num(x.quantityKg) * num(x.unitPricePerKg));
    const averageFeedPrice = totalFeedKg > 0 ? totalFeedCost / totalFeedKg : 0;
    const nonnegative = ['estimatedAvgWeight','deadCount','deadAvgWeight','cullCount','cullWeightTotal','cullRevenue','soldCount','soldWeightTotal','salePricePerKg','transferOutCount','transferOutWeightTotal','addedCount','addedWeightTotal','addedCost'];
    if (!d.date || !validateNonNegative(d, nonnegative)) { toast('Kiểm tra ngày và nhập số không âm cho các trường số.', 'error'); return; }
    if (b.startDate && d.date < b.startDate) { toast('Ngày nhật ký không thể trước ngày bắt đầu lứa nuôi.', 'error'); return; }
    if (d.date > localDate()) { toast('Không thể ghi nhật ký cho ngày trong tương lai.', 'error'); return; }
    for (const k of ['deadCount','cullCount','soldCount','transferOutCount','addedCount']) if (!Number.isInteger(num(d[k]))) { toast('Số heo phải là số nguyên.', 'error'); return; }
    if(hasSalesTickets(b.id,d.date)&&num(d.soldCount)>0){toast('Ngày này đã có phiếu bán riêng. Hãy ghi doanh thu tại mục Doanh thu/xuất bán để tránh tính trùng.','error');return;}
    const otherDailyForDay = logsFor(b.id).filter(l => l.date === d.date && l.id !== d.id)[0];
    if (otherDailyForDay) {
      const ok = window.confirm(`Đã có nhật ký cho ngày ${d.date}. Thay thế bản ghi hiện có bằng dữ liệu này?`);
      if (!ok) return;
      d.id = otherDailyForDay.id;
      db.logs = db.logs.filter(l => l.id !== otherDailyForDay.id);
    }
    const record = {
      id: d.id || id(), batchId: b.id, date: d.date, feedRecorded: true,
      feedItems, feedKg: totalFeedKg, feedPricePerKg: averageFeedPrice,
      estimatedAvgWeight: readNum(d, 'estimatedAvgWeight'), deadCount: readNum(d, 'deadCount'), deadAvgWeight: readNum(d, 'deadAvgWeight'),
      cullCount: readNum(d, 'cullCount'), cullWeightTotal: readNum(d, 'cullWeightTotal'), cullRevenue: readNum(d, 'cullRevenue'),
      soldCount: readNum(d, 'soldCount'), soldWeightTotal: readNum(d, 'soldWeightTotal'), salePricePerKg: readNum(d, 'salePricePerKg'),
      transferOutCount: readNum(d, 'transferOutCount'), transferOutWeightTotal: readNum(d, 'transferOutWeightTotal'),
      addedCount: readNum(d, 'addedCount'), addedWeightTotal: readNum(d, 'addedWeightTotal'), addedCost: readNum(d, 'addedCost'), notes: (d.notes || '').trim(), updatedAt: new Date().toISOString()
    };
    if (record.soldCount > 0 && record.soldWeightTotal <= 0) { if (!window.confirm('Bạn đã nhập số heo bán nhưng chưa nhập tổng kg bán. Tiếp tục sẽ làm doanh thu và FCR thiếu chính xác.')) return; }
    if (record.soldWeightTotal > 0 && record.salePricePerKg <= 0) { if (!window.confirm('Chưa có giá bán thực tế. Tiếp tục sẽ làm thiếu doanh thu.')) return; }
    if (record.addedCount > 0 && record.addedWeightTotal <= 0) { if (!window.confirm('Heo nhập thêm chưa có tổng khối lượng. FCR tích lũy có thể sai. Vẫn lưu?')) return; }
    if (record.addedCount > 0 && record.addedCost <= 0) { if (!window.confirm('Heo nhập thêm chưa có giá vốn/giá trị chuyển vào. Lãi/lỗ sẽ không được hiển thị cho đến khi bổ sung. Vẫn lưu?')) return; }
    if (record.feedItems.some(item => num(item.quantityKg) > 0 && !(num(item.unitPricePerKg) > 0))) { if (!window.confirm('Có dòng cám chưa có đơn giá lớn hơn 0. Chi phí thức ăn và lãi/lỗ sẽ chưa đầy đủ. Bạn vẫn muốn lưu nhật ký này?')) return; }
    const updatedIndex = db.logs.findIndex(l => l.id === record.id);
    if (updatedIndex >= 0) db.logs[updatedIndex] = record; else db.logs.push(record);
    saveDB(); toast('Đã lưu nhật ký ngày. Các chỉ số đã được tính lại.'); goTab('daily');
  }
  function saveWeighing(form) {
    const b = activeBatch(); if (!b) return;
    const d = formObject(form);
    if (!d.date || !(num(d.avgWeight) > 0) || num(d.sampleCount) < 0) { toast('Nhập ngày cân, trọng lượng dương và số con cân hợp lệ.', 'error'); return; }
    if (d.date > localDate() || (b.startDate && d.date < b.startDate)) { toast('Ngày cân phải nằm trong thời gian nuôi và không ở tương lai.', 'error'); return; }
    if (d.method === 'actual' && num(d.sampleCount) <= 0) { toast('Với cân thực tế, hãy nhập số con đã cân.', 'error'); return; }
    if (d.method === 'sample' && num(d.sampleCount) <= 0) { toast('Cân mẫu cần ghi số con thực tế đã lấy mẫu.', 'error'); return; }
    const existing = weightsFor(b.id).find(w => w.date === d.date);
    if (existing) {
      if (!window.confirm(`Lứa này đã có lần cân ngày ${d.date}. Thay thế bản ghi cân ngày đó?`)) return;
      db.weighings = db.weighings.filter(w => w.id !== existing.id);
    }
    db.weighings.push({ id: id(), batchId: b.id, date: d.date, method: d.method, sampleCount: readNum(d, 'sampleCount'), avgWeight: readNum(d, 'avgWeight'), notes: (d.notes || '').trim(), createdAt: new Date().toISOString() });
    saveDB(); toast('Đã lưu lần cân.'); goTab('weighing');
  }
  function saveCost(form) {
    const b = activeBatch(); if (!b) return;
    const d = formObject(form);
    if (!d.date || !(num(d.amount) > 0) || !d.category) { toast('Nhập ngày, loại chi phí và số tiền lớn hơn 0.', 'error'); return; }
    if (d.date > localDate() || (b.startDate && d.date < b.startDate)) { toast('Ngày phát sinh chi phí phải nằm trong thời gian nuôi và không ở tương lai.', 'error'); return; }
    db.costs.push({ id: id(), batchId: b.id, date: d.date, category: d.category, amount: num(d.amount), description: (d.description || '').trim(), createdAt: new Date().toISOString() });
    saveDB(); costView={from:'',to:'',category:'all'}; toast('Đã lưu khoản chi phí.'); goTab('costs');
  }
  function saveBatch(form) {
    const d = formObject(form);
    if (!d.name?.trim() || !d.startDate || !(num(d.initialCount) > 0) || !Number.isInteger(num(d.initialCount)) || !(num(d.initialAvgWeight) > 0) || !(num(d.initialPurchaseCost) > 0)) {
      toast('Cần nhập tên lứa, ngày bắt đầu, số con nguyên dương, khối lượng đầu kỳ và tổng tiền mua heo.', 'error'); return;
    }
    if (d.startDate > localDate()) { toast('Ngày bắt đầu lứa không thể ở tương lai.', 'error'); return; }
    if (num(d.marketPrice) < 0 || num(d.defaultFeedPrice) < 0) { toast('Giá không thể là số âm.', 'error'); return; }
    if (d.batchId) {
      const b = db.batches.find(x => x.id === d.batchId); if (!b) return;
      Object.assign(b, { name: d.name.trim(), startDate: d.startDate, initialCount: num(d.initialCount), initialAvgWeight: num(d.initialAvgWeight), initialPurchaseCost: num(d.initialPurchaseCost), marketPrice: num(d.marketPrice), defaultFeedPrice: d.defaultFeedPrice === undefined || d.defaultFeedPrice === '' ? num(b.defaultFeedPrice) : num(d.defaultFeedPrice), updatedAt: new Date().toISOString() });
      saveDB(); toast('Đã cập nhật thông tin lứa nuôi.');
    } else {
      const b = { id: id(), farmId: activeFarmId || currentFarm().id, name: d.name.trim(), startDate: d.startDate, initialCount: num(d.initialCount), initialAvgWeight: num(d.initialAvgWeight), initialPurchaseCost: num(d.initialPurchaseCost), marketPrice: num(d.marketPrice), defaultFeedPrice: num(d.defaultFeedPrice), status: 'active', createdAt: new Date().toISOString() };
      db.batches.push(b); activeBatchId = b.id;
      saveDB(); toast('Đã tạo lứa nuôi. Bây giờ hãy nhập nhật ký ngày.');
    }
    render();
  }
  function saveFeedType(form) {
    const d = formObject(form);
    const name = (d.feedName || '').trim();
    const stage = (d.feedStage || '').trim();
    const brand = (d.feedBrand || '').trim();
    const price = num(d.feedPricePerKg);
    const effectiveFrom = d.feedEffectiveDate;
    if (!name || !stage || !effectiveFrom || !(price > 0) || !Number.isFinite(price)) {
      toast('Nhập tên cám, giai đoạn, ngày hiệu lực và đơn giá lớn hơn 0.', 'error'); return;
    }
    let type = d.feedTypeId ? feedTypeById(d.feedTypeId) : null;
    if (type) {
      type.name = name; type.stage = stage; type.brand = brand;
      type.priceHistory = priceHistoryFor(type);
      const sameDate = type.priceHistory.find(p => p.effectiveFrom === effectiveFrom);
      if (sameDate) sameDate.unitPrice = price;
      else type.priceHistory.push({ effectiveFrom, unitPrice: price });
      type.priceHistory.sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
      type.active = true;
      type.updatedAt = new Date().toISOString();
      toast(`Đã cập nhật ${name}; lịch sử giá được giữ theo ngày hiệu lực.`);
    } else {
      const duplicate = db.feedTypes.find(t => t.active !== false && t.name.toLowerCase() === name.toLowerCase() && (t.stage || '').toLowerCase() === stage.toLowerCase() && (t.brand || '').toLowerCase() === brand.toLowerCase());
      if (duplicate && !window.confirm(`Đã có sản phẩm “${duplicate.name}” ở giai đoạn “${duplicate.stage}”. Bạn có muốn cập nhật giá sản phẩm đó thay vì tạo sản phẩm trùng?`)) return;
      if (duplicate) {
        type = duplicate;
        type.priceHistory = priceHistoryFor(type);
        const sameDate = type.priceHistory.find(p => p.effectiveFrom === effectiveFrom);
        if (sameDate) sameDate.unitPrice = price; else type.priceHistory.push({ effectiveFrom, unitPrice: price });
        type.priceHistory.sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
        type.active = true; type.updatedAt = new Date().toISOString();
        toast(`Đã cập nhật giá cho ${type.name}.`);
      } else {
        db.feedTypes.push({ id: id(), name, stage, brand, active: true, priceHistory: [{ effectiveFrom, unitPrice: price }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        toast(`Đã thêm sản phẩm cám ${name}.`);
      }
    }
    saveDB(); render();
  }
  function toggleFeedType(typeId, active) {
    const type = feedTypeById(typeId); if (!type) return;
    if (!active && !window.confirm(`Ngừng sử dụng “${type.name}”? Các nhật ký cũ vẫn được giữ nguyên; sản phẩm sẽ không dùng để tạo dòng cám mới.`)) return;
    type.active = active; type.updatedAt = new Date().toISOString(); saveDB(); render();
    toast(active ? 'Đã kích hoạt lại sản phẩm cám.' : 'Đã ngừng sử dụng sản phẩm cám.');
  }
  function updateFarm(form) {
    const d = formObject(form); if (!d.farmName?.trim()) { toast('Tên trang trại không được để trống.', 'error'); return; }
    const farm = currentFarm(); farm.name = d.farmName.trim(); db.settings.farmName = farm.name; farm.updatedAt = new Date().toISOString(); saveDB(); syncContext(); toast('Đã lưu tên trang trại.'); render();
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }
  function exportJSON() {
    const payload = { ...db, exportedAt: new Date().toISOString(), app: 'PigProfit AI', schemaVersion: 4 };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }), `pigprofit-ai-backup-${localDate()}.json`);
    toast('Đã tạo tệp sao lưu JSON. Hãy lưu ở nơi an toàn.');
  }
  function csvCell(value) { let s = String(value ?? ''); if (/^[=+@\-\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; }
  function exportCSV() {
    const rows = [['Trang trại','Mã lứa','Tên lứa','Ngày','Chi tiết các loại cám','Tổng thức ăn kg','Giá cám bình quân gia quyền đồng/kg','Chi phí cám đồng','Trọng lượng ước tính kg/con','Chết con','Cân nặng chết kg/con','Loại con','Khối lượng loại kg','Thu từ loại đồng','Bán con','Khối lượng bán kg','Giá bán đồng/kg','Chuyển ra con','Khối lượng chuyển ra kg','Nhập thêm con','Khối lượng nhập kg','Giá vốn heo nhập thêm đồng','Ghi chú']];
    db.logs.forEach(l => {
      const b = db.batches.find(x => x.id === l.batchId);
      rows.push([farmNameForBatch(l.batchId), l.batchId, b?.name || '', l.date, feedSummaryForLog(l), feedKgForLog(l), feedKgForLog(l) > 0 ? feedCostForLog(l) / feedKgForLog(l) : 0, feedCostForLog(l), l.estimatedAvgWeight, l.deadCount, l.deadAvgWeight, l.cullCount, l.cullWeightTotal, l.cullRevenue, l.soldCount, l.soldWeightTotal, l.salePricePerKg, l.transferOutCount, l.transferOutWeightTotal, l.addedCount, l.addedWeightTotal, l.addedCost, l.notes]);
    });
    const csv = '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `pigprofit-ai-nhat-ky-${localDate()}.csv`);
    toast('Đã xuất CSV nhật ký.');
  }
  function exportReportCSV() {
    const b = activeBatch();
    if (!b) { toast('Hãy chọn một lứa nuôi trước khi xuất báo cáo.', 'error'); return; }
    if (reportView.batchId !== b.id) reportView = { batchId: b.id, from: b.startDate || localDate(), to: localDate() };
    const from = reportView.from || b.startDate || localDate();
    const to = reportView.to || localDate();
    const inRange = date => !!date && date >= from && date <= to;
    const rows = [['Trang trại','Mã lứa','Tên lứa','Kỳ từ ngày','Kỳ đến ngày','Ngày giao dịch','Loại giao dịch','Nội dung','Số lượng','Đơn vị','Đơn giá đồng','Thành tiền đồng','Ghi chú']];
    const logs = logsAfterStart(b).filter(l => inRange(l.date));
    for (const l of logs) {
      const kg = feedKgForLog(l), feedCost = feedCostForLog(l);
      rows.push([farmNameForBatch(b.id),b.id,b.name,from,to,l.date,'Thức ăn',feedSummaryForLog(l),kg,'kg',kg>0?feedCost/kg:0,feedCost,l.notes||'']);
      if (num(l.deadCount)>0) rows.push([farmNameForBatch(b.id),b.id,b.name,from,to,l.date,'Heo chết',`${fmt(l.deadCount,0)} con`,l.deadCount,'con',0,0,`Khối lượng chết ghi nhận: ${num(l.deadAvgWeight)||0} kg/con; ${l.notes||''}`]);
      if (num(l.cullCount)>0) rows.push([farmNameForBatch(b.id),b.id,b.name,from,to,l.date,'Heo loại/thải','Heo loại',l.cullCount,'con',0,num(l.cullRevenue),l.notes||'']);
      if (num(l.addedCount)>0) rows.push([farmNameForBatch(b.id),b.id,b.name,from,to,l.date,'Nhập thêm','Heo nhập thêm',l.addedCount,'con',0,num(l.addedCost),l.notes||'']);
      if (num(l.transferOutCount)>0) rows.push([farmNameForBatch(b.id),b.id,b.name,from,to,l.date,'Chuyển đàn','Heo chuyển ra',l.transferOutCount,'con',0,0,l.notes||'']);
      if (num(l.soldCount)>0 && !hasSalesTickets(b.id,l.date)) rows.push([farmNameForBatch(b.id),b.id,b.name,from,to,l.date,'Bán heo (nhật ký cũ)','Bán từ nhật ký',l.soldCount,'con',num(l.salePricePerKg),num(l.soldWeightTotal)*num(l.salePricePerKg),l.notes||'']);
    }
    for (const c of costsFor(b.id).filter(x=>inRange(x.date))) rows.push([farmNameForBatch(b.id),b.id,b.name,from,to,c.date,'Chi phí',c.category||'Khác',1,'khoản',num(c.amount),num(c.amount),c.description||'']);
    for (const sale of salesFor(b.id).filter(x=>inRange(x.date))) rows.push([farmNameForBatch(b.id),b.id,b.name,from,to,sale.date,'Doanh thu bán heo',`${sale.buyer||'Khách mua'} · ${sale.reference||'Phiếu bán'}`,num(sale.count),'con',num(sale.pricePerKg),num(sale.totalWeightKg)*num(sale.pricePerKg),sale.notes||'']);
    const csv = '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `pigprofit-ai-bao-cao-${b.id}-${from}-${to}.csv`);
    toast(`Đã xuất báo cáo ${from} đến ${to}.`);
  }

  function exportSalesCSV() {
    const rows=[['Trang trại','Mã lứa','Tên lứa','Ngày bán','Số con','Tổng khối lượng kg','Giá bán đồng/kg','Doanh thu đồng','Khách mua','Mã phiếu','Ghi chú','Nguồn']];
    db.sales.forEach(x=>{const b=db.batches.find(z=>z.id===x.batchId);rows.push([farmNameForBatch(x.batchId),x.batchId,b?.name||'',x.date,x.count,x.totalWeightKg,x.pricePerKg,num(x.totalWeightKg)*num(x.pricePerKg),x.buyer,x.reference,x.notes,x.sourcePigId?'QR':'Phiếu bán']);});
    const csv='\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');downloadBlob(new Blob([csv],{type:'text/csv;charset=utf-8'}),`pigprofit-ai-doanh-thu-${localDate()}.csv`);toast('Đã xuất CSV doanh thu.');
  }
  function exportPigsCSV() {
    const rows=[['Trang trại','Mã lứa','Tên lứa','Mã heo','Ô chuồng','Tình trạng','Trọng lượng kg','Ngày cân','Ngày sự kiện','Giá bán/kg','Ghi chú','Số lần cân']];
    db.pigs.forEach(x=>{const b=db.batches.find(z=>z.id===x.batchId);rows.push([farmNameForBatch(x.batchId),x.batchId,b?.name||'',x.tag,x.pen,statusName(x.status),x.weightKg,x.weightDate,x.statusDate,x.salePricePerKg,x.notes,(x.weightHistory||[]).length]);});
    const csv='\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');downloadBlob(new Blob([csv],{type:'text/csv;charset=utf-8'}),`pigprofit-ai-ho-so-heo-${localDate()}.csv`);toast('Đã xuất CSV hồ sơ heo.');
  }
  function importJSONFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result || ''));
        if (!obj || !Array.isArray(obj.batches) || !Array.isArray(obj.logs) || !Array.isArray(obj.weighings) || !Array.isArray(obj.costs) || !obj.settings) throw new Error('Cấu trúc không đúng');
        if (!window.confirm(`Tệp có ${obj.batches.length} lứa, ${obj.logs.length} nhật ký, ${obj.weighings.length} lần cân và ${obj.costs.length} khoản chi. Khôi phục sẽ THAY THẾ toàn bộ dữ liệu hiện tại. Tiếp tục?`)) return;
        db = applySnapshotData({ ...obj, version: 4, settings: obj.settings, batches: obj.batches, feedTypes: Array.isArray(obj.feedTypes) ? obj.feedTypes : [], logs: obj.logs, weighings: obj.weighings, costs: obj.costs, sales: Array.isArray(obj.sales) ? obj.sales : [], pigs: Array.isArray(obj.pigs) ? obj.pigs : [], createdAt: obj.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() });
        activeFarmId = db.settings.farms?.[0]?.id || '';
        activeBatchId = db.batches.find(b => b.farmId === activeFarmId)?.id || '';
        storageSet(ACTIVE_FARM_KEY, activeFarmId);
        saveDB(); render(); toast('Khôi phục dữ liệu thành công. Hãy kiểm tra các lứa và báo cáo.');
      } catch (e) { toast('Không thể khôi phục: tệp JSON sai định dạng hoặc không phải bản sao lưu PigProfit AI.', 'error'); }
      $('#importFile').value = '';
    };
    reader.onerror = () => toast('Không đọc được tệp.', 'error');
    reader.readAsText(file);
  }
  function printReport() { window.print(); }
  function doDelete(token) {
    const [type, recordId] = token.split(':');
    if (!window.confirm('Bạn chắc chắn muốn xóa bản ghi này? Thao tác này không thể hoàn tác trừ khi có bản sao lưu.')) return;
    if (type === 'log') db.logs = db.logs.filter(x => x.id !== recordId);
    else if (type === 'weighing') db.weighings = db.weighings.filter(x => x.id !== recordId);
    else if (type === 'cost') db.costs = db.costs.filter(x => x.id !== recordId);
    else if (type === 'sale') { const sale=db.sales.find(x=>x.id===recordId); if(sale?.sourcePigId) { toast('Phiếu bán gắn với hồ sơ QR; không xóa trực tiếp để tránh lệch cân đối đàn.', 'error'); return; } db.sales = db.sales.filter(x=>x.id!==recordId); }
    else if (type === 'pig') { const pig=db.pigs.find(x=>x.id===recordId); if(pig && ['sold','dead','culled'].includes(pig.status)) { toast('Không thể xóa hồ sơ đã kết thúc; hãy giữ lịch sử để truy xuất.', 'error'); return; } db.pigs=db.pigs.filter(x=>x.id!==recordId); }
    saveDB(); toast('Đã xóa bản ghi.'); render();
  }

  document.addEventListener('click', event => {
    const alertFilterButton = event.target.closest('[data-alert-filter]');
    if (alertFilterButton) { dashboardAlertFilter = alertFilterButton.dataset.alertFilter || 'all'; render(); return; }
    if (event.target.closest('[data-add-feed-line]')) { addFeedLine(); return; }
    const removeFeed = event.target.closest('[data-remove-feed-line]');
    if (removeFeed) {
      const row = removeFeed.closest('[data-feed-line]'); row?.remove();
      if (!$$('[data-feed-line]', $('#feedLines') || document).length) addFeedLine();
      updateFeedTotals(); return;
    }
    const editFeedType = event.target.closest('[data-edit-feed-type]');
    if (editFeedType) { renderFeedTypeFormFor(editFeedType.dataset.editFeedType); return; }
    const deactivateFeedType = event.target.closest('[data-deactivate-feed-type]');
    if (deactivateFeedType) { if(readOnlyMode){toast('Tài khoản chỉ xem không thể sửa danh mục.','error');return;} toggleFeedType(deactivateFeedType.dataset.deactivateFeedType, false); return; }
    const activateFeedType = event.target.closest('[data-activate-feed-type]');
    if (activateFeedType) { if(readOnlyMode){toast('Tài khoản chỉ xem không thể sửa danh mục.','error');return;} toggleFeedType(activateFeedType.dataset.activateFeedType, true); return; }
    if (event.target.closest('[data-reset-feed-type]')) { resetFeedTypeForm(); return; }
    if(event.target.closest('[data-reset-cost-filter]')) { costView={from:'',to:'',category:'all'}; render(); return; }
    if(event.target.closest('[data-reset-report-filter]')) { const b=activeBatch(); reportView={batchId:b?.id||'',from:b?.startDate||localDate(),to:localDate()}; render(); return; }
    if(event.target.closest('[data-reset-sale]')) { $('#mainContent').dataset.editSale=''; render(); return; }
    if(event.target.closest('[data-reset-pig]')) { $('#mainContent').dataset.editPig=''; render(); return; }
    if(event.target.closest('[data-reset-pig-search]')) { pigSearchTerm=''; pigStatusFilter='all'; render(); return; }
    const editSale=event.target.closest('button[data-edit-sale]');
    if(editSale) { $('#mainContent').dataset.editSale=editSale.dataset.editSale; render(); $('#saleForm')?.scrollIntoView({behavior:'smooth',block:'center'}); return; }
    const editPig=event.target.closest('button[data-edit-pig]');
    if(editPig) { $('#mainContent').dataset.editPig=editPig.dataset.editPig; render(); $('#pigForm')?.scrollIntoView({behavior:'smooth',block:'center'}); return; }
    const printOne=event.target.closest('[data-print-one-qr]');
    if(printOne) { const pig=db.pigs.find(p=>p.id===printOne.dataset.printOneQr); if(pig) printQrLabels([pig]); return; }
    if(event.target.closest('#printQrTags')) { const b=activeBatch(); printQrLabels(pigsFor(b?.id||'').filter(p=>!['sold','dead','culled'].includes(p.status))); return; }
    if(event.target.closest('#startQrScan')) { startQrScanner(); return; }
    if(event.target.closest('#stopQrScan')) { stopQrScanner(); const msg=$('#qrScanMessage'); if(msg)msg.textContent='Đã dừng camera.';return; }
    const farmPick = event.target.closest('[data-select-farm]'); if(farmPick) { const f=(db.settings.farms||[]).find(x=>x.id===farmPick.dataset.selectFarm); if(f){activeFarmId=f.id;activeBatchId=db.batches.find(b=>b.farmId===f.id)?.id||'';storageSet(ACTIVE_FARM_KEY,activeFarmId);storageSet(ACTIVE_KEY,activeBatchId);goTab('dashboard');} return; }
    if(event.target.closest('#accountLogout')) { logoutUser(); return; }
    if(event.target.closest('#syncNow')) { syncNow(true); return; }
    const memberStatus=event.target.closest('[data-member-status]'); if(memberStatus){setMemberStatus(memberStatus.dataset.memberStatus,memberStatus.dataset.active==='1');return;}
    const memberScope=event.target.closest('[data-member-scope]'); if(memberScope){openMemberScopeDialog(memberScope.dataset.memberScope);return;}
    if(event.target.closest('[data-refresh-members]')) { loadTeamMembers(); return; }
    if(event.target.closest('[data-refresh-audit]')) { loadAuditEvents().then(()=>{if(activeTab==='settings')render();}); return; }
    if(event.target.closest('#toggleAuthMode')) { showAuth(document.querySelector('#registerForm')?.hidden ? 'register' : 'login'); return; }
    const moreNav = event.target.closest('[data-more-nav]');
    if (moreNav) {
      const menu = $('#navMoreMenu');
      if (menu) { menu.hidden = !menu.hidden; moreNav.setAttribute('aria-expanded', String(!menu.hidden)); }
      return;
    }
    const nav = event.target.closest('[data-tab]');
    if (nav) { goTab(nav.dataset.tab); return; }
    const go = event.target.closest('[data-go]');
    if (go) { goTab(go.dataset.go); return; }
    const edit = event.target.closest('[data-edit-log]');
    if (edit) {
      const log = db.logs.find(x => x.id === edit.dataset.editLog); if (!log) return;
      activeTab = 'daily';
      $('#mainContent').dataset.editDate = log.date;
      render();
      $('#mainContent').dataset.editDate = log.date;
      $('#mainContent').innerHTML = renderDaily();
      syncContext();
      return;
    }
    const del = event.target.closest('[data-delete]');
    if (del) { if(readOnlyMode){toast('Tài khoản chỉ xem không thể xóa dữ liệu.','error');return;} doDelete(del.dataset.delete); return; }
    const sel = event.target.closest('[data-select-batch]');
    if (sel) { setActiveBatch(sel.dataset.selectBatch); goTab('settings'); return; }
    const close = event.target.closest('[data-close-batch]');
    if (close) { if(readOnlyMode){toast('Tài khoản chỉ xem không thể sửa lứa.','error');return;} const b = db.batches.find(x => x.id === close.dataset.closeBatch); if (b && window.confirm(`Đánh dấu “${b.name}” đã kết thúc? Dữ liệu được giữ nguyên.`)) { b.status = 'closed'; saveDB(); render(); toast('Đã đánh dấu lứa kết thúc.'); } return; }
    const reopen = event.target.closest('[data-reopen-batch]');
    if (reopen) { if(readOnlyMode){toast('Tài khoản chỉ xem không thể sửa lứa.','error');return;} const b = db.batches.find(x => x.id === reopen.dataset.reopenBatch); if (b) { b.status = 'active'; saveDB(); render(); toast('Đã mở lại lứa.'); } return; }
    if (event.target.closest('#downloadPreSyncBackup')) {
      try {
        const saved = JSON.parse(storageGet('pigprofit_ai_pre_sync_backup_v1') || 'null');
        if (!saved?.data) { toast('Không tìm thấy bản sao dữ liệu cục bộ.', 'error'); return; }
        downloadBlob(new Blob([JSON.stringify(saved.data, null, 2)], { type: 'application/json;charset=utf-8' }), `pigprofit-ai-local-recovery-${localDate()}.json`);
        toast('Đã tải bản sao dữ liệu cục bộ.');
      } catch (_) { toast('Bản sao cục bộ không đọc được.', 'error'); }
      return;
    }
    if (event.target.closest('#exportTop, #exportJson')) { exportJSON(); return; }
    if (event.target.closest('#importJson')) { $('#importFile').click(); return; }
    if (event.target.closest('#exportCsv, #exportCsvSettings')) { exportCSV(); return; }
    if (event.target.closest('#exportSalesCsv')) { exportSalesCSV(); return; }
    if (event.target.closest('#exportPigsCsv')) { exportPigsCSV(); return; }
    if (event.target.closest('#printReport')) { printReport(); return; }
  });

  document.addEventListener('submit', event => {
    const form = event.target;
    if (form.getAttribute('id') === 'loginForm') { event.preventDefault(); submitLogin(form); return; }
    if (form.getAttribute('id') === 'registerForm') { event.preventDefault(); submitRegister(form); return; }
    if (form.getAttribute('id') === 'forgotPasswordForm') { event.preventDefault(); submitForgotPassword(form); return; }
    if (form.getAttribute('id') === 'resetPasswordForm') { event.preventDefault(); submitResetPassword(form); return; }
    if (form.getAttribute('id') === 'memberForm') { event.preventDefault(); submitMember(form); return; }
    if (form.getAttribute('id') === 'changePasswordForm') { event.preventDefault(); submitPasswordChange(form); return; }
    if (backendAvailable && serverReady && readOnlyMode && ['dailyForm','weighingForm','costForm','saleForm','pigForm','bulkPigForm','batchForm','farmSettingsForm','farmCreateForm','feedTypeForm'].includes(form.getAttribute('id'))) { event.preventDefault(); toast('Tài khoản này chỉ có quyền xem, không thể lưu thay đổi.', 'error'); return; }
    if (form.getAttribute('id') === 'dailyForm') { event.preventDefault(); saveDaily(form); }
    else if (form.getAttribute('id') === 'weighingForm') { event.preventDefault(); saveWeighing(form); }
    else if (form.getAttribute('id') === 'costForm') { event.preventDefault(); saveCost(form); }
    else if (form.getAttribute('id') === 'saleForm') { event.preventDefault(); saveSale(form); }
    else if (form.getAttribute('id') === 'pigForm') { event.preventDefault(); savePig(form); }
    else if (form.getAttribute('id') === 'bulkPigForm') { event.preventDefault(); generateBulkPigTags(form); }
    else if (form.getAttribute('id') === 'costFilterForm') { event.preventDefault(); const d=formObject(form); costView={from:d.from||'',to:d.to||'',category:d.category||'all'}; render(); }
    else if (form.getAttribute('id') === 'reportFilterForm') { event.preventDefault(); const d=formObject(form); if(!d.from||!d.to||d.from>d.to){toast('Khoảng ngày báo cáo không hợp lệ. Hãy kiểm tra ngày bắt đầu và kết thúc.','error');return;} reportView={batchId:activeBatchId,from:d.from,to:d.to}; render(); } 
    else if (form.getAttribute('id') === 'pigSearchForm') { event.preventDefault(); const d=formObject(form); pigSearchTerm=(d.query||'').trim(); pigStatusFilter=d.status||'all'; render(); }
    else if (form.getAttribute('id') === 'qrManualForm') { event.preventDefault(); const d=formObject(form); openPigByTag(d.tag); }
    else if (form.getAttribute('id') === 'batchForm') { event.preventDefault(); saveBatch(form); }
    else if (form.getAttribute('id') === 'farmSettingsForm') { event.preventDefault(); updateFarm(form); }
    else if (form.getAttribute('id') === 'farmCreateForm') { event.preventDefault(); createFarm(form); }
    else if (form.getAttribute('id') === 'feedTypeForm') { event.preventDefault(); saveFeedType(form); }
  });

  document.addEventListener('change', event => {
    if (event.target.id === 'memberAllFarms') { const choices=$('#memberFarmChoices'); if(choices)choices.hidden=event.target.checked; }
    const memberRole=event.target.closest('[data-member-role]'); if(memberRole){setMemberRole(memberRole.dataset.memberRole,memberRole.value);return;}
    if (event.target.id === 'activeBatch') setActiveBatch(event.target.value);
    if (event.target.id === 'activeFarm') { const next=event.target.value; if(next && (db.settings.farms||[]).some(f=>f.id===next)) { activeFarmId=next; storageSet(ACTIVE_FARM_KEY,activeFarmId); activeBatchId=db.batches.find(b=>b.farmId===activeFarmId)?.id||''; storageSet(ACTIVE_KEY,activeBatchId); syncContext(); render(); } }
    const feedTypeSelect = event.target.closest('[data-feed-type]');
    if (feedTypeSelect) {
      const row = feedTypeSelect.closest('[data-feed-line]');
      const type = feedTypeById(feedTypeSelect.value);
      const date = $('#dailyDate')?.value || localDate();
      if (type) {
        const price = priceForFeedType(type, date);
        const priceField = row?.querySelector('[data-feed-price]');
        if (priceField) priceField.value = price ? price.unitPrice : '';
        const meta = row?.querySelector('[data-feed-meta]');
        if (meta) meta.textContent = price ? `${type.brand || 'Không ghi hãng'} · ${type.stage} · giá hiệu lực ${price.effectiveFrom}` : `Chưa có giá hiệu lực vào ${date}; hãy thêm lịch sử giá hoặc nhập giá mua thực tế.`;
      } else if (feedTypeSelect.value === '__legacy__') {
        const meta = row?.querySelector('[data-feed-meta]'); if (meta) meta.textContent = 'Đơn giá được giữ từ nhật ký cũ';
      } else {
        const meta = row?.querySelector('[data-feed-meta]'); if (meta) meta.textContent = 'Chọn loại cám trong danh mục hoặc mở Cài đặt để thêm sản phẩm.';
      }
      updateFeedTotals();
    }
    if (event.target.matches('[data-feed-quantity], [data-feed-price]')) updateFeedTotals();
    if (event.target.id === 'dailyDate') {
      const date = event.target.value;
      if (!date) return;
      $('#mainContent').dataset.editDate = date;
      $('#mainContent').innerHTML = renderDaily();
      updateFeedTotals();
      const old = logsFor(activeBatchId).find(l => l.date === date);
      if (old) toast(`Đã tải nhật ký đã có của ngày ${date}.`);
    }
  });
  document.addEventListener('input', event => { if (event.target.matches('[data-feed-quantity], [data-feed-price]')) updateFeedTotals(); });
    $('#importFile').addEventListener('change', e => importJSONFile(e.target.files?.[0]));

  // --- Workspace authentication and server snapshot synchronization ---
  function meaningfulLocalData(data) { return !!(data && (data.batches?.length || data.logs?.length || data.weighings?.length || data.costs?.length || data.sales?.length || data.pigs?.length)); }
  function applySnapshotData(data) {
    const incoming = data && typeof data === 'object' ? data : blankDB();
    incoming.settings = incoming.settings || { farmName: 'Trang trại của tôi' };
    if (!Array.isArray(incoming.settings.farms) || !incoming.settings.farms.length) {
      const farmId = 'farm-' + id(); incoming.settings.farms = [{ id: farmId, name: incoming.settings.farmName || 'Trang trại của tôi', createdAt: incoming.createdAt || new Date().toISOString() }];
      (incoming.batches || []).forEach(b => { if (!b.farmId) b.farmId = farmId; });
    }
    const fids = new Set(incoming.settings.farms.map(f => f.id));
    (incoming.batches || []).forEach(b => { if (!b.farmId || !fids.has(b.farmId)) b.farmId = incoming.settings.farms[0].id; });
    incoming.version = 4;
    incoming.feedTypes = Array.isArray(incoming.feedTypes) ? incoming.feedTypes : [];
    incoming.sales = Array.isArray(incoming.sales) ? incoming.sales : [];
    incoming.pigs = Array.isArray(incoming.pigs) ? incoming.pigs : [];
    incoming.logs = Array.isArray(incoming.logs) ? incoming.logs : [];
    incoming.weighings = Array.isArray(incoming.weighings) ? incoming.weighings : [];
    incoming.costs = Array.isArray(incoming.costs) ? incoming.costs : [];
    return incoming;
  }
  function localApiUrl(path) { return path; }
  async function apiFetch(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const resp = await fetch(localApiUrl(path), { ...options, headers, cache: 'no-store' });
    let body = {}; try { body = await resp.json(); } catch (_) { body = {}; }
    if (!resp.ok) { const detail = typeof body.detail === 'string' ? body.detail : body.detail?.message || body.message; const err = new Error(detail || `Yêu cầu lỗi (${resp.status})`); err.status = resp.status; err.body = body; throw err; }
    return body;
  }
  function setAuthLayerVisible(visible) { const layer=$('#authLayer'); if(layer) layer.hidden=!visible; }
  function showAuth(mode='login', message='') {
    const layer=$('#authLayer'); if(!layer)return;
    const isRegister=mode==='register';
    const isForgot=mode==='forgot';
    const isReset=mode==='reset';
    const showModeTabs=!isForgot&&!isReset;
    if(isReset) passwordResetToken = new URLSearchParams(window.location.search).get('reset_token') || passwordResetToken;
    const existingCloudScope=storageGet('pigprofit_ai_last_tenant_v1')||'';
    const canImportLocal=meaningfulLocalData(loadDB())&&!existingCloudScope;
    layer.innerHTML = `<div class="auth-backdrop"><section class="auth-card"><div class="auth-brand"><span class="brand-mark">🐖</span><div><h1>PigProfit <em>AI</em></h1><p>Quản trị trang trại theo dữ liệu</p></div></div>
      ${showModeTabs?`<div class="auth-mode"><button type="button" class="${!isRegister?'selected':''}" data-auth-mode="login">Đăng nhập</button><button type="button" class="${isRegister?'selected':''}" data-auth-mode="register">Tạo workspace</button></div>`:`<div class="auth-mode"><button type="button" data-auth-mode="login">← Quay lại đăng nhập</button></div>`}
      ${message?`<div class="auth-error" role="status">${esc(message)}</div>`:''}
      <form id="loginForm" ${mode!=='login'?'hidden':''} class="auth-form"><div class="field"><label>Email</label><input type="email" name="email" autocomplete="username" required maxlength="255" placeholder="ban@trangtrai.vn"></div><div class="field"><label>Mật khẩu</label><input type="password" name="password" autocomplete="current-password" required minlength="10" maxlength="200" placeholder="Ít nhất 10 ký tự"></div><button class="btn btn-primary auth-submit" type="submit">Đăng nhập</button><button class="auth-link" type="button" data-auth-mode="forgot">Quên mật khẩu?</button><p class="auth-legal">Mỗi workspace có dữ liệu riêng trên máy chủ. Không dùng chung mật khẩu giữa các tài khoản.</p></form>
      <form id="registerForm" ${!isRegister?'hidden':''} class="auth-form"><div class="field"><label>Tên công ty / workspace *</label><input name="tenantName" required maxlength="120" placeholder="Ví dụ: Hệ thống trại An Phú"></div><div class="field"><label>Tên chủ tài khoản *</label><input name="name" required maxlength="120" placeholder="Họ tên"></div><div class="field"><label>Email đăng nhập *</label><input type="email" name="email" autocomplete="username" required maxlength="255" placeholder="ban@trangtrai.vn"></div><div class="field"><label>Mật khẩu *</label><input type="password" name="password" autocomplete="new-password" minlength="10" required maxlength="200" placeholder="Tối thiểu 10 ký tự"></div><label class="auth-check"><input type="checkbox" name="importLocal" value="yes" ${canImportLocal?'':'disabled'}><span>Khởi tạo workspace bằng dữ liệu cục bộ chưa gắn với tài khoản cloud</span></label><button class="btn btn-primary auth-submit" type="submit">Tạo workspace và đăng nhập</button><p class="auth-legal">Tài khoản tạo mới có vai trò Chủ workspace. Hãy tải sao lưu trước nếu dữ liệu cục bộ quan trọng.</p></form>
      <form id="forgotPasswordForm" ${!isForgot?'hidden':''} class="auth-form"><div class="field"><label>Email tài khoản</label><input type="email" name="email" autocomplete="email" required maxlength="255" placeholder="ban@trangtrai.vn"></div><button class="btn btn-primary auth-submit" type="submit">Gửi hướng dẫn đặt lại mật khẩu</button><p class="auth-legal">Vì lý do bảo mật, thông báo sẽ không xác nhận email có tồn tại hay không. Máy chủ cần cấu hình SMTP và URL HTTPS công khai để gửi thư.</p></form>
      <form id="resetPasswordForm" ${!isReset?'hidden':''} class="auth-form"><input type="hidden" name="token" value="${attr(passwordResetToken)}"><div class="field"><label>Mật khẩu mới *</label><input type="password" name="newPassword" autocomplete="new-password" minlength="10" maxlength="200" required placeholder="Tối thiểu 10 ký tự"></div><div class="field"><label>Nhập lại mật khẩu mới *</label><input type="password" name="confirmPassword" autocomplete="new-password" minlength="10" maxlength="200" required placeholder="Nhập lại mật khẩu mới"></div><button class="btn btn-primary auth-submit" type="submit" ${passwordResetToken?'':'disabled'}>Đặt lại mật khẩu</button>${passwordResetToken?'':'<p class="auth-legal">Không tìm thấy mã đặt lại trong liên kết. Hãy yêu cầu một liên kết mới.</p>'}</form>
      <div class="auth-footer">PigProfit AI · Quản lý hiệu quả chăn nuôi heo</div></section></div>`;
    setAuthLayerVisible(true);
    $$('[data-auth-mode]', layer).forEach(btn=>btn.addEventListener('click',()=>{
      const next=btn.dataset.authMode;
      if(next==='login' && passwordResetToken){passwordResetToken='';try{history.replaceState({},document.title,location.pathname+location.hash);}catch(_){}}
      showAuth(next);
    }));
  }
  function hasFarmData() { return meaningfulLocalData(db); }
  function setSyncStatus(text, kind='') { const el=$('#saveState'); if(!el)return; const color=kind==='error'?'#cf766d':kind==='pending'?'#d1a451':'#38a56a'; el.innerHTML=`<i style="background:${color}"></i> ${esc(text)}`; }
  function refreshAccountControls() {
    const controls=$('#accountControls'); if(controls) controls.hidden=!(backendAvailable&&userInfo);
    const label=$('#accountUser'); if(label) label.textContent=userInfo?`${userInfo.name} · ${userInfo.role}`:'Tài khoản';
    const memberRole=$('#memberRoleHint'); if(memberRole) memberRole.textContent=userInfo?.role==='owner'?'Chủ workspace':userInfo?.role==='manager'?'Quản lý':'Thành viên';
  }
  async function fetchServerSnapshot() { return apiFetch('/api/snapshot'); }
  function hydrateServerSnapshot(snapshot) {
    db=applySnapshotData(snapshot.data); syncRevision=Number(snapshot.revision)||0; syncConflict=false; serverReady=true;
    activeFarmId=storageGet(ACTIVE_FARM_KEY)||db.settings.farms?.[0]?.id||'';
    if(!db.settings.farms.some(f=>f.id===activeFarmId)) activeFarmId=db.settings.farms[0]?.id||'';
    activeBatchId=storageGet(ACTIVE_KEY)||db.batches.find(b=>b.farmId===activeFarmId)?.id||'';
    if(!db.batches.some(b=>b.id===activeBatchId&&b.farmId===activeFarmId)) activeBatchId=db.batches.find(b=>b.farmId===activeFarmId)?.id||'';
    readOnlyMode=userInfo?.role==='viewer';
    storageSet('pigprofit_ai_last_tenant_v1', userInfo?.tenantId || '');
    storageSet(DB_KEY,JSON.stringify(db)); storageSet(ACTIVE_FARM_KEY,activeFarmId); storageSet(ACTIVE_KEY,activeBatchId);
    setAuthLayerVisible(false); refreshAccountControls(); syncContext(); render();
  }
  function clearCloudLocalView() {
    // Keep a recovery copy before clearing the cached workspace view. This protects unsynced
    // edits from loss while preventing a signed-out/invalid session from seeing tenant data.
    const previousData = loadDB();
    const previousTenantId = storageGet('pigprofit_ai_last_tenant_v1') || '';
    if (meaningfulLocalData(previousData)) {
      storageSet('pigprofit_ai_pre_sync_backup_v1', JSON.stringify({ savedAt: new Date().toISOString(), previousTenantId, data: previousData }));
    }
    // Retain the tenant marker so local data cannot be silently imported into a different workspace.
    db = blankDB();
    activeFarmId = db.settings.farms?.[0]?.id || '';
    activeBatchId = '';
    syncConflict = false; serverReady = false; readOnlyMode = false;
    storageSet(DB_KEY, JSON.stringify(db));
    storageSet(ACTIVE_FARM_KEY, activeFarmId); storageSet(ACTIVE_KEY, '');
    syncContext(); render();
  }
  async function submitForgotPassword(form) {
    const d=formObject(form); const submit=form.querySelector('[type=submit]'); if(submit)submit.disabled=true;
    try {
      const result=await apiFetch('/api/auth/password-reset/request',{method:'POST',body:JSON.stringify({email:d.email})});
      showAuth('forgot', result.message || 'Nếu email thuộc tài khoản đang hoạt động và dịch vụ email đã cấu hình, hướng dẫn sẽ được gửi đến hộp thư.');
    } catch(e) {
      showAuth('forgot', e.message || 'Chưa gửi được yêu cầu. Hãy thử lại sau.');
    } finally { if(submit)submit.disabled=false; }
  }
  async function submitResetPassword(form) {
    const d=formObject(form);
    if(d.newPassword!==d.confirmPassword){toast('Mật khẩu xác nhận không khớp.','error');return;}
    if((d.newPassword||'').length<10){toast('Mật khẩu mới phải có ít nhất 10 ký tự.','error');return;}
    const token=d.token||passwordResetToken;
    if(!token){showAuth('forgot','Liên kết đặt lại mật khẩu không hợp lệ. Hãy yêu cầu một liên kết mới.');return;}
    const submit=form.querySelector('[type=submit]'); if(submit)submit.disabled=true;
    try {
      const result=await apiFetch('/api/auth/password-reset/confirm',{method:'POST',body:JSON.stringify({token,newPassword:d.newPassword})});
      passwordResetToken='';authToken='';userInfo=null;serverReady=false;syncConflict=false;storageSet('pigprofit_ai_session_v1','');
      try{history.replaceState({},document.title,location.pathname+location.hash);}catch(_){}
      clearCloudLocalView();showAuth('login',result.message||'Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới.');
    } catch(e) { showAuth('reset',e.message||'Không thể đặt lại mật khẩu. Liên kết có thể đã hết hạn.'); }
    finally { if(submit)submit.disabled=false; }
  }

  async function finishLogin(auth, options={}) {
    const importedInitial=!!options.importedInitial;
    const allowLocalImport=!!options.allowLocalImport;
    authToken=auth.token; userInfo=auth.user; storageSet('pigprofit_ai_session_v1',authToken);
    serverReady=false; syncConflict=false; setSyncStatus('Đang tải dữ liệu...', 'pending');
    try {
      const snap=await fetchServerSnapshot();
      const localSnapshot=loadDB();
      const localHas=meaningfulLocalData(localSnapshot), remoteHas=!!snap.hasData;
      const previousTenantId=storageGet('pigprofit_ai_last_tenant_v1')||'';
      const localCanBeImported=!previousTenantId || previousTenantId===userInfo.tenantId;
      if(localHas && !remoteHas && !importedInitial && allowLocalImport && localCanBeImported) {
        const shouldImport=window.confirm('Có dữ liệu cục bộ trên thiết bị và workspace máy chủ chưa có dữ liệu. Bạn có muốn nhập dữ liệu cục bộ vào workspace này? Chỉ chọn Đồng ý nếu dữ liệu này thuộc đúng trang trại/workspace cần nhập.');
        if(shouldImport) {
          const push=await apiFetch('/api/snapshot',{method:'PUT',body:JSON.stringify({data:localSnapshot,expectedRevision:snap.revision})});
          snap.revision=push.revision; snap.data=localSnapshot; snap.hasData=true;
        } else {
          // Preserve compatible local-only data for explicit recovery, without merging it into a different tenant.
          storageSet('pigprofit_ai_pre_sync_backup_v1', JSON.stringify({savedAt:new Date().toISOString(),previousTenantId,data:localSnapshot}));
        }
      }
      if(localHas && remoteHas && localCanBeImported && (!previousTenantId || previousTenantId===userInfo.tenantId)) {
        storageSet('pigprofit_ai_pre_sync_backup_v1', JSON.stringify({savedAt:new Date().toISOString(),previousTenantId,data:localSnapshot}));
      }
      // A non-empty server workspace is always authoritative at login; no implicit overwrite prompt.
      hydrateServerSnapshot(snap);
      if(userInfo.role==='viewer') toast('Đăng nhập chế độ chỉ xem.');
      await loadTeamMembers();
      setSyncStatus('Đã đồng bộ máy chủ');
    } catch(e) {
      authToken=''; userInfo=null; storageSet('pigprofit_ai_session_v1',''); clearCloudLocalView();
      showAuth('login', e.message || 'Không thể tải dữ liệu workspace. Dữ liệu cục bộ đã được giữ trong bản sao khôi phục nếu có. Hãy đăng nhập lại khi máy chủ hoạt động.');
    }
  }
  async function submitLogin(form) {
    const d=formObject(form); const submit=form.querySelector('[type=submit]'); if(submit)submit.disabled=true;
    try { const a=await apiFetch('/api/auth/login',{method:'POST',body:JSON.stringify({email:d.email,password:d.password})}); await finishLogin(a,{allowLocalImport:true}); }
    catch(e){showAuth('login',e.message||'Đăng nhập thất bại.');}
    finally {if(submit)submit.disabled=false;}
  }
  async function submitRegister(form) {
    const d=formObject(form); const submit=form.querySelector('[type=submit]'); if(submit)submit.disabled=true;
    try { const importLocal=$('[name="importLocal"]',form)?.checked; const data=importLocal?loadDB():null; const a=await apiFetch('/api/auth/register',{method:'POST',body:JSON.stringify({tenantName:d.tenantName,name:d.name,email:d.email,password:d.password,initialData:data})}); await finishLogin(a,{importedInitial:!!data,allowLocalImport:false}); }
    catch(e){showAuth('register',e.message||'Không tạo được workspace.');}
    finally {if(submit)submit.disabled=false;}
  }
  async function logoutUser() {
    try { if(authToken) await apiFetch('/api/auth/logout',{method:'POST'}); } catch(_) {}
    authToken='';userInfo=null;serverReady=false;readOnlyMode=false;syncConflict=false;storageSet('pigprofit_ai_session_v1','');refreshAccountControls();
    if(backendAvailable) clearCloudLocalView();
    showAuth('login','Bạn đã đăng xuất khỏi workspace.');
  }
  async function initBackend() {
    if(location.protocol==='file:') { backendAvailable=false; return; }
    try {
      const health=await fetch('/api/health',{cache:'no-store'}); if(!health.ok)return; const data=await health.json(); if(data.mode!=='fullstack')return;
      backendAvailable=true; refreshAccountControls();
      if(passwordResetToken) { showAuth('reset'); syncContext(); render(); return; }
      if(authToken) {
        try { userInfo=await apiFetch('/api/auth/me'); const snap=await fetchServerSnapshot(); hydrateServerSnapshot(snap); await loadTeamMembers(); }
        catch(e){authToken='';userInfo=null;storageSet('pigprofit_ai_session_v1','');clearCloudLocalView();showAuth('login',e.message||'Vui lòng đăng nhập lại.');}
      } else { if(storageGet('pigprofit_ai_last_tenant_v1')) clearCloudLocalView(); showAuth('login'); }
    } catch(_) { backendAvailable=false; }
    syncContext(); render();
  }
  function queueSnapshotSync() {
    if(!backendAvailable||!serverReady||!authToken||readOnlyMode)return;
    syncQueued=true; if(syncTimer)clearTimeout(syncTimer);
    syncTimer=setTimeout(()=>syncSnapshot(),650);
  }
  async function syncSnapshot() {
    if(!backendAvailable||!serverReady||!authToken||readOnlyMode||syncConflict)return;
    if(syncInFlight){syncQueued=true;return;}
    syncInFlight=true;syncQueued=false;setSyncStatus('Đang đồng bộ...', 'pending');
    const data=JSON.parse(JSON.stringify(db));
    try {
      const result=await apiFetch('/api/snapshot',{method:'PUT',body:JSON.stringify({data,expectedRevision:syncRevision})});
      syncRevision=result.revision; syncErrorShown=false; setSyncStatus('Đã đồng bộ máy chủ');
    } catch(e) {
      if(e.status===409){syncConflict=true;setSyncStatus('Xung đột đồng bộ','error');if(!syncErrorShown){toast('Workspace đã thay đổi từ thiết bị khác. Tạm dừng ghi đè để bảo vệ dữ liệu; nhấn nút đồng bộ để tải bản máy chủ mới.','error');syncErrorShown=true;}}
      else if(e.status===401){serverReady=false;authToken='';userInfo=null;storageSet('pigprofit_ai_session_v1','');clearCloudLocalView();showAuth('login','Phiên đăng nhập hết hạn.');}
      else {setSyncStatus('Chưa đồng bộ được','error');if(!syncErrorShown){toast('Đang giữ dữ liệu trên thiết bị nhưng chưa đồng bộ được máy chủ. Kiểm tra mạng rồi nhấn Đồng bộ.','error');syncErrorShown=true;}}
    } finally {syncInFlight=false;if(syncQueued&&!syncConflict)setTimeout(()=>syncSnapshot(),100);}
  }
  async function syncNow(manual=false) {
    if(!backendAvailable){toast('Ứng dụng đang chạy ở chế độ tĩnh trên thiết bị. Muốn đồng bộ nhiều thiết bị, hãy chạy phiên bản backend.','error');return;}
    if(!authToken){showAuth('login');return;}
    if(!serverReady){try{userInfo=await apiFetch('/api/auth/me');const snap=await fetchServerSnapshot();hydrateServerSnapshot(snap);await loadTeamMembers();}catch(e){toast(e.message||'Không tải được dữ liệu.','error');}return;}
    if(syncConflict){if(!window.confirm('Tải snapshot mới nhất từ máy chủ? Các thay đổi chưa đồng bộ trên thiết bị này sẽ bị thay thế. Hãy tải sao lưu cục bộ trước nếu cần.'))return;try{const snap=await fetchServerSnapshot();hydrateServerSnapshot(snap);await loadTeamMembers();toast('Đã tải lại dữ liệu máy chủ.');}catch(e){toast(e.message,'error');}return;}
    if(manual){if(syncTimer)clearTimeout(syncTimer);await syncSnapshot();toast(syncConflict?'Cần giải quyết xung đột đồng bộ.':'Đã gửi dữ liệu lên máy chủ.');}
  }
  async function loadTeamMembers() {
    if(!backendAvailable||!serverReady||!authToken||!['owner','manager'].includes(userInfo?.role)||!userInfo?.allFarms) {teamMembers=[];auditEvents=[];return;}
    try { const out=await apiFetch('/api/members'); teamMembers=out.members||[]; await loadAuditEvents(); if(activeTab==='settings')render(); } catch(_) {teamMembers=[];auditEvents=[];}
  }
  function renderTeamSection() {
    if(!backendAvailable||!serverReady||!userInfo) return `<section class="card" style="margin-top:16px"><h2>Tài khoản và nhóm làm việc</h2><p class="sub">Khi triển khai cùng backend, bạn có thể dùng tài khoản workspace để đồng bộ dữ liệu nhiều thiết bị.</p></section>`;
    const owner=userInfo.role==='owner';
    const farmList=(db.settings.farms||[]);
    const scopeText=m=>m.allFarms?'Toàn bộ trang trại':(farmList.filter(f=>(m.farmIds||[]).includes(f.id)).map(f=>f.name).join(', ')||'Không có trại được phân quyền');
    const rows=teamMembers.map(m=>`<tr><td><strong>${esc(m.name)}</strong><div class="table-muted">${esc(m.email)}</div></td><td>${m.role==='owner'?'<span class="tag tag-green">Chủ workspace</span>':owner?`<select aria-label="Vai trò ${attr(m.name)}" data-member-role="${attr(m.id)}"><option value="manager" ${m.role==='manager'?'selected':''}>Quản lý</option><option value="editor" ${m.role==='editor'?'selected':''}>Nhập liệu</option><option value="viewer" ${m.role==='viewer'?'selected':''}>Chỉ xem</option></select>`:esc(({manager:'Quản lý',editor:'Nhập liệu',viewer:'Chỉ xem'})[m.role]||m.role)}</td><td><span class="table-primary">${esc(scopeText(m))}</span></td><td>${m.isActive?statusTag('Đang hoạt động','green'):statusTag('Đã khóa','red')}</td><td>${m.role==='owner'?'—':owner?`<div class="inline-actions"><button type="button" class="btn btn-small" data-member-scope="${attr(m.id)}">Phân quyền</button><button type="button" class="btn btn-small" data-member-status="${attr(m.id)}" data-active="${m.isActive?'0':'1'}">${m.isActive?'Khóa':'Mở khóa'}</button></div>`:'—'}</td></tr>`).join('');
    const auditRows=auditEvents.map(e=>`<tr><td>${esc((e.createdAt||'').replace('T',' ').slice(0,19))}</td><td>${esc(e.email||'Hệ thống')}</td><td><strong>${esc(e.action||'')}</strong>${e.detail?`<div class="table-muted">${esc(e.detail)}</div>`:''}</td></tr>`).join('');
    const farmCheckboxes=farmList.map(f=>`<label class="scope-choice"><input type="checkbox" name="farmIds" value="${attr(f.id)}" checked><span>${esc(f.name)}</span></label>`).join('');
    return `<div class="section-row"><h2>Tài khoản và nhóm làm việc</h2><span class="tag tag-green">${esc(userInfo.tenantName||'Workspace')}</span></div>
      <section class="card"><div class="settings-layout"><div><div class="check-item"><span class="check-icon">✓</span><div><strong>Workspace riêng</strong><small>Dữ liệu được cách ly theo workspace ở máy chủ. Nhân viên có thể được giới hạn theo từng trang trại.</small></div></div><div class="check-item"><span class="check-icon">✓</span><div><strong>Vai trò hiện tại: ${esc(userInfo.role)}</strong><small>${esc(userInfo.email)} · ${esc(userInfo.plan||'trial')} · ${userInfo.allFarms?'Toàn bộ trang trại':scopeText(userInfo)}</small></div></div><div class="footnote">Dữ liệu lưu cục bộ trước, rồi đồng bộ có kiểm soát phiên bản. Nếu hai thiết bị sửa đồng thời, hệ thống cảnh báo để tránh ghi đè âm thầm.</div></div>
      <div><h3>Đổi mật khẩu</h3><form id="changePasswordForm"><div class="field"><label>Mật khẩu hiện tại *</label><input name="currentPassword" type="password" autocomplete="current-password" minlength="10" required maxlength="200"></div><div class="field"><label>Mật khẩu mới *</label><input name="newPassword" type="password" autocomplete="new-password" minlength="10" required maxlength="200"></div><div class="field"><label>Nhập lại mật khẩu mới *</label><input name="confirmPassword" type="password" autocomplete="new-password" minlength="10" required maxlength="200"></div><div class="form-actions"><button class="btn btn-primary" type="submit">Đổi mật khẩu</button></div><p class="hint">Sau khi đổi mật khẩu, các phiên đăng nhập khác trên thiết bị khác sẽ bị thu hồi.</p></form></div></div></section>
      ${owner?`<div class="section-row"><h2>Quản lý thành viên</h2><span class="tag tag-gray">${teamMembers.length} tài khoản</span></div><section class="card"><h3>Thêm thành viên</h3><form id="memberForm"><div class="form-grid"><div class="field"><label>Họ tên *</label><input name="name" required maxlength="120"></div><div class="field"><label>Email *</label><input name="email" type="email" required maxlength="255"></div><div class="field"><label>Mật khẩu khởi tạo *</label><input name="password" type="password" required minlength="10" maxlength="200"></div><div class="field"><label>Vai trò</label><select name="role"><option value="editor">Nhập liệu</option><option value="manager">Quản lý</option><option value="viewer">Chỉ xem</option></select></div><div class="field full"><label class="scope-choice scope-all"><input type="checkbox" name="allFarms" id="memberAllFarms" checked><span><strong>Cho phép truy cập toàn bộ trang trại</strong><small>Nhân viên nhìn thấy và cập nhật dữ liệu của mọi trại theo vai trò.</small></span></label><div id="memberFarmChoices" class="scope-choice-list" hidden>${farmCheckboxes}</div></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">＋ Tạo tài khoản thành viên</button></div></form><div class="section-row"><h3>Danh sách thành viên</h3><button type="button" class="btn btn-small" data-refresh-members>Làm mới</button></div>${rows?`<div class="table-wrap"><table><thead><tr><th>THÀNH VIÊN</th><th>VAI TRÒ</th><th>PHẠM VI TRANG TRẠI</th><th>TRẠNG THÁI</th><th>THAO TÁC</th></tr></thead><tbody>${rows}</tbody></table></div>`:`<div class="empty"><h3>Chưa có thành viên</h3><p>Thêm tài khoản cho người quản lý hoặc nhân viên nhập liệu.</p></div>`}</section>`:`${['owner','manager'].includes(userInfo.role)&&userInfo.allFarms?`<section class="card"><div class="section-row"><h3>Thành viên workspace</h3><button type="button" class="btn btn-small" data-refresh-members>Làm mới</button></div>${rows?`<div class="table-wrap"><table><thead><tr><th>THÀNH VIÊN</th><th>VAI TRÒ</th><th>PHẠM VI TRẠI</th><th>TRẠNG THÁI</th></tr></thead><tbody>${rows}</tbody></table></div>`:''}</section>`:''}`}
      ${owner||(['manager'].includes(userInfo.role)&&userInfo.allFarms)?`<section class="card"><div class="section-row"><div><h2>Nhật ký hoạt động</h2><p class="sub">Các sự kiện tài khoản, phân quyền và cập nhật dữ liệu gần đây.</p></div><button type="button" class="btn btn-small" data-refresh-audit>Làm mới</button></div>${auditRows?`<div class="table-wrap"><table><thead><tr><th>THỜI GIAN</th><th>NGƯỜI THỰC HIỆN</th><th>HOẠT ĐỘNG</th></tr></thead><tbody>${auditRows}</tbody></table></div>`:`<div class="empty"><p>Chưa có sự kiện hoặc chưa tải được nhật ký.</p></div>`}</section>`:''}`;
  }
  async function submitMember(form) {
    if(userInfo?.role!=='owner'){toast('Chỉ chủ workspace mới được thêm thành viên.','error');return;}
    const d=formObject(form);const allFarms=form.querySelector('[name="allFarms"]')?.checked!==false;const farmIds=$$('input[name="farmIds"]:checked',form).map(x=>x.value);if(!allFarms&&!farmIds.length){toast('Hãy chọn ít nhất một trang trại hoặc bật quyền toàn workspace.','error');return;}try{await apiFetch('/api/members',{method:'POST',body:JSON.stringify({name:d.name,email:d.email,password:d.password,role:d.role,farmIds:allFarms?null:farmIds})});toast('Đã tạo tài khoản thành viên. Hãy gửi thông tin đăng nhập an toàn cho nhân viên.');form.reset();const toggle=$('#memberAllFarms');if(toggle){toggle.checked=true;$('#memberFarmChoices').hidden=true;}await loadTeamMembers();if(activeTab==='settings')render();}catch(e){toast(e.message||'Không tạo được thành viên.','error');}
  }
  async function setMemberStatus(memberId, isActive) {
    try{await apiFetch(`/api/members/${encodeURIComponent(memberId)}/status`,{method:'PATCH',body:JSON.stringify({isActive})});toast(isActive?'Đã mở khóa thành viên.':'Đã khóa và thu hồi phiên đăng nhập của thành viên.');await loadTeamMembers();if(activeTab==='settings')render();}catch(e){toast(e.message||'Không thể cập nhật thành viên.','error');}
  }
  async function setMemberRole(memberId, role) {
    if(userInfo?.role!=='owner'){toast('Chỉ chủ workspace mới được thay đổi vai trò.','error');return;}
    try{await apiFetch(`/api/members/${encodeURIComponent(memberId)}/role`,{method:'PATCH',body:JSON.stringify({role})});toast('Đã cập nhật vai trò thành viên.');await loadTeamMembers();if(activeTab==='settings')render();}catch(e){toast(e.message||'Không thể cập nhật vai trò.','error');await loadTeamMembers();if(activeTab==='settings')render();}
  }
  async function openMemberScopeDialog(memberId) {
    if(userInfo?.role!=='owner'){toast('Chỉ chủ workspace mới được thay đổi phạm vi trại.','error');return;}
    const member=teamMembers.find(m=>m.id===memberId);if(!member||member.role==='owner')return;
    const farms=db.settings.farms||[];
    const backdrop=document.createElement('div');backdrop.className='modal-backdrop';backdrop.id='memberScopeModal';
    backdrop.innerHTML=`<section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="memberScopeTitle"><div class="section-row"><div><h2 id="memberScopeTitle">Phân quyền trang trại</h2><p class="sub">${esc(member.name)} · ${esc(member.email)}</p></div><button class="btn btn-small" type="button" data-close-scope>Đóng</button></div><form id="memberScopeForm"><label class="scope-choice scope-all"><input type="checkbox" name="allFarms" id="scopeAllFarms" ${member.allFarms?'checked':''}><span><strong>Toàn bộ trang trại</strong><small>Bỏ chọn để chỉ cấp quyền cho các trại đã tích.</small></span></label><div id="scopeFarmChoices" class="scope-choice-list" ${member.allFarms?'hidden':''}>${farms.map(f=>`<label class="scope-choice"><input type="checkbox" name="farmIds" value="${attr(f.id)}" ${(member.farmIds||[]).includes(f.id)?'checked':''}><span>${esc(f.name)}</span></label>`).join('')}</div><div class="form-actions"><button class="btn" type="button" data-close-scope>Hủy</button><button class="btn btn-primary" type="submit">Lưu phạm vi</button></div></form></section>`;
    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-close-scope]')?.focus();
    backdrop.querySelectorAll('[data-close-scope]').forEach(x=>x.addEventListener('click',()=>backdrop.remove()));
    backdrop.addEventListener('click',e=>{if(e.target===backdrop)backdrop.remove();});
    backdrop.querySelector('#scopeAllFarms')?.addEventListener('change',e=>{backdrop.querySelector('#scopeFarmChoices').hidden=e.target.checked;});
    backdrop.querySelector('#memberScopeForm')?.addEventListener('submit',async e=>{e.preventDefault();const all=backdrop.querySelector('#scopeAllFarms').checked;const ids=Array.from(backdrop.querySelectorAll('input[name="farmIds"]:checked')).map(x=>x.value);if(!all&&!ids.length){toast('Hãy chọn ít nhất một trang trại.','error');return;}try{await apiFetch(`/api/members/${encodeURIComponent(memberId)}/farms`,{method:'PATCH',body:JSON.stringify({farmIds:all?null:ids})});backdrop.remove();toast('Đã cập nhật phạm vi. Thành viên sẽ cần đăng nhập lại để áp dụng quyền mới.');await loadTeamMembers();if(activeTab==='settings')render();}catch(err){toast(err.message||'Không thể cập nhật phạm vi trại.','error');}});
  }
  async function submitPasswordChange(form) {
    const d=formObject(form);if(d.newPassword!==d.confirmPassword){toast('Mật khẩu xác nhận không khớp.','error');return;}if((d.newPassword||'').length<10){toast('Mật khẩu mới phải có ít nhất 10 ký tự.','error');return;}
    try{await apiFetch('/api/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword:d.currentPassword,newPassword:d.newPassword})});form.reset();toast('Đã đổi mật khẩu. Các phiên đăng nhập khác đã bị thu hồi.');await loadAuditEvents();if(activeTab==='settings')render();}catch(e){toast(e.message||'Không thể đổi mật khẩu.','error');}
  }
  async function loadAuditEvents() {
    if(!backendAvailable||!serverReady||!authToken||!['owner','manager'].includes(userInfo?.role)||!userInfo?.allFarms){auditEvents=[];return;}
    try{const out=await apiFetch('/api/audit?limit=30');auditEvents=out.events||[];}catch(_){auditEvents=[];}
  }
  function createFarm(form) {
    if(readOnlyMode){toast('Tài khoản chỉ xem không thể tạo trang trại.','error');return;}
    if(backendAvailable && serverReady && userInfo && userInfo.allFarms===false){toast('Tài khoản được phân quyền theo trại không thể tạo trang trại mới.','error');return;}
    const d=formObject(form), name=(d.newFarmName||'').trim(); if(name.length<2){toast('Tên trang trại cần ít nhất 2 ký tự.','error');return;}
    const exists=(db.settings.farms||[]).some(f=>f.name.toLowerCase()===name.toLowerCase());if(exists){toast('Tên trang trại này đã tồn tại trong workspace.','error');return;}
    const farm={id:'farm-'+id(),name,createdAt:new Date().toISOString()};db.settings.farms.push(farm);activeFarmId=farm.id;activeBatchId='';db.settings.farmName=name;saveDB();render();toast('Đã tạo trang trại. Tiếp theo hãy tạo lứa nuôi.');
  }

  // Do not render a cached cloud workspace while signed out on a shared device.
  // clearCloudLocalView keeps a recovery backup first. Local-only users without a tenant marker
  // continue to use the app without an account.
  if (!authToken && storageGet('pigprofit_ai_last_tenant_v1')) clearCloudLocalView();
  // Initial setup. The same UI works local-first when opened as static files,
  // and adds account-backed synchronization when served by server.py.
  syncContext(); render();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
  initBackend();
})();
