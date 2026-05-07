// ===================== DATA =====================
const ACCOUNTS = {
  teacher: { id:'teacher', pw:'teacher123', role:'teacher', name:'선생님' },
  student1: { id:'student1', pw:'pass1234', role:'student', name:'김민준', grade:'3학년 2반' },
  student2: { id:'student2', pw:'pass1234', role:'student', name:'이서연', grade:'3학년 2반' },
  student3: { id:'student3', pw:'pass1234', role:'student', name:'박지호', grade:'3학년 2반' },
};

const CATEGORY_EMOJI = { '문구':'✏️','도서':'📖','실험도구':'🔬','체육용품':'⚽','기타':'📦' };

function loadData() {
  return JSON.parse(localStorage.getItem('classroomData') || 'null') || getInitialData();
}
function saveData(d) { localStorage.setItem('classroomData', JSON.stringify(d)); }

function getInitialData() {
  const items = [
    { id:'ITEM-001', name:'가위', category:'문구', quantity:3, desc:'일반 가위', maxDays:3 },
    { id:'ITEM-002', name:'자 (30cm)', category:'문구', quantity:5, desc:'플라스틱 30cm 자', maxDays:3 },
    { id:'ITEM-003', name:'풀', category:'문구', quantity:4, desc:'딱풀', maxDays:3 },
    { id:'ITEM-004', name:'국어 사전', category:'도서', quantity:2, desc:'초등 국어 사전', maxDays:7 },
    { id:'ITEM-005', name:'계산기', category:'기타', quantity:6, desc:'일반 계산기', maxDays:1 },
    { id:'ITEM-006', name:'색연필 세트', category:'문구', quantity:4, desc:'12색 색연필', maxDays:3 },
  ];
  const d = { items, history: [], nextItemId: 7 };
  saveData(d); return d;
}

let db = loadData();
let currentUser = null;
let selectedRole = 'teacher';
let scannerInstance = null;
let pendingBorrowItemId = null;

// ===================== UTILS =====================
function genId() { return 'ITEM-' + String(db.nextItemId++).padStart(3,'0'); }
function now() { return new Date().toISOString(); }
function fmt(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function isOverdue(borrowedAt, maxDays) {
  if (!borrowedAt || !maxDays) return false;
  return (Date.now() - new Date(borrowedAt)) > maxDays * 86400000;
}
function getItemStatus(item) {
  const active = db.history.find(h => h.itemId === item.id && !h.returnedAt);
  if (!active) return { status:'available', label:'대여 가능', css:'available' };
  if (isOverdue(active.borrowedAt, item.maxDays)) return { status:'overdue', label:'연체 중', css:'overdue' };
  return { status:'borrowed', label:'대여 중', css:'borrowed' };
}

// ===================== AUTH =====================
function selectRole(role) {
  selectedRole = role;
  document.getElementById('roleTeacher').classList.toggle('active', role==='teacher');
  document.getElementById('roleStudent').classList.toggle('active', role==='student');
}

function handleLogin(e) {
  e.preventDefault();
  const id = document.getElementById('loginId').value.trim();
  const pw = document.getElementById('loginPw').value;
  const err = document.getElementById('loginError');
  const acc = ACCOUNTS[id];
  if (!acc || acc.pw !== pw || acc.role !== selectedRole) {
    err.classList.remove('hidden'); return;
  }
  err.classList.add('hidden');
  currentUser = acc;
  if (acc.role === 'teacher') showAdmin();
  else showStudent();
}

function logout() {
  stopScan();
  currentUser = null;
  showPage('page-login');
  document.getElementById('loginId').value = '';
  document.getElementById('loginPw').value = '';
}

// ===================== NAVIGATION =====================
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showAdmin() {
  db = loadData();
  document.getElementById('adminUserName').textContent = currentUser.name;
  showPage('page-admin');
  adminTab('dashboard');
}

function showStudent() {
  db = loadData();
  document.getElementById('studentUserName').textContent = currentUser.name;
  showPage('page-student');
  studentTab('scan');
}

function adminTab(tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('sideBtn-' + tab).classList.add('active');
  db = loadData();
  if (tab === 'dashboard') renderDashboard();
  else if (tab === 'items') renderItems();
  else if (tab === 'history') renderHistory();
  else if (tab === 'students') renderStudents();
}

function studentTab(tab) {
  document.querySelectorAll('.student-tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.student-tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('stTab-' + tab).classList.add('active');
  document.getElementById('stBtn-' + tab).classList.add('active');
  db = loadData();
  if (tab === 'myborrow') renderMyBorrow();
  else if (tab === 'catalog') renderCatalog();
}

// ===================== ADMIN: DASHBOARD =====================
function renderDashboard() {
  const total = db.items.length;
  const borrowed = db.history.filter(h => !h.returnedAt).length;
  const available = db.items.filter(item => !db.history.find(h => h.itemId === item.id && !h.returnedAt)).length;
  const overdue = db.history.filter(h => {
    if (h.returnedAt) return false;
    const item = db.items.find(i => i.id === h.itemId);
    return item && isOverdue(h.borrowedAt, item.maxDays);
  }).length;

  document.getElementById('statTotalItems').textContent = total;
  document.getElementById('statBorrowed').textContent = borrowed;
  document.getElementById('statAvailable').textContent = available;
  document.getElementById('statOverdue').textContent = overdue;

  // Current borrows
  const activeLogs = db.history.filter(h => !h.returnedAt);
  const bl = document.getElementById('currentBorrowList');
  if (!activeLogs.length) { bl.innerHTML = '<div class="empty-state"><div class="empty-state-icon">✅</div><p>현재 대여 중인 비품이 없습니다</p></div>'; }
  else {
    bl.innerHTML = activeLogs.map(h => {
      const item = db.items.find(i => i.id === h.itemId);
      const od = item && isOverdue(h.borrowedAt, item.maxDays);
      return `<div class="borrow-item">
        <div class="borrow-item-avatar">${CATEGORY_EMOJI[item?.category]||'📦'}</div>
        <div class="borrow-item-info">
          <div class="borrow-item-name">${item?.name||h.itemId} ${od?'<span class="overdue-tag">연체</span>':''}</div>
          <div class="borrow-item-sub">${h.studentName} · ${fmt(h.borrowedAt)}</div>
        </div></div>`;
    }).join('');
  }

  // Recent activity
  const recent = [...db.history].sort((a,b) => new Date(b.borrowedAt)-new Date(a.borrowedAt)).slice(0,8);
  const al = document.getElementById('recentActivityList');
  if (!recent.length) { al.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><p>대여 이력이 없습니다</p></div>'; }
  else {
    al.innerHTML = recent.map(h => {
      const item = db.items.find(i => i.id === h.itemId);
      const action = h.returnedAt ? '반납' : '대여';
      const actionTime = h.returnedAt ? h.returnedAt : h.borrowedAt;
      return `<div class="activity-item">
        <div class="activity-avatar">${h.returnedAt?'↩️':'📤'}</div>
        <div class="borrow-item-info">
          <div class="borrow-item-name">${h.studentName} · ${action}</div>
          <div class="borrow-item-sub">${item?.name||h.itemId} · ${fmt(actionTime)}</div>
        </div></div>`;
    }).join('');
  }
}

// ===================== ADMIN: ITEMS =====================
function renderItems() {
  const g = document.getElementById('itemsGrid');
  if (!db.items.length) { g.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📦</div><p>등록된 비품이 없습니다</p></div>'; return; }
  g.innerHTML = db.items.map(item => {
    const st = getItemStatus(item);
    const active = db.history.find(h => h.itemId === item.id && !h.returnedAt);
    return `<div class="item-card ${st.status==='available'?'':'unavailable'}">
      <div class="item-emoji">${CATEGORY_EMOJI[item.category]||'📦'}</div>
      <div class="item-qr-preview" onclick="event.stopPropagation(); showQR('${item.id}')" title="클릭하여 크게 보기">
        <img data-qr-id="${item.id}" alt="QR Code" />
      </div>
      <div class="item-card-name">${item.name}</div>
      <div class="item-card-cat">${item.category} · 최대 ${item.maxDays}일</div>
      ${item.desc ? `<div class="item-desc">${item.desc}</div>` : ''}
      <div class="item-status-badge status-${st.css}">${st.label}${active ? ' · '+active.studentName : ''}</div>
      <div class="item-meta" style="margin-bottom:12px">ID: ${item.id}</div>
      <div class="item-card-actions">
        <button class="btn-icon" onclick="showQR('${item.id}')">🔲 크게 보기</button>
        <button class="btn-icon" onclick="openEditItem('${item.id}')">✏️ 수정</button>
        <button class="btn-danger" onclick="deleteItem('${item.id}')">🗑️ 삭제</button>
      </div>
    </div>`;
  }).join('');
  generateAllQRs();
}

function openAddItemModal() {
  document.getElementById('modalItemTitle').textContent = '비품 추가';
  document.getElementById('itemName').value = '';
  document.getElementById('itemCategory').value = '문구';
  document.getElementById('itemQuantity').value = 1;
  document.getElementById('itemDesc').value = '';
  document.getElementById('itemMaxDays').value = 7;
  document.getElementById('editItemId').value = '';
  openModal('modal-item');
}

function openEditItem(id) {
  const item = db.items.find(i => i.id === id);
  if (!item) return;
  document.getElementById('modalItemTitle').textContent = '비품 수정';
  document.getElementById('itemName').value = item.name;
  document.getElementById('itemCategory').value = item.category;
  document.getElementById('itemQuantity').value = item.quantity;
  document.getElementById('itemDesc').value = item.desc || '';
  document.getElementById('itemMaxDays').value = item.maxDays;
  document.getElementById('editItemId').value = id;
  openModal('modal-item');
}

function saveItem(e) {
  e.preventDefault();
  const editId = document.getElementById('editItemId').value;
  const data = {
    name: document.getElementById('itemName').value.trim(),
    category: document.getElementById('itemCategory').value,
    quantity: parseInt(document.getElementById('itemQuantity').value)||1,
    desc: document.getElementById('itemDesc').value.trim(),
    maxDays: parseInt(document.getElementById('itemMaxDays').value)||7,
  };
  if (editId) {
    const idx = db.items.findIndex(i => i.id === editId);
    if (idx >= 0) db.items[idx] = { ...db.items[idx], ...data };
  } else {
    db.items.push({ id: genId(), ...data });
  }
  saveData(db);
  closeModal('modal-item');
  renderItems();
}

function deleteItem(id) {
  const active = db.history.find(h => h.itemId === id && !h.returnedAt);
  if (active) { alert('현재 대여 중인 비품은 삭제할 수 없습니다.'); return; }
  if (!confirm('이 비품을 삭제하시겠습니까?')) return;
  db.items = db.items.filter(i => i.id !== id);
  saveData(db);
  renderItems();
}

// ===================== QR CODE =====================
function generateAllQRs() {
  document.querySelectorAll('img[data-qr-id]').forEach(img => {
    const id = img.getAttribute('data-qr-id');
    img.src = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(id)}&size=120x120&color=000000&bgcolor=ffffff&margin=2`;
  });
}

function showQR(itemId) {
  const item = db.items.find(i => i.id === itemId);
  if (!item) return;
  
  document.getElementById('qrItemName').textContent = item.name;
  document.getElementById('qrItemId').textContent = itemId;
  const container = document.getElementById('qrCodeCanvas');
  
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(itemId)}&size=300x300&color=000000&bgcolor=ffffff&margin=2`;
  container.innerHTML = `<img src="${qrUrl}" style="width:100%; display:block; border-radius:8px;" alt="Item QR" />`;
  
  openModal('modal-qr');
}

function printQR() { window.print(); }

// ===================== ADMIN: HISTORY =====================
function renderHistory() {
  const search = (document.getElementById('historySearch')?.value || '').toLowerCase();
  const filter = document.getElementById('historyFilter')?.value || 'all';
  let list = [...db.history].sort((a,b) => new Date(b.borrowedAt)-new Date(a.borrowedAt));
  if (search) list = list.filter(h => h.studentName.toLowerCase().includes(search) || (db.items.find(i=>i.id===h.itemId)?.name||'').toLowerCase().includes(search));
  if (filter === 'borrowed') list = list.filter(h => !h.returnedAt);
  if (filter === 'returned') list = list.filter(h => !!h.returnedAt);
  const body = document.getElementById('historyBody');
  if (!list.length) { body.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text2)">이력이 없습니다</td></tr>`; return; }
  body.innerHTML = list.map((h, i) => {
    const item = db.items.find(it => it.id === h.itemId);
    const st = h.returnedAt ? '<span class="item-status-badge status-available">반납완료</span>' : `<span class="item-status-badge status-${isOverdue(h.borrowedAt, item?.maxDays)?'overdue':'borrowed'}">${isOverdue(h.borrowedAt, item?.maxDays)?'연체중':'대여중'}</span>`;
    return `<tr>
      <td>${i+1}</td><td>${h.studentName}</td><td>${item?.name||h.itemId}</td>
      <td>${fmt(h.borrowedAt)}</td><td>${fmt(h.returnedAt)}</td><td>${st}</td>
    </tr>`;
  }).join('');
}

// ===================== ADMIN: STUDENTS =====================
function renderStudents() {
  const students = Object.values(ACCOUNTS).filter(a => a.role === 'student');
  const g = document.getElementById('studentsList');
  g.innerHTML = students.map(s => {
    const active = db.history.filter(h => h.studentId === s.id && !h.returnedAt);
    const total = db.history.filter(h => h.studentId === s.id).length;
    return `<div class="student-card">
      <div class="student-avatar">🎒</div>
      <div class="student-name">${s.name}</div>
      <div class="student-id">${s.grade||''} · 총 대여 ${total}건</div>
      <div class="student-borrow-list">
        ${active.length ? active.map(h => {
          const item = db.items.find(i=>i.id===h.itemId);
          return `<div class="student-borrow-item"><span>${item?.name||h.itemId}</span><span style="color:var(--yellow)">${fmt(h.borrowedAt).split(' ')[0]}</span></div>`;
        }).join('') : '<div style="color:var(--text2);font-size:13px;padding:6px 0">현재 대여 중인 비품 없음</div>'}
      </div>
    </div>`;
  }).join('');
}

// ===================== STUDENT: QR SCAN =====================
function startScan() {
  document.getElementById('startScanBtn').classList.add('hidden');
  document.getElementById('stopScanBtn').classList.remove('hidden');
  scannerInstance = new Html5Qrcode('qr-reader');
  scannerInstance.start(
    { facingMode: 'environment' },
    { fps:10, qrbox:{ width:220, height:220 } },
    qrText => { stopScan(); processQR(qrText); },
    err => {}
  ).catch(() => {
    showScanResult(false, '카메라 접근 권한이 필요합니다. 수동 입력을 이용해 주세요.');
    document.getElementById('startScanBtn').classList.remove('hidden');
    document.getElementById('stopScanBtn').classList.add('hidden');
  });
}

function stopScan() {
  if (scannerInstance) {
    scannerInstance.stop().catch(()=>{});
    scannerInstance = null;
  }
  document.getElementById('startScanBtn').classList.remove('hidden');
  document.getElementById('stopScanBtn').classList.add('hidden');
}

function manualScan() {
  const val = document.getElementById('manualQrInput').value.trim();
  if (!val) return;
  processQR(val);
  document.getElementById('manualQrInput').value = '';
}

function processQR(itemId) {
  db = loadData();
  const item = db.items.find(i => i.id === itemId);
  if (!item) { showScanResult(false, `⚠️ 비품을 찾을 수 없습니다: ${itemId}`); return; }
  const active = db.history.find(h => h.itemId === itemId && !h.returnedAt);
  pendingBorrowItemId = itemId;
  const bm = document.getElementById('borrowModalTitle');
  const bi = document.getElementById('borrowItemIcon');
  const bn = document.getElementById('borrowItemName');
  const bs = document.getElementById('borrowItemStatus');
  const bc = document.getElementById('borrowConfirmMsg');
  const btn = document.getElementById('borrowConfirmBtn');
  bi.textContent = CATEGORY_EMOJI[item.category]||'📦';
  bn.textContent = item.name;
  if (active) {
    if (active.studentId !== currentUser.id) {
      showScanResult(false, `⚠️ ${active.studentName} 학생이 대여 중입니다.`); pendingBorrowItemId=null; return;
    }
    bm.textContent = '비품 반납';
    bs.textContent = `대여일: ${fmt(active.borrowedAt)}`;
    bc.textContent = '이 비품을 반납하시겠습니까?';
    btn.textContent = '반납하기';
    btn.style.background = 'linear-gradient(135deg,#10b981,#059669)';
  } else {
    bm.textContent = '비품 대여';
    bs.textContent = `최대 ${item.maxDays}일 대여 가능`;
    bc.textContent = '이 비품을 대여하시겠습니까?';
    btn.textContent = '대여하기';
    btn.style.background = '';
  }
  openModal('modal-borrow');
}

function confirmBorrow() {
  if (!pendingBorrowItemId) return;
  db = loadData();
  const itemId = pendingBorrowItemId;
  const active = db.history.find(h => h.itemId === itemId && !h.returnedAt);
  if (active) {
    active.returnedAt = now();
    showScanResult(true, `✅ 반납 완료: ${db.items.find(i=>i.id===itemId)?.name}`);
  } else {
    db.history.push({ id: Date.now(), itemId, studentId: currentUser.id, studentName: currentUser.name, borrowedAt: now(), returnedAt: null });
    showScanResult(true, `✅ 대여 완료: ${db.items.find(i=>i.id===itemId)?.name}`);
  }
  saveData(db);
  pendingBorrowItemId = null;
  closeModal('modal-borrow');
}

function showScanResult(ok, msg) {
  const el = document.getElementById('scan-result');
  el.className = 'scan-result ' + (ok ? 'success' : 'error');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

// ===================== STUDENT: MY BORROW =====================
function renderMyBorrow() {
  const active = db.history.filter(h => h.studentId === currentUser.id && !h.returnedAt);
  const el = document.getElementById('myBorrowList');
  if (!active.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><p>현재 대여 중인 비품이 없습니다</p></div>';
    return;
  }
  el.innerHTML = active.map(h => {
    const item = db.items.find(i => i.id === h.itemId);
    const od = item && isOverdue(h.borrowedAt, item.maxDays);
    const due = item ? new Date(new Date(h.borrowedAt).getTime() + item.maxDays*86400000) : null;
    return `<div class="my-borrow-card">
      <div class="my-borrow-icon">${CATEGORY_EMOJI[item?.category]||'📦'}</div>
      <div class="my-borrow-info">
        <div class="my-borrow-name">${item?.name||h.itemId}</div>
        <div class="my-borrow-date">대여일: ${fmt(h.borrowedAt)}</div>
        <div class="my-borrow-due ${od?'overdue':''}">${od?'⚠️ 연체 중':'📅 반납 기한: '+fmt(due?.toISOString())}</div>
      </div>
      <button class="btn-secondary" onclick="quickReturn('${h.itemId}')">반납</button>
    </div>`;
  }).join('');
}

function quickReturn(itemId) {
  if (!confirm('반납하시겠습니까?')) return;
  db = loadData();
  const active = db.history.find(h => h.itemId === itemId && !h.returnedAt);
  if (active) { active.returnedAt = now(); saveData(db); }
  renderMyBorrow();
}

// ===================== STUDENT: CATALOG =====================
function renderCatalog() {
  const g = document.getElementById('catalogGrid');
  if (!db.items.length) { g.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📦</div><p>등록된 비품이 없습니다</p></div>'; return; }
  g.innerHTML = db.items.map(item => {
    const st = getItemStatus(item);
    const active = db.history.find(h => h.itemId === item.id && !h.returnedAt);
    return `<div class="item-card ${st.status==='available'?'':'unavailable'}" onclick="processQR('${item.id}')">
      <div class="item-emoji">${CATEGORY_EMOJI[item.category]||'📦'}</div>
      <div class="item-qr-preview">
        <img data-qr-id="${item.id}" alt="QR" />
      </div>
      <div class="item-card-name">${item.name}</div>
      <div class="item-card-cat">${item.category} · 최대 ${item.maxDays}일</div>
      ${item.desc ? `<div class="item-desc">${item.desc}</div>` : ''}
      <div class="item-status-badge status-${st.css}">${st.label}${active&&active.studentId===currentUser.id?' (내가 대여 중)':''}</div>
      <div class="item-meta">클릭하여 대여/반납하기</div>
    </div>`;
  }).join('');
  generateAllQRs();
}

// ===================== MODAL HELPERS =====================
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function closeModalOutside(e, id) { if (e.target.id === id) closeModal(id); }

// ===================== INIT =====================
document.addEventListener('DOMContentLoaded', () => {
  db = loadData();
  document.getElementById('page-login').classList.add('active');
});
