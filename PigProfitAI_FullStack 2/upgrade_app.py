from pathlib import Path
p=Path(__file__).parent
f=p/'app.js'
s=f.read_text(encoding='utf-8')
# Multi-farm data model and storage.
s=s.replace("const ACTIVE_KEY = 'pigprofit_ai_active_batch_v1';", "const ACTIVE_KEY = 'pigprofit_ai_active_batch_v1';\n  const ACTIVE_FARM_KEY = 'pigprofit_ai_active_farm_v1';")
s=s.replace("return { version: 3, settings: { farmName: 'Trang trại của tôi' }, batches: [], feedTypes: [], logs: [], weighings: [], costs: [], sales: [], pigs: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };", "const now = new Date().toISOString(); const farmId = 'farm-' + (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now()); return { version: 4, settings: { farmName: 'Trang trại của tôi', farms: [{ id: farmId, name: 'Trang trại của tôi', createdAt: now }] }, batches: [], feedTypes: [], logs: [], weighings: [], costs: [], sales: [], pigs: [], createdAt: now, updatedAt: now };")
s=s.replace("      parsed.settings = parsed.settings || { farmName: 'Trang trại của tôi' };\n      parsed.feedTypes", "      parsed.settings = parsed.settings || { farmName: 'Trang trại của tôi' };\n      if (!Array.isArray(parsed.settings.farms) || !parsed.settings.farms.length) { const firstFarm = { id: 'farm-' + (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now()), name: parsed.settings.farmName || 'Trang trại của tôi', createdAt: parsed.createdAt || new Date().toISOString() }; parsed.settings.farms = [firstFarm]; parsed.batches.forEach(b => { if (!b.farmId) b.farmId = firstFarm.id; }); }\n      else { const validFarmIds = new Set(parsed.settings.farms.map(f => f.id)); parsed.batches.forEach(b => { if (!b.farmId || !validFarmIds.has(b.farmId)) b.farmId = parsed.settings.farms[0].id; }); }\n      parsed.settings.farmName = parsed.settings.farmName || parsed.settings.farms[0].name;\n      parsed.feedTypes")
s=s.replace("      parsed.version = 3;", "      parsed.version = 4;")
s=s.replace("  let activeBatchId = storageGet(ACTIVE_KEY) || (db.batches[0] && db.batches[0].id) || '';", "  let activeFarmId = storageGet(ACTIVE_FARM_KEY) || db.settings.farms?.[0]?.id || '';\n  let activeBatchId = storageGet(ACTIVE_KEY) || db.batches.find(b => b.farmId === activeFarmId)?.id || '';\n  let backendAvailable = false, serverReady = false, syncRevision = 0, authToken = storageGet('pigprofit_ai_session_v1') || '', userInfo = null, syncTimer = null, syncInFlight = false, syncQueued = false, syncConflict = false, syncErrorShown = false, teamMembers = [];\n  let readOnlyMode = false;")
s=s.replace("  function activeBatch() { return db.batches.find(b => b.id === activeBatchId) || null; }", "  function currentFarm() { return (db.settings.farms || []).find(f => f.id === activeFarmId) || (db.settings.farms || [])[0] || { id: '', name: db.settings.farmName || 'Trang trại của tôi' }; }\n  function farmNameForBatch(batchId) { const batch = db.batches.find(b => b.id === batchId); return (db.settings.farms || []).find(f => f.id === batch?.farmId)?.name || db.settings.farmName || 'Trang trại của tôi'; }\n  function activeBatch() { return db.batches.find(b => b.id === activeBatchId && (!b.farmId || b.farmId === activeFarmId)) || db.batches.find(b => b.farmId === activeFarmId) || null; }")
s=s.replace("    activeBatchId = idValue || '';\n    storageSet(ACTIVE_KEY, activeBatchId);", "    activeBatchId = idValue || '';\n    const selected = db.batches.find(b => b.id === activeBatchId); if (selected?.farmId) { activeFarmId = selected.farmId; storageSet(ACTIVE_FARM_KEY, activeFarmId); }\n    storageSet(ACTIVE_KEY, activeBatchId);")
# Replace sync context implementation core
old="""    $('#farmTitle').textContent = db.settings.farmName || 'Trang trại của tôi';
    const select = $('#activeBatch');
    const options = db.batches.slice().sort((a, b) => (b.status === 'active') - (a.status === 'active') || (a.name || '').localeCompare(b.name || ''));
    select.innerHTML = options.length ? options.map(b => `<option value="${attr(b.id)}" ${b.id === activeBatchId ? 'selected' : ''}>${esc(b.name)}${b.status === 'closed' ? ' · Đã kết thúc' : ''}</option>`).join('') : '<option value="">Chưa có lứa nuôi</option>';
    if (activeBatchId && !db.batches.some(b => b.id === activeBatchId)) activeBatchId = options[0]?.id || '';
    if (!activeBatchId && options[0]) { activeBatchId = options[0].id; storageSet(ACTIVE_KEY, activeBatchId); select.value = activeBatchId; }
    $('#saveState').innerHTML = storagePersistent ? '<i></i> Đã lưu trên thiết bị' : '<i style="background:#d1a451"></i> Chỉ lưu tạm trong phiên';"""
new="""    const farmSelect = $('#activeFarm');
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
    const accountControls = $('#accountControls'); if (accountControls) accountControls.hidden = !backendAvailable || !userInfo;"""
if old not in s: print('WARN syncContext block not matched')
s=s.replace(old,new)
# batches farmId when created
s=s.replace("const b = { id: id(), name: d.name.trim(), startDate: d.startDate, initialCount: num(d.initialCount), initialAvgWeight: num(d.initialAvgWeight), initialPurchaseCost: num(d.initialPurchaseCost), marketPrice: num(d.marketPrice), defaultFeedPrice: num(d.defaultFeedPrice), status: 'active', createdAt: new Date().toISOString() };", "const b = { id: id(), farmId: activeFarmId || currentFarm().id, name: d.name.trim(), startDate: d.startDate, initialCount: num(d.initialCount), initialAvgWeight: num(d.initialAvgWeight), initialPurchaseCost: num(d.initialPurchaseCost), marketPrice: num(d.marketPrice), defaultFeedPrice: num(d.defaultFeedPrice), status: 'active', createdAt: new Date().toISOString() };")
# Existing batch edit preserve current farm
# current batch settings farm fields and batch table include farm
s=s.replace("const batchRows = db.batches.map(x => `<tr><td><div class=\"table-primary\">${esc(x.name)}</div><div class=\"table-muted\">${esc(x.startDate || 'Chưa khai báo ngày bắt đầu')}</div></td><td class=\"num\">${fmt(x.initialCount, 0)} con</td>", "const batchRows = db.batches.map(x => `<tr><td><div class=\"table-primary\">${esc(x.name)}</div><div class=\"table-muted\">${esc(x.startDate || 'Chưa khai báo ngày bắt đầu')} · ${esc(farmNameForBatch(x.id))}</div></td><td class=\"num\">${fmt(x.initialCount, 0)} con</td>")
# Switch farm settings block to current farm's name (farm name form label etc.)
s=s.replace("value=\"${attr(db.settings.farmName || '')}\" required maxlength=\"100\"", "value=\"${attr(currentFarm().name || db.settings.farmName || '')}\" required maxlength=\"100\"")
# Add management farms UI before settings-layout
marker="""      <div class="settings-layout"><section class="card form-card"><h2>Thông tin trang trại</h2>"""
insert="""      <section class="card form-card" style="margin-bottom:16px"><div class="card-heading"><div><h2>Quản lý nhiều trang trại</h2><p>Mỗi trang trại có danh sách lứa nuôi riêng; các lứa và dữ liệu lịch sử được giữ lại khi chuyển trại.</p></div><span class="tag tag-green">${(db.settings.farms||[]).length} trang trại</span></div><form id="farmCreateForm" class="filter-row"><div class="field"><label>Tên trang trại mới</label><input name="newFarmName" maxlength="100" required placeholder="Ví dụ: Trại 2 · Khu B"></div><button type="submit" class="btn btn-primary">＋ Tạo trang trại</button></form><div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>TRANG TRẠI</th><th>SỐ LỨA</th><th></th></tr></thead><tbody>${(db.settings.farms||[]).map(f=>`<tr><td><strong>${esc(f.name)}</strong>${f.id===activeFarmId?' <span class="tag tag-green">Đang xem</span>':''}</td><td>${db.batches.filter(x=>x.farmId===f.id).length}</td><td><button type="button" class="btn btn-small" data-select-farm="${attr(f.id)}">Mở trại</button></td></tr>`).join('')}</tbody></table></div></section>
      <div class="settings-layout"><section class="card form-card"><h2>Thông tin trang trại</h2>"""
if marker not in s: print('WARN farm settings marker not found')
s=s.replace(marker,insert)
# replace updateFarm
s=s.replace("db.settings.farmName = d.farmName.trim(); saveDB(); syncContext(); toast('Đã lưu thông tin trang trại.'); render();", "const farm = currentFarm(); farm.name = d.farmName.trim(); db.settings.farmName = farm.name; farm.updatedAt = new Date().toISOString(); saveDB(); syncContext(); toast('Đã lưu tên trang trại.'); render();")
# modify references to current farm names for reports exports/labels
s=s.replace("<h1>${esc(db.settings.farmName)} · PigProfit AI</h1><p>Tem nhận diện heo —", "<h1>${esc(farmNameForBatch(pigs[0]?.batchId))} · PigProfit AI</h1><p>Tem nhận diện heo —")
s=s.replace("rows.push([db.settings.farmName, l.batchId, b?.name || '', l.date", "rows.push([farmNameForBatch(l.batchId), l.batchId, b?.name || '', l.date")
s=s.replace("rows.push([db.settings.farmName,x.batchId,b?.name||'',x.date", "rows.push([farmNameForBatch(x.batchId),x.batchId,b?.name||'',x.date")
s=s.replace("rows.push([db.settings.farmName,x.batchId,b?.name||'',x.tag", "rows.push([farmNameForBatch(x.batchId),x.batchId,b?.name||'',x.tag")
# Use internal QR endpoint under full-stack; fallback if static-only.
s=s.replace("return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=4&data=${encodeURIComponent('PP:'+tag)}`;", "return (location.protocol === 'http:' || location.protocol === 'https:') ? `/api/qr?size=${size}&text=${encodeURIComponent('PP:'+tag)}` : `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=4&data=${encodeURIComponent('PP:'+tag)}`;")
# dashboard's count sold shows ticket-based values
s=s.replace("${fmt(sum(m.logs, 'deadCount'), 0)} chết · ${fmt(sum(m.logs, 'soldCount'), 0)} bán trong nhật ký", "${fmt(sum(m.logs, 'deadCount'), 0)} chết · ${fmt(soldCountForBatch(b.id), 0)} đã bán")
# settings footer text updated for cloud mode
s=s.replace("<strong>Dữ liệu hiện lưu trên trình duyệt này</strong>Ứng dụng chưa đồng bộ lên máy chủ. Khi đổi điện thoại, trình duyệt hoặc xóa dữ liệu website, bạn cần khôi phục từ tệp JSON đã sao lưu.", "<strong>${backendAvailable && serverReady ? 'Dữ liệu đang đồng bộ lên workspace' : 'Dữ liệu cục bộ cần được sao lưu'}</strong>${backendAvailable && serverReady ? 'Bản ghi được đồng bộ đến máy chủ của workspace sau khi lưu. Tải bản sao lưu định kỳ vẫn được khuyến nghị.' : 'Trong chế độ chạy độc lập, dữ liệu chỉ lưu trên trình duyệt. Khi đổi thiết bị, cần khôi phục từ tệp JSON.'}")
s=s.replace("<strong>Lưu dữ liệu trên thiết bị</strong><small>Không cần tài khoản; không tự gửi dữ liệu ra internet.</small>", "<strong>${backendAvailable && serverReady ? 'Đồng bộ backend hoạt động' : 'Lưu cục bộ'}</strong><small>${backendAvailable && serverReady ? `Workspace: ${esc(userInfo?.tenantName || '')} · Người dùng: ${esc(userInfo?.email || '')}` : 'Chưa kết nối tài khoản máy chủ trong phiên này.'}</small>")
s=s.replace("<strong>Chưa có đồng bộ nhiều người dùng và nhắc tự động</strong><small>Cần triển khai backend, đăng nhập, phân quyền và dịch vụ thông báo để dùng trên quy mô trang trại.</small>", "<strong>${backendAvailable ? 'Tài khoản và đồng bộ workspace' : 'Chưa cấu hình backend'}</strong><small>${backendAvailable ? 'Mỗi workspace có dữ liệu được cách ly; chủ workspace có thể thêm tài khoản thành viên. Bản này chưa tích hợp Zalo/SMS/push tự động.' : 'Khi chạy qua server.py, đăng nhập, phân quyền và đồng bộ máy chủ sẽ được bật.'}</small>")
# version references
s=s.replace('Phiên bản MVP 1.1 — Cám theo giai đoạn','Phiên bản 1.2 — Đa trại · Backend')
# Add farm creation and farm select listeners / viewer locks
s=s.replace("if (event.target.getAttribute('id') === 'dailyForm')", "if (backendAvailable && serverReady && readOnlyMode) { event.preventDefault(); toast('Tài khoản này chỉ có quyền xem, không thể lưu thay đổi.', 'error'); return; }\n    if (form.getAttribute('id') === 'loginForm') { event.preventDefault(); submitLogin(form); }\n    else if (form.getAttribute('id') === 'registerForm') { event.preventDefault(); submitRegister(form); }\n    else if (form.getAttribute('id') === 'memberForm') { event.preventDefault(); submitMember(form); }\n    else if (form.getAttribute('id') === 'dailyForm')")
# Add farm submit branch
s=s.replace("else if (form.getAttribute('id') === 'farmSettingsForm') { event.preventDefault(); updateFarm(form); }", "else if (form.getAttribute('id') === 'farmSettingsForm') { event.preventDefault(); updateFarm(form); }\n    else if (form.getAttribute('id') === 'farmCreateForm') { event.preventDefault(); createFarm(form); }")
# active farm selector change
s=s.replace("if (event.target.id === 'activeBatch') setActiveBatch(event.target.value);", "if (event.target.id === 'activeBatch') setActiveBatch(event.target.value);\n    if (event.target.id === 'activeFarm') { const next=event.target.value; if(next && (db.settings.farms||[]).some(f=>f.id===next)) { activeFarmId=next; storageSet(ACTIVE_FARM_KEY,activeFarmId); activeBatchId=db.batches.find(b=>b.farmId===activeFarmId)?.id||''; storageSet(ACTIVE_KEY,activeBatchId); syncContext(); render(); } }")
# click event farm-select and account/sync
s=s.replace("    const nav = event.target.closest('[data-tab]');", "    const farmPick = event.target.closest('[data-select-farm]'); if(farmPick) { const f=(db.settings.farms||[]).find(x=>x.id===farmPick.dataset.selectFarm); if(f){activeFarmId=f.id;activeBatchId=db.batches.find(b=>b.farmId===f.id)?.id||'';storageSet(ACTIVE_FARM_KEY,activeFarmId);storageSet(ACTIVE_KEY,activeBatchId);goTab('dashboard');} return; }\n    if(event.target.closest('#accountLogout')) { logoutUser(); return; }\n    if(event.target.closest('#syncNow')) { syncNow(true); return; }\n    if(event.target.closest('#toggleAuthMode')) { showAuth(document.querySelector('#registerForm')?.hidden ? 'register' : 'login'); return; }\n    const nav = event.target.closest('[data-tab]');")
# App initial block replace with async bootstrap call, we'll insert the backend functions above this point.
old_init="""  // Initial shell setup and optional offline support.
  syncContext(); render();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
})();"""
new_init="""  // Initial setup. The same UI works local-first when opened as static files,
  // and adds account-backed synchronization when served by server.py.
  syncContext(); render();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
  initBackend();
})();"""
if old_init not in s: print('WARN init marker not found')
s=s.replace(old_init,new_init)
# Insert backend functions before initial setup marker
marker="  // Initial setup. The same UI works local-first when opened as static files,"
backend_js=r'''  // --- Workspace authentication and server snapshot synchronization ---
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
    layer.innerHTML = `<div class="auth-backdrop"><section class="auth-card"><div class="auth-brand"><span class="brand-mark">🐖</span><div><h1>PigProfit <em>AI</em></h1><p>Quản trị trang trại theo dữ liệu</p></div></div>
      <div class="auth-mode"><button type="button" class="${!isRegister?'selected':''}" data-auth-mode="login">Đăng nhập</button><button type="button" class="${isRegister?'selected':''}" data-auth-mode="register">Tạo workspace</button></div>
      ${message?`<div class="auth-error" role="alert">${esc(message)}</div>`:''}
      <form id="loginForm" ${isRegister?'hidden':''} class="auth-form"><div class="field"><label>Email</label><input type="email" name="email" autocomplete="username" required maxlength="255" placeholder="ban@trangtrai.vn"></div><div class="field"><label>Mật khẩu</label><input type="password" name="password" autocomplete="current-password" required minlength="10" maxlength="200" placeholder="Ít nhất 10 ký tự"></div><button class="btn btn-primary auth-submit" type="submit">Đăng nhập</button><p class="auth-legal">Mỗi workspace có dữ liệu riêng trên máy chủ. Không dùng chung mật khẩu giữa các tài khoản.</p></form>
      <form id="registerForm" ${!isRegister?'hidden':''} class="auth-form"><div class="field"><label>Tên công ty / workspace *</label><input name="tenantName" required maxlength="120" placeholder="Ví dụ: Hệ thống trại An Phú"></div><div class="field"><label>Tên chủ tài khoản *</label><input name="name" required maxlength="120" placeholder="Họ tên"></div><div class="field"><label>Email đăng nhập *</label><input type="email" name="email" autocomplete="username" required maxlength="255" placeholder="ban@trangtrai.vn"></div><div class="field"><label>Mật khẩu *</label><input type="password" name="password" autocomplete="new-password" minlength="10" required maxlength="200" placeholder="Tối thiểu 10 ký tự"></div><label class="auth-check"><input type="checkbox" name="importLocal" value="yes" ${meaningfulLocalData(loadDB())?'':'disabled'}><span>Khởi tạo workspace bằng dữ liệu đang có trên thiết bị này</span></label><button class="btn btn-primary auth-submit" type="submit">Tạo workspace và đăng nhập</button><p class="auth-legal">Tài khoản tạo mới có vai trò Chủ workspace. Hãy tải sao lưu trước nếu dữ liệu cục bộ quan trọng.</p></form>
      <div class="auth-footer">PigProfit AI · Bản thử nghiệm đa trang trại</div></section></div>`;
    setAuthLayerVisible(true);
    $$('[data-auth-mode]', layer).forEach(btn=>btn.addEventListener('click',()=>showAuth(btn.dataset.authMode)));
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
    storageSet(DB_KEY,JSON.stringify(db)); storageSet(ACTIVE_FARM_KEY,activeFarmId); storageSet(ACTIVE_KEY,activeBatchId);
    setAuthLayerVisible(false); refreshAccountControls(); syncContext(); render();
  }
  async function finishLogin(auth) {
    authToken=auth.token; userInfo=auth.user; storageSet('pigprofit_ai_session_v1',authToken);
    serverReady=false; syncConflict=false; setSyncStatus('Đang tải dữ liệu...', 'pending');
    try {
      const snap=await fetchServerSnapshot();
      const localSnapshot=loadDB();
      const localHas=meaningfulLocalData(localSnapshot), remoteHas=!!snap.hasData;
      if(localHas && !remoteHas) {
        if(window.confirm('Phát hiện dữ liệu cục bộ trên thiết bị và workspace máy chủ chưa có dữ liệu. Tải dữ liệu cục bộ lên workspace để bắt đầu dùng chung? Chọn Hủy để sử dụng workspace trống.')) {
          const push=await apiFetch('/api/snapshot',{method:'PUT',body:JSON.stringify({data:localSnapshot,expectedRevision:snap.revision})});
          snap.revision=push.revision; snap.data=localSnapshot; snap.hasData=true;
        }
      } else if(localHas && remoteHas) {
        const upload=window.confirm('Cả thiết bị này và workspace máy chủ đều có dữ liệu. Nhấn OK để tải dữ liệu cục bộ lên và THAY dữ liệu chung trên máy chủ; nhấn Hủy để dùng dữ liệu máy chủ. Nếu cần giữ cả hai, hãy đăng xuất và xuất sao lưu JSON trước.');
        if(upload) {
          const push=await apiFetch('/api/snapshot',{method:'PUT',body:JSON.stringify({data:localSnapshot,expectedRevision:snap.revision})});
          snap.revision=push.revision; snap.data=localSnapshot; snap.hasData=true;
        }
      }
      hydrateServerSnapshot(snap);
      if(userInfo.role==='viewer') toast('Đăng nhập chế độ chỉ xem.');
      await loadTeamMembers();
      setSyncStatus('Đã đồng bộ máy chủ');
    } catch(e) {
      if(e.status===401){authToken='';userInfo=null;storageSet('pigprofit_ai_session_v1','');showAuth('login','Phiên đăng nhập không hợp lệ. Hãy đăng nhập lại.');}
      else {setAuthLayerVisible(false);setSyncStatus('Lỗi tải dữ liệu máy chủ','error');toast(e.message||'Không tải được dữ liệu máy chủ.','error');}
    }
  }
  async function submitLogin(form) {
    const d=formObject(form); const submit=form.querySelector('[type=submit]'); if(submit)submit.disabled=true;
    try { const a=await apiFetch('/api/auth/login',{method:'POST',body:JSON.stringify({email:d.email,password:d.password})}); await finishLogin(a); }
    catch(e){showAuth('login',e.message||'Đăng nhập thất bại.');}
    finally {if(submit)submit.disabled=false;}
  }
  async function submitRegister(form) {
    const d=formObject(form); const submit=form.querySelector('[type=submit]'); if(submit)submit.disabled=true;
    try { const importLocal=$('[name="importLocal"]',form)?.checked; const data=importLocal?loadDB():null; const a=await apiFetch('/api/auth/register',{method:'POST',body:JSON.stringify({tenantName:d.tenantName,name:d.name,email:d.email,password:d.password,initialData:data})}); await finishLogin(a); }
    catch(e){showAuth('register',e.message||'Không tạo được workspace.');}
    finally {if(submit)submit.disabled=false;}
  }
  async function logoutUser() {
    try { if(authToken) await apiFetch('/api/auth/logout',{method:'POST'}); } catch(_) {}
    authToken='';userInfo=null;serverReady=false;readOnlyMode=false;syncConflict=false;storageSet('pigprofit_ai_session_v1','');refreshAccountControls();
    showAuth('login','Bạn đã đăng xuất khỏi workspace.');
  }
  async function initBackend() {
    if(location.protocol==='file:') { backendAvailable=false; return; }
    try {
      const health=await fetch('/api/health',{cache:'no-store'}); if(!health.ok)return; const data=await health.json(); if(data.mode!=='fullstack')return;
      backendAvailable=true; refreshAccountControls();
      if(authToken) {
        try { userInfo=await apiFetch('/api/auth/me'); const snap=await fetchServerSnapshot(); hydrateServerSnapshot(snap); await loadTeamMembers(); }
        catch(e){authToken='';userInfo=null;storageSet('pigprofit_ai_session_v1','');showAuth('login',e.message||'Vui lòng đăng nhập lại.');}
      } else showAuth('login');
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
      else if(e.status===401){serverReady=false;authToken='';userInfo=null;storageSet('pigprofit_ai_session_v1','');showAuth('login','Phiên đăng nhập hết hạn.');}
      else {setSyncStatus('Chưa đồng bộ được','error');if(!syncErrorShown){toast('Đang giữ dữ liệu trên thiết bị nhưng chưa đồng bộ được máy chủ. Kiểm tra mạng rồi nhấn Đồng bộ.','error');syncErrorShown=true;}}
    } finally {syncInFlight=false;if(syncQueued&&!syncConflict)setTimeout(()=>syncSnapshot(),100);}
  }
  async function syncNow(manual=false) {
    if(!backendAvailable||!authToken){showAuth('login');return;}
    if(!serverReady){try{userInfo=await apiFetch('/api/auth/me');const snap=await fetchServerSnapshot();hydrateServerSnapshot(snap);await loadTeamMembers();}catch(e){toast(e.message||'Không tải được dữ liệu.','error');}return;}
    if(syncConflict){if(!window.confirm('Tải snapshot mới nhất từ máy chủ? Các thay đổi chưa đồng bộ trên thiết bị này sẽ bị thay thế. Hãy tải sao lưu cục bộ trước nếu cần.'))return;try{const snap=await fetchServerSnapshot();hydrateServerSnapshot(snap);await loadTeamMembers();toast('Đã tải lại dữ liệu máy chủ.');}catch(e){toast(e.message,'error');}return;}
    if(manual){if(syncTimer)clearTimeout(syncTimer);await syncSnapshot();toast(syncConflict?'Cần giải quyết xung đột đồng bộ.':'Đã gửi dữ liệu lên máy chủ.');}
  }
  async function loadTeamMembers() {
    if(!backendAvailable||!serverReady||!authToken||!['owner','manager'].includes(userInfo?.role)) {teamMembers=[];return;}
    try { const out=await apiFetch('/api/members'); teamMembers=out.members||[]; if(activeTab==='settings')render(); } catch(_) {teamMembers=[];}
  }
  function renderTeamSection() {
    if(!backendAvailable||!serverReady||!userInfo) return `<section class="card" style="margin-top:16px"><h2>Tài khoản và nhóm làm việc</h2><p class="sub">Khi triển khai cùng backend, bạn có thể dùng tài khoản workspace để đồng bộ dữ liệu nhiều thiết bị.</p></section>`;
    const manager=userInfo.role==='owner';
    const rows=teamMembers.map(m=>`<tr><td><strong>${esc(m.name)}</strong><div class="table-muted">${esc(m.email)}</div></td><td>${esc(({owner:'Chủ workspace',manager:'Quản lý',editor:'Nhập liệu',viewer:'Chỉ xem'})[m.role]||m.role)}</td><td>${m.isActive?statusTag('Đang hoạt động','green'):statusTag('Đã khóa','red')}</td><td>${m.role==='owner'?'—':manager?`<button type="button" class="btn btn-small" data-member-status="${attr(m.id)}" data-active="${m.isActive?'0':'1'}">${m.isActive?'Khóa':'Mở khóa'}</button>`:'—'}</td></tr>`).join('');
    return `<div class="section-row"><h2>Tài khoản và nhóm làm việc</h2><span class="tag tag-green">${esc(userInfo.tenantName||'Workspace')}</span></div><section class="card"><div class="settings-layout"><div><div class="check-item"><span class="check-icon">✓</span><div><strong>Workspace riêng</strong><small>Dữ liệu được cách ly theo workspace. Tài khoản thành viên chỉ nhìn thấy dữ liệu trong workspace này.</small></div></div><div class="check-item"><span class="check-icon">✓</span><div><strong>Vai trò hiện tại: ${esc(userInfo.role)}</strong><small>${esc(userInfo.email)} · ${esc(userInfo.plan||'trial')}</small></div></div><div class="footnote">Mỗi lần ghi dữ liệu được lưu cục bộ trước, sau đó đồng bộ theo phiên bản lên máy chủ. Khi hai thiết bị sửa đồng thời, ứng dụng sẽ cảnh báo thay vì ghi đè âm thầm.</div></div><div>${manager?`<h3>Thêm thành viên</h3><form id="memberForm"><div class="form-grid"><div class="field"><label>Họ tên *</label><input name="name" required maxlength="120"></div><div class="field"><label>Email *</label><input name="email" type="email" required maxlength="255"></div><div class="field"><label>Mật khẩu khởi tạo *</label><input name="password" type="password" required minlength="10" maxlength="200"></div><div class="field"><label>Vai trò</label><select name="role"><option value="editor">Nhập liệu</option><option value="manager">Quản lý</option><option value="viewer">Chỉ xem</option></select></div></div><div class="form-actions"><button class="btn btn-primary" type="submit">＋ Tạo tài khoản thành viên</button></div></form>`:`<p class="sub">Chỉ chủ workspace mới được thêm hoặc khóa tài khoản.</p>`}</div></div><div class="section-row"><h3>Thành viên workspace</h3><button type="button" class="btn btn-small" data-refresh-members>Làm mới</button></div>${rows?`<div class="table-wrap"><table><thead><tr><th>THÀNH VIÊN</th><th>VAI TRÒ</th><th>TRẠNG THÁI</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`:`<div class="empty"><h3>Không tải được danh sách</h3><p>Kiểm tra quyền tài khoản hoặc kết nối máy chủ.</p></div>`}</section>`;
  }
  async function submitMember(form) {
    if(userInfo?.role!=='owner'){toast('Chỉ chủ workspace mới được thêm thành viên.','error');return;}
    const d=formObject(form);try{await apiFetch('/api/members',{method:'POST',body:JSON.stringify({name:d.name,email:d.email,password:d.password,role:d.role})});toast('Đã tạo tài khoản thành viên. Hãy gửi thông tin đăng nhập an toàn cho nhân viên.');form.reset();await loadTeamMembers();if(activeTab==='settings')render();}catch(e){toast(e.message||'Không tạo được thành viên.','error');}
  }
  async function setMemberStatus(memberId, isActive) {
    try{await apiFetch(`/api/members/${encodeURIComponent(memberId)}/status`,{method:'PATCH',body:JSON.stringify({isActive})});toast(isActive?'Đã mở khóa thành viên.':'Đã khóa và thu hồi phiên đăng nhập của thành viên.');await loadTeamMembers();if(activeTab==='settings')render();}catch(e){toast(e.message||'Không thể cập nhật thành viên.','error');}
  }
  function createFarm(form) {
    if(readOnlyMode){toast('Tài khoản chỉ xem không thể tạo trang trại.','error');return;}
    const d=formObject(form), name=(d.newFarmName||'').trim(); if(name.length<2){toast('Tên trang trại cần ít nhất 2 ký tự.','error');return;}
    const exists=(db.settings.farms||[]).some(f=>f.name.toLowerCase()===name.toLowerCase());if(exists){toast('Tên trang trại này đã tồn tại trong workspace.','error');return;}
    const farm={id:'farm-'+id(),name,createdAt:new Date().toISOString()};db.settings.farms.push(farm);activeFarmId=farm.id;activeBatchId='';db.settings.farmName=name;saveDB();render();toast('Đã tạo trang trại. Tiếp theo hãy tạo lứa nuôi.');
  }

'''
if marker not in s: print('Backend JS insertion marker missing')
s=s.replace(marker, backend_js+marker)
f.write_text(s,encoding='utf-8')

# Update index navigation and add authentication/team controls.
p=p/'index.html'
h=p.read_text(encoding='utf-8')
h=h.replace('<button class="icon-button" id="exportTop" title="Sao lưu dữ liệu" aria-label="Sao lưu dữ liệu">⇩</button>', '<button class="icon-button" id="syncNow" title="Đồng bộ máy chủ" aria-label="Đồng bộ máy chủ">⟳</button><button class="icon-button" id="exportTop" title="Sao lưu dữ liệu" aria-label="Sao lưu dữ liệu">⇩</button><div id="accountControls" class="account-controls" hidden><span id="accountUser">Tài khoản</span><button id="accountLogout" class="btn btn-small" type="button">Đăng xuất</button></div>')
h=h.replace('<div><span class="eyebrow">TRANG TRẠI</span><strong id="farmTitle">Trang trại của tôi</strong></div>', '<div class="farm-context"><span class="eyebrow">WORKSPACE / TRANG TRẠI</span><strong id="farmTitle">Trang trại của tôi</strong><label class="farm-selector-label" for="activeFarm">Chuyển trang trại</label><select id="activeFarm" aria-label="Chọn trang trại"><option value="">Trang trại của tôi</option></select></div>')
h=h.replace('<button class="nav-item" data-tab="costs"><span>₫</span>Chi phí</button>\n      <button class="nav-item" data-tab="reports">', '<button class="nav-item" data-tab="costs"><span>₫</span>Chi phí</button>\n      <button class="nav-item" data-tab="sales"><span>↗</span>Doanh thu / bán heo</button>\n      <button class="nav-item" data-tab="pigs"><span>▦</span>Hồ sơ heo / QR</button>\n      <button class="nav-item" data-tab="reports">')
h=h.replace('Phiên bản MVP 1.1 — Cám theo giai đoạn</span><span>Dữ liệu lưu trên thiết bị này · Hãy sao lưu định kỳ', 'Phiên bản 1.2 — Đa trại / Cloud sync</span><span>Dữ liệu được lưu cục bộ và đồng bộ theo workspace khi đăng nhập')
h=h.replace('  <div id="toastRegion"', '  <div id="authLayer" class="auth-layer" hidden></div>\n  <div id="toastRegion"')
h=h.replace('<script src="app.js"></script>', '<script src="app.js?v=1.2.0"></script>')
p.write_text(h,encoding='utf-8')
