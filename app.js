// ===================== FIREBASE CONFIG =====================
// [주의] 아래 내용을 본인의 Firebase 콘솔에서 복사한 내용으로 반드시 교체하세요!
const firebaseConfig = {
  apiKey: "AIzaSyCLcvn0LL6I1pWnJ54Pi5Z3mHMzkerd_TM",
  authDomain: "school-supplies-rental-system.firebaseapp.com",
  projectId: "school-supplies-rental-system",
  storageBucket: "school-supplies-rental-system.firebasestorage.app",
  messagingSenderId: "212323277172",
  appId: "1:212323277172:web:6828275c6779c54f2cb421"
};

// Firebase 초기화
firebase.initializeApp(firebaseConfig);
const fdb = firebase.firestore();

// ===================== DATA & ACCOUNTS =====================
const ACCOUNTS = {
  teacher: { id: 'teacher', pw: 'teacher123', role: 'teacher', name: '선생님' },
  student1: { id: 'student1', pw: 'pass1234', role: 'student', name: '김민준', grade: '3학년 2반' },
  student2: { id: 'student2', pw: 'pass1234', role: 'student', name: '이서연', grade: '3학년 2반' },
  student3: { id: 'student3', pw: 'pass1234', role: 'student', name: '박지호', grade: '3학년 2반' },
};

const CATEGORY_EMOJI = { '문구': '✏️', '도서': '📖', '실험도구': '🔬', '체육용품': '⚽', '기타': '📦' };

// 전역 상태 (Firebase 리스너에 의해 실시간 업데이트됨)
let db = { items: [], history: [], nextItemId: 100 };
let currentUser = null;
let selectedRole = 'teacher';
let scannerInstance = null;
let pendingBorrowItemId = null;

// ===================== REAL-TIME SYNC =====================
function initRealtimeSync() {
  // 1. 비품 목록 실시간 감시
  fdb.collection("items").onSnapshot((snapshot) => {
    db.items = snapshot.docs.map(doc => ({ ...doc.data(), firestoreId: doc.id }));
    if (db.items.length === 0) seedInitialData(); // 최초 실행 시 데이터 생성
    refreshCurrentUI();
  });

  // 2. 대여 이력 실시간 감시
  fdb.collection("history").onSnapshot((snapshot) => {
    db.history = snapshot.docs.map(doc => ({ ...doc.data(), firestoreId: doc.id }));
    refreshCurrentUI();
  });
}

function refreshCurrentUI() {
  const activePage = document.querySelector('.page.active').id;
  if (activePage === 'page-admin') {
    const activeTab = document.querySelector('.tab-content.active').id.replace('tab-', '');
    adminTab(activeTab);
  } else if (activePage === 'page-student') {
    const activeTab = document.querySelector('.student-tab-content.active').id.replace('stTab-', '');
    studentTab(activeTab);
  }
}

// 최초 데이터가 없을 때 기본 비품 등록
async function seedInitialData() {
  const initialItems = [
    { id: 'ITEM-001', name: '가위', category: '문구', quantity: 3, desc: '일반 가위', maxDays: 3 },
    { id: 'ITEM-002', name: '자 (30cm)', category: '문구', quantity: 5, desc: '플라스틱 30cm 자', maxDays: 3 },
    { id: 'ITEM-003', name: '풀', category: '문구', quantity: 4, desc: '딱풀', maxDays: 3 },
    { id: 'ITEM-004', name: '국어 사전', category: '도서', quantity: 2, desc: '초등 국어 사전', maxDays: 7 },
    { id: 'ITEM-005', name: '계산기', category: '기타', quantity: 6, desc: '일반 계산기', maxDays: 1 },
    { id: 'ITEM-006', name: '색연필 세트', category: '문구', quantity: 4, desc: '12색 색연필', maxDays: 3 },
  ];
  for (const item of initialItems) {
    await fdb.collection("items").doc(item.id).set(item);
  }
}

// ===================== UTILS =====================
function genId() { return 'ITEM-' + Math.floor(Math.random() * 1000000); }
function now() { return new Date().toISOString(); }
function fmt(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function isOverdue(borrowedAt, maxDays) {
  if (!borrowedAt || !maxDays) return false;
  return (Date.now() - new Date(borrowedAt)) > maxDays * 86400000;
}
function getItemStatus(item) {
  const active = db.history.find(h => h.itemId === item.id && !h.returnedAt);
  if (!active) return { status: 'available', label: '대여 가능', css: 'available' };
  if (isOverdue(active.borrowedAt, item.maxDays)) return { status: 'overdue', label: '연체 중', css: 'overdue' };
  return { status: 'borrowed', label: '대여 중', css: 'borrowed' };
}

// ===================== AUTH =====================
function selectRole(role) {
  selectedRole = role;
  document.getElementById('roleTeacher').classList.toggle('active', role === 'teacher');
  document.getElementById('roleStudent').classList.toggle('active', role === 'student');
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
}

// ===================== NAVIGATION =====================
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showAdmin() {
  document.getElementById('adminUserName').textContent = currentUser.name;
  showPage('page-admin');
  adminTab('dashboard');
}

function showStudent() {
  document.getElementById('studentUserName').textContent = currentUser.name;
  showPage('page-student');
  studentTab('scan');
}

function adminTab(tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('sideBtn-' + tab).classList.add('active');
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
  if (tab === 'myborrow') renderMyBorrow();
  else if (tab === 'catalog') renderCatalog();
}

// ===================== ADMIN: DASHBOARD =====================
function renderDashboard() {
  const total = db.items.length;
  const borrowed = db.history.filter(h => !h.returnedAt).length;
  const available = total - borrowed;
  const overdue = db.history.filter(h => {
    if (h.returnedAt) return false;
    const item = db.items.find(i => i.id === h.itemId);
    return item && isOverdue(h.borrowedAt, item.maxDays);
  }).length;

  document.getElementById('statTotalItems').textContent = total;
  document.getElementById('statBorrowed').textContent = borrowed;
  document.getElementById('statAvailable').textContent = available;
  document.getElementById('statOverdue').textContent = overdue;

  const activeLogs = db.history.filter(h => !h.returnedAt);
  const bl = document.getElementById('currentBorrowList');
  if (!activeLogs.length) { bl.innerHTML = '<div class="empty-state">✅ 현재 대여 중인 비품이 없습니다</div>'; }
  else {
    bl.innerHTML = activeLogs.map(h => {
      const item = db.items.find(i => i.id === h.itemId);
      const od = item && isOverdue(h.borrowedAt, item.maxDays);
      return `<div class="borrow-item">
        <div class="borrow-item-avatar">${CATEGORY_EMOJI[item?.category] || '📦'}</div>
        <div class="borrow-item-info">
          <div class="borrow-item-name">${item?.name || h.itemId} ${od ? '<span class="overdue-tag">연체</span>' : ''}</div>
          <div class="borrow-item-sub">${h.studentName} · ${fmt(h.borrowedAt)}</div>
        </div></div>`;
    }).join('');
  }

  const recent = [...db.history].sort((a, b) => new Date(b.borrowedAt) - new Date(a.borrowedAt)).slice(0, 8);
  const al = document.getElementById('recentActivityList');
  if (!recent.length) { al.innerHTML = '<div class="empty-state">📋 대여 이력이 없습니다</div>'; }
  else {
    al.innerHTML = recent.map(h => {
      const item = db.items.find(i => i.id === h.itemId);
      const action = h.returnedAt ? '반납' : '대여';
      const actionTime = h.returnedAt ? h.returnedAt : h.borrowedAt;
      return `<div class="activity-item">
        <div class="activity-avatar">${h.returnedAt ? '↩️' : '📤'}</div>
        <div class="borrow-item-info">
          <div class="borrow-item-name">${h.studentName} · ${action}</div>
          <div class="borrow-item-sub">${item?.name || h.itemId} · ${fmt(actionTime)}</div>
        </div></div>`;
    }).join('');
  }
}

// ===================== ADMIN: ITEMS =====================
function renderItems() {
  const g = document.getElementById('itemsGrid');
  if (!db.items.length) { g.innerHTML = '<div class="empty-state">등록된 비품이 없습니다</div>'; return; }
  g.innerHTML = db.items.map(item => {
    const st = getItemStatus(item);
    const active = db.history.find(h => h.itemId === item.id && !h.returnedAt);
    return `<div class="item-card ${st.status === 'available' ? '' : 'unavailable'}">
      <div class="item-emoji">${CATEGORY_EMOJI[item.category] || '📦'}</div>
      <div class="item-qr-preview" onclick="event.stopPropagation(); showQR('${item.id}')">
        <img data-qr-id="${item.id}" alt="QR" />
      </div>
      <div class="item-card-name">${item.name}</div>
      <div class="item-card-cat">${item.category} · ${item.maxDays}일</div>
      <div class="item-status-badge status-${st.css}">${st.label}${active ? ' · ' + active.studentName : ''}</div>
      <div class="item-card-actions">
        <button class="btn-icon" onclick="openEditItem('${item.id}')">✏️ 수정</button>
        <button class="btn-danger" onclick="deleteItem('${item.id}')">🗑️ 삭제</button>
      </div>
    </div>`;
  }).join('');
  generateAllQRs();
}

async function saveItem(e) {
  e.preventDefault();
  const editId = document.getElementById('editItemId').value;
  const data = {
    name: document.getElementById('itemName').value.trim(),
    category: document.getElementById('itemCategory').value,
    quantity: parseInt(document.getElementById('itemQuantity').value) || 1,
    desc: document.getElementById('itemDesc').value.trim(),
    maxDays: parseInt(document.getElementById('itemMaxDays').value) || 7,
  };

  if (editId) {
    await fdb.collection("items").doc(editId).update(data);
  } else {
    const newId = genId();
    await fdb.collection("items").doc(newId).set({ id: newId, ...data });
  }
  closeModal('modal-item');
}

async function deleteItem(id) {
  const active = db.history.find(h => h.itemId === id && !h.returnedAt);
  if (active) { alert('현재 대여 중인 비품은 삭제할 수 없습니다.'); return; }
  if (!confirm('삭제하시겠습니까?')) return;
  await fdb.collection("items").doc(id).delete();
}

// ===================== QR CODE =====================
function generateAllQRs() {
  document.querySelectorAll('img[data-qr-id]').forEach(img => {
    const id = img.getAttribute('data-qr-id');
    img.src = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(id)}&size=120x120`;
  });
}

function showQR(itemId) {
  const item = db.items.find(i => i.id === itemId);
  if (!item) return;
  document.getElementById('qrItemName').textContent = item.name;
  document.getElementById('qrItemId').textContent = itemId;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(itemId)}&size=300x300`;
  document.getElementById('qrCodeCanvas').innerHTML = `<img src="${qrUrl}" style="width:100%; border-radius:8px;" />`;
  openModal('modal-qr');
}

// ===================== ADMIN: HISTORY =====================
function renderHistory() {
  const body = document.getElementById('historyBody');
  let list = [...db.history].sort((a, b) => new Date(b.borrowedAt) - new Date(a.borrowedAt));
  body.innerHTML = list.map((h, i) => {
    const item = db.items.find(it => it.id === h.itemId);
    return `<tr>
      <td>${i + 1}</td><td>${h.studentName}</td><td>${item?.name || h.itemId}</td>
      <td>${fmt(h.borrowedAt)}</td><td>${fmt(h.returnedAt)}</td>
      <td>${h.returnedAt ? '반납완료' : '대여중'}</td>
    </tr>`;
  }).join('');
}

// ===================== STUDENT: PROCESS QR =====================
async function confirmBorrow() {
  if (!pendingBorrowItemId) return;
  const itemId = pendingBorrowItemId;
  const active = db.history.find(h => h.itemId === itemId && !h.returnedAt);

  if (active) {
    // 반납 처리
    await fdb.collection("history").doc(active.firestoreId).update({ returnedAt: now() });
    showScanResult(true, `✅ 반납 완료`);
  } else {
    // 대여 처리
    await fdb.collection("history").add({
      itemId,
      studentId: currentUser.id,
      studentName: currentUser.name,
      borrowedAt: now(),
      returnedAt: null
    });
    showScanResult(true, `✅ 대여 완료`);
  }
  closeModal('modal-borrow');
  pendingBorrowItemId = null;
}

// [기타 UI 함수들은 기존과 거의 동일하나 Firebase 연동에 맞춰 일부 수정됨]
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function openAddItemModal() {
  document.getElementById('modalItemTitle').textContent = '비품 추가';
  document.getElementById('editItemId').value = '';
  openModal('modal-item');
}
function openEditItem(id) {
  const item = db.items.find(i => i.id === id);
  document.getElementById('modalItemTitle').textContent = '비품 수정';
  document.getElementById('itemName').value = item.name;
  document.getElementById('editItemId').value = id;
  openModal('modal-item');
}

// 초기화 시작
document.addEventListener('DOMContentLoaded', () => {
  initRealtimeSync();
  showPage('page-login');
});

// 기존 함수들 (일부 생략된 학생 페이지 렌더링 등은 기존 로직 유지)
function renderStudents() { /* ... */ }
function startScan() { /* ... */ }
function stopScan() { /* ... */ }
function processQR(itemId) {
  const item = db.items.find(i => i.id === itemId);
  if (!item) return;
  pendingBorrowItemId = itemId;
  document.getElementById('borrowItemName').textContent = item.name;
  openModal('modal-borrow');
}
function showScanResult(ok, msg) {
  const el = document.getElementById('scan-result');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}
function renderMyBorrow() {
  const active = db.history.filter(h => h.studentId === currentUser.id && !h.returnedAt);
  const el = document.getElementById('myBorrowList');
  el.innerHTML = active.map(h => {
    const item = db.items.find(i => i.id === h.itemId);
    return `<div class="my-borrow-card">
      <div>${item?.name}</div>
      <button onclick="processQR('${h.itemId}')">반납하기</button>
    </div>`;
  }).join('');
}
function renderCatalog() {
  renderItems(); // 관리자 렌더링 함수 재사용 가능하도록 설계됨
}
