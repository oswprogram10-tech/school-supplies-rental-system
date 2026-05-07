// ===================== FIREBASE CONFIG =====================
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

// ===================== DATA =====================
const CATEGORY_EMOJI = { '문구':'✏️','도서':'📖','실험도구':'🔬','체육용품':'⚽','기타':'📦' };

let db = { items: [], history: [] };
let currentUser = null;
let selectedRole = 'teacher';
let scannerInstance = null;
let pendingBorrowItemId = null;

// ===================== REAL-TIME SYNC =====================
function initRealtimeSync() {
  console.log("📡 Firebase 연결 시도 중...");
  
  fdb.collection("items").onSnapshot((snapshot) => {
    console.log("✅ 비품 목록 수신 성공!");
    db.items = snapshot.docs.map(doc => ({ ...doc.data(), firestoreId: doc.id }));
    if (db.items.length === 0) seedInitialData();
    refreshCurrentUI();
  });

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

async function seedInitialData() {
  const initialItems = [
    { id:'ITEM-001', name:'가위', category:'문구', quantity:3, desc:'일반 가위', maxDays:3 },
    { id:'ITEM-002', name:'자 (30cm)', category:'문구', quantity:5, desc:'플라스틱 30cm 자', maxDays:3 },
    { id:'ITEM-003', name:'풀', category:'문구', quantity:4, desc:'딱풀', maxDays:3 },
    { id:'ITEM-004', name:'국어 사전', category:'도서', quantity:2, desc:'초등 국어 사전', maxDays:7 },
    { id:'ITEM-005', name:'계산기', category:'기타', quantity:6, desc:'일반 계산기', maxDays:1 },
    { id:'ITEM-006', name:'색연필 세트', category:'문구', quantity:4, desc:'12색 색연필', maxDays:3 },
  ];
  for (const item of initialItems) {
    await fdb.collection("items").doc(item.id).set(item);
  }
}

// ===================== AUTH LOGIC (Firebase 연동) =====================
function selectRole(role) {
  selectedRole = role;
  document.getElementById('roleTeacher').classList.toggle('active', role==='teacher');
  document.getElementById('roleStudent').classList.toggle('active', role==='student');
}

async function handleLogin(e) {
  e.preventDefault();
  const id = document.getElementById('loginId').value.trim();
  const pw = document.getElementById('loginPw').value;
  const err = document.getElementById('loginError');

  try {
    // 1. 데이터베이스에서 아이디와 비밀번호가 일치하는 유저 찾기
    const userDoc = await fdb.collection("users").doc(id).get();
    
    if (userDoc.exists) {
      const userData = userDoc.data();
      if (userData.pw === pw && userData.role === selectedRole) {
        err.classList.add('hidden');
        currentUser = { id, ...userData };
        if (userData.role === 'teacher') showAdmin();
        else showStudent();
        return;
      }
    }
    // 일치하는 계정이 없거나 비번이 틀린 경우
    err.classList.remove('hidden');
  } catch (error) {
    console.error("Login error:", error);
    alert("로그인 중 오류가 발생했습니다.");
  }
}

async function handleSignUp(e) {
  e.preventDefault();
  const role = document.getElementById('signupRole').value;
  const id = document.getElementById('signupId').value.trim();
  const pw = document.getElementById('signupPw').value;
  const name = document.getElementById('signupName').value.trim();
  const grade = document.getElementById('signupGrade').value.trim();

  try {
    // 아이디 중복 확인
    const checkDoc = await fdb.collection("users").doc(id).get();
    if (checkDoc.exists) {
      alert("이미 존재하는 아이디입니다.");
      return;
    }

    // 새 유저 저장
    await fdb.collection("users").doc(id).set({
      role, pw, name, grade,
      createdAt: now()
    });

    alert("회원가입이 완료되었습니다! 로그인해 주세요.");
    showPage('page-login');
  } catch (error) {
    console.error("Signup error:", error);
    alert("회원가입 실패: " + error.message);
  }
}

async function handleFindAuth(e) {
  e.preventDefault();
  const name = document.getElementById('findName').value.trim();
  const resultBox = document.getElementById('findResult');

  try {
    const snapshot = await fdb.collection("users").where("name", "==", name).get();
    
    if (snapshot.empty) {
      resultBox.innerHTML = "해당 성명으로 가입된 정보를 찾을 수 없습니다.";
    } else {
      let html = "<strong>찾은 계정 정보:</strong><br>";
      snapshot.forEach(doc => {
        const data = doc.data();
        html += `ID: <b>${doc.id}</b> / PW: <b>${data.pw}</b> (${data.role === 'teacher' ? '교사' : '학생'})<br>`;
      });
      resultBox.innerHTML = html;
    }
    resultBox.classList.remove('hidden');
  } catch (error) {
    alert("조회 중 오류가 발생했습니다.");
  }
}

function toggleGradeField() {
  const role = document.getElementById('signupRole').value;
  document.getElementById('gradeField').style.display = (role === 'teacher') ? 'none' : 'block';
}

function logout() {
  stopScan();
  currentUser = null;
  showPage('page-login');
  document.getElementById('loginId').value = '';
  document.getElementById('loginPw').value = '';
}

// ===================== NAVIGATION & RENDER (기존 로직 유지) =====================
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if (id === 'page-signup') toggleGradeField();
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

// ===================== RENDER FUNCTIONS =====================
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
      return `<div class="borrow-item">
        <div class="borrow-item-avatar">${CATEGORY_EMOJI[item?.category]||'📦'}</div>
        <div class="borrow-item-info">
          <div class="borrow-item-name">${item?.name||h.itemId}</div>
          <div class="borrow-item-sub">${h.studentName} · ${fmt(h.borrowedAt)}</div>
        </div></div>`;
    }).join('');
  }
}

function renderItems() {
  const g = document.getElementById('itemsGrid');
  if (!db.items.length) { g.innerHTML = '<div class="empty-state">등록된 비품이 없습니다</div>'; return; }
  g.innerHTML = db.items.map(item => {
    const st = getItemStatus(item);
    const active = db.history.find(h => h.itemId === item.id && !h.returnedAt);
    const imageHtml = item.imgData 
      ? `<div class="item-image"><img src="${item.imgData}" alt="${item.name}"></div>`
      : `<div class="item-emoji">${CATEGORY_EMOJI[item.category]||'📦'}</div>`;

    return `<div class="item-card ${st.status==='available'?'':'unavailable'}">
      ${imageHtml}
      <div class="item-card-name">${item.name}</div>
      <div class="item-card-cat">${item.category}</div>
      <div class="item-status-badge status-${st.css}">${st.label}${active ? ' · '+active.studentName : ''}</div>
      <div class="item-card-actions">
        <button class="btn-icon" onclick="showQR('${item.id}')">🔍 QR 보기</button>
        <button class="btn-icon" onclick="openEditItem('${item.id}')">✏️ 수정</button>
        <button class="btn-danger" onclick="deleteItem('${item.id}')">🗑️ 삭제</button>
      </div>
    </div>`;
  }).join('');
}

function renderCatalog() {
  const g = document.getElementById('catalogGrid');
  if (!g) return;
  g.innerHTML = db.items.map(item => {
    const st = getItemStatus(item);
    const active = db.history.find(h => h.itemId === item.id && !h.returnedAt);
    const imageHtml = item.imgData 
      ? `<div class="item-image"><img src="${item.imgData}" alt="${item.name}"></div>`
      : `<div class="item-emoji">${CATEGORY_EMOJI[item.category]||'📦'}</div>`;

    return `<div class="item-card ${st.status==='available'?'':'unavailable'}" onclick="processQR('${item.id}')">
      ${imageHtml}
      <div class="item-card-name">${item.name}</div>
      <div class="item-card-cat">${item.category} · 최대 ${item.maxDays}일</div>
      <div class="item-status-badge status-${st.css}">${st.label}</div>
      <div class="item-meta">클릭하여 대여/반납하기</div>
    </div>`;
  }).join('');
}

function renderHistory() {
  const body = document.getElementById('historyBody');
  let list = [...db.history].sort((a,b) => new Date(b.borrowedAt)-new Date(a.borrowedAt));
  body.innerHTML = list.map((h, i) => {
    const item = db.items.find(it => it.id === h.itemId);
    return `<tr>
      <td>${i+1}</td><td>${h.studentName}</td><td>${item?.name||h.itemId}</td>
      <td>${fmt(h.borrowedAt)}</td><td>${fmt(h.returnedAt)}</td>
      <td>${h.returnedAt ? '반납완료' : '대여중'}</td>
    </tr>`;
  }).join('');
}

function renderStudents() {
  const list = document.getElementById('studentsList');
  fdb.collection("users").where("role", "==", "student").get().then(snapshot => {
    list.innerHTML = snapshot.docs.map(doc => {
      const s = doc.data();
      const activeCount = db.history.filter(h => h.studentId === doc.id && !h.returnedAt).length;
      return `<div class="student-card">
        <div class="student-avatar">🎒</div>
        <div class="student-name">${s.name}</div>
        <div class="student-id">${s.grade||'학년정보 없음'}</div>
        <div class="student-id">현재 대여 중: ${activeCount}건</div>
      </div>`;
    }).join('');
  });
}

function renderMyBorrow() {
  const active = db.history.filter(h => h.studentId === currentUser.id && !h.returnedAt);
  const el = document.getElementById('myBorrowList');
  el.innerHTML = active.map(h => {
    const item = db.items.find(i => i.id === h.itemId);
    return `<div class="my-borrow-card">
      <div class="my-borrow-info">
        <div class="my-borrow-name">${item?.name}</div>
        <div class="my-borrow-date">대여일: ${fmt(h.borrowedAt)}</div>
      </div>
      <button class="btn-secondary" onclick="processQR('${h.itemId}')">반납하기</button>
    </div>`;
  }).join('');
}

// ===================== IMAGE HANDLING =====================
function previewImage(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = function(e) {
      document.getElementById('imagePreview').innerHTML = `<img src="${e.target.result}" />`;
      document.getElementById('itemImageData').value = e.target.result;
    };
    reader.readAsDataURL(input.files[0]);
  }
}

function clearImagePreview() {
  document.getElementById('imagePreview').innerHTML = '<span>📷 사진 선택 (선택 사항)</span>';
  document.getElementById('itemImageData').value = '';
  document.getElementById('itemImageInput').value = '';
}

// ===================== QR & MODAL UTILS =====================
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

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function closeModalOutside(e, id) { if (e.target.id === id) closeModal(id); }

function openAddItemModal() {
  document.getElementById('modalItemTitle').textContent = '비품 추가';
  document.getElementById('editItemId').value = '';
  document.getElementById('itemName').value = '';
  document.getElementById('itemDesc').value = '';
  clearImagePreview();
  openModal('modal-item');
}

function openEditItem(id) {
  const item = db.items.find(i => i.id === id);
  document.getElementById('modalItemTitle').textContent = '비품 수정';
  document.getElementById('editItemId').value = id;
  document.getElementById('itemName').value = item.name;
  document.getElementById('itemCategory').value = item.category;
  document.getElementById('itemQuantity').value = item.quantity;
  document.getElementById('itemDesc').value = item.desc || '';
  document.getElementById('itemMaxDays').value = item.maxDays;
  
  if (item.imgData) {
    document.getElementById('imagePreview').innerHTML = `<img src="${item.imgData}" />`;
    document.getElementById('itemImageData').value = item.imgData;
  } else {
    clearImagePreview();
  }
  openModal('modal-item');
}

async function saveItem(e) {
  e.preventDefault();
  const editId = document.getElementById('editItemId').value;
  const data = {
    name: document.getElementById('itemName').value.trim(),
    category: document.getElementById('itemCategory').value,
    quantity: parseInt(document.getElementById('itemQuantity').value)||1,
    desc: document.getElementById('itemDesc').value.trim(),
    maxDays: parseInt(document.getElementById('itemMaxDays').value)||7,
    imgData: document.getElementById('itemImageData').value
  };
  if (editId) await fdb.collection("items").doc(editId).update(data);
  else {
    const newId = genId();
    await fdb.collection("items").doc(newId).set({ id: newId, ...data });
  }
  closeModal('modal-item');
}

async function deleteItem(id) {
  if (!confirm('삭제하시겠습니까?')) return;
  await fdb.collection("items").doc(id).delete();
}

function processQR(itemId) { 
  const item = db.items.find(i => i.id === itemId);
  if (!item) return;
  pendingBorrowItemId = itemId;
  document.getElementById('borrowItemName').textContent = item.name;
  openModal('modal-borrow');
}

async function confirmBorrow() {
  if (!pendingBorrowItemId) return;
  const itemId = pendingBorrowItemId;
  const active = db.history.find(h => h.itemId === itemId && !h.returnedAt);
  if (active) await fdb.collection("history").doc(active.firestoreId).update({ returnedAt: now() });
  else {
    await fdb.collection("history").add({
      itemId, studentId: currentUser.id, studentName: currentUser.name, borrowedAt: now(), returnedAt: null
    });
  }
  closeModal('modal-borrow');
  pendingBorrowItemId = null;
}

// ===================== OTHER UTILS =====================
function genId() { return 'ITEM-' + Math.floor(Math.random() * 1000000); }
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

// ===================== INIT =====================
document.addEventListener('DOMContentLoaded', () => {
  initRealtimeSync();
  showPage('page-login');
});
