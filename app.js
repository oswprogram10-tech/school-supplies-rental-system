// ===================== FIREBASE CONFIG =====================
const firebaseConfig = {
  apiKey: "AIzaSyCLcvn0LL6I1pWnJ54Pi5Z3mHMzkerd_TM",
  authDomain: "school-supplies-rental-system.firebaseapp.com",
  projectId: "school-supplies-rental-system",
  storageBucket: "school-supplies-rental-system.firebasestorage.app",
  messagingSenderId: "212323277172",
  appId: "1:212323277172:web:6828275c6779c54f2cb421"
};

firebase.initializeApp(firebaseConfig);
const fdb = firebase.firestore();

// ===================== DATA =====================
const CATEGORY_EMOJI = { '문구':'✏️','도서':'📖','실험도구':'🔬','체육용품':'⚽','기타':'📦' };

let db = { items: [], history: [] };
let currentUser = null;
let selectedRole = 'teacher';
let activeListeners = []; 
let hasCheckedOverdue = false; // 로그인 후 1회만 경고를 띄우기 위한 플래그

// ===================== REAL-TIME SYNC (학급별 격리) =====================
function initRealtimeSync(classCode) {
  activeListeners.forEach(unsub => unsub());
  activeListeners = [];
  hasCheckedOverdue = false; // 새 로그인 시 초기화

  console.log(`📡 [${classCode}] 학급 데이터 동기화 시작...`);
  
  const itemsUnsub = fdb.collection("items")
    .where("classCode", "==", classCode)
    .onSnapshot((snapshot) => {
      db.items = snapshot.docs.map(doc => ({ ...doc.data(), firestoreId: doc.id }));
      if (db.items.length === 0 && currentUser.role === 'teacher') seedInitialData(classCode);
      refreshCurrentUI();
      if (currentUser && currentUser.role === 'student') checkOverdueAlert();
    });

  const historyUnsub = fdb.collection("history")
    .where("classCode", "==", classCode)
    .onSnapshot((snapshot) => {
      db.history = snapshot.docs.map(doc => ({ ...doc.data(), firestoreId: doc.id }));
      refreshCurrentUI();
      if (currentUser && currentUser.role === 'student') checkOverdueAlert();
    });

  activeListeners.push(itemsUnsub, historyUnsub);
}

// 연체 경고 체크 함수
function checkOverdueAlert() {
  // 데이터가 모두 로드되었고 아직 이번 세션에서 경고를 띄우지 않았을 때만 실행
  if (hasCheckedOverdue || !db.items.length || !db.history.length) return;

  const myOverdueItems = db.history.filter(h => {
    if (h.studentId !== currentUser.id || h.returnedAt) return false;
    const item = db.items.find(i => i.id === h.itemId);
    return item && isOverdue(h.borrowedAt, item.maxDays);
  });

  if (myOverdueItems.length > 0) {
    const itemNames = myOverdueItems.map(h => {
      const item = db.items.find(i => i.id === h.itemId);
      return `[${item ? item.name : h.itemId}]`;
    }).join(", ");
    
    alert(`⚠️ 연체 경고!\n\n현재 반납 기한이 지난 비품이 있습니다:\n${itemNames}\n\n다른 친구들을 위해 즉시 반납해 주세요!`);
    hasCheckedOverdue = true; // 경고를 한 번 띄웠음을 표시
  }
}

function refreshCurrentUI() {
  const activePage = document.querySelector('.page.active').id;
  if (activePage === 'page-admin') {
    const activeTab = document.querySelector('.tab-content.active')?.id.replace('tab-', '');
    if (activeTab) adminTab(activeTab);
  } else if (activePage === 'page-student') {
    const activeTab = document.querySelector('.student-tab-content.active')?.id.replace('stTab-', '');
    if (activeTab) studentTab(activeTab);
  }
}

async function seedInitialData(classCode) {
  console.log("🌱 초기 데이터 생성 중...");
  const initialItems = [
    { id:'ITEM-001', name:'가위', category:'문구', quantity:3, desc:'일반 가위', maxDays:3, classCode },
    { id:'ITEM-002', name:'자 (30cm)', category:'문구', quantity:5, desc:'플라스틱 30cm 자', maxDays:3, classCode },
    { id:'ITEM-003', name:'풀', category:'문구', quantity:4, desc:'딱풀', maxDays:3, classCode },
  ];
  for (const item of initialItems) {
    await fdb.collection("items").doc(`${classCode}-${item.id}`).set(item);
  }
}

// ===================== AUTH LOGIC =====================
function selectRole(role) {
  selectedRole = role;
  const btnT = document.getElementById('roleTeacher');
  const btnS = document.getElementById('roleStudent');
  if (btnT) btnT.classList.toggle('active', role === 'teacher');
  if (btnS) btnS.classList.toggle('active', role === 'student');
}

async function handleLogin(e) {
  e.preventDefault();
  const id = document.getElementById('loginId').value.trim();
  const pw = document.getElementById('loginPw').value;
  const err = document.getElementById('loginError');

  try {
    const userDoc = await fdb.collection("users").doc(id).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      // 비밀번호와 선택한 역할이 모두 일치해야 로그인 성공
      if (userData.pw === pw && userData.role === selectedRole) {
        err.classList.add('hidden');
        currentUser = { id, ...userData };
        
        initRealtimeSync(userData.classCode);
        
        if (userData.role === 'teacher') showAdmin();
        else showStudent();
        return;
      }
    }
    err.classList.remove('hidden');
  } catch (error) {
    console.error("Login Error:", error);
    alert("로그인 중 오류가 발생했습니다.");
  }
}

async function handleSignUp(e) {
  e.preventDefault();
  const role = document.getElementById('signupRole').value;
  const classCode = document.getElementById('signupClassCode').value.trim();
  const id = document.getElementById('signupId').value.trim();
  const pw = document.getElementById('signupPw').value;
  const name = document.getElementById('signupName').value.trim();

  if (!classCode) { alert("학급 코드를 입력해 주세요."); return; }

  try {
    const checkDoc = await fdb.collection("users").doc(id).get();
    if (checkDoc.exists) { alert("이미 존재하는 아이디입니다."); return; }

    await fdb.collection("users").doc(id).set({
      role, classCode, pw, name,
      createdAt: new Date().toISOString()
    });

    alert(`회원가입 완료! [${selectedRole === 'teacher' ? '교사' : '학생'}] 로그인 화면에서 로그인해 주세요.`);
    showPage('page-login');
  } catch (error) {
    alert("회원가입 실패: " + error.message);
  }
}

async function handleFindAuth(e) {
  e.preventDefault();
  const name = document.getElementById('findName').value.trim();
  const resultBox = document.getElementById('findResult');
  try {
    const snapshot = await fdb.collection("users").where("name", "==", name).get();
    if (snapshot.empty) resultBox.innerHTML = "정보를 찾을 수 없습니다.";
    else {
      let html = "<strong>계정 정보:</strong><br>";
      snapshot.forEach(doc => {
        const d = doc.data();
        html += `ID: <b>${doc.id}</b> / PW: <b>${d.pw}</b> (학급: ${d.classCode})<br>`;
      });
      resultBox.innerHTML = html;
    }
    resultBox.classList.remove('hidden');
  } catch (error) { alert("조회 오류"); }
}

function logout() {
  activeListeners.forEach(unsub => unsub());
  currentUser = null;
  showPage('page-login');
}

// ===================== NAVIGATION =====================
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
}

function showAdmin() {
  if (document.getElementById('adminUserName')) document.getElementById('adminUserName').textContent = currentUser.name;
  if (document.getElementById('adminClassBadge')) document.getElementById('adminClassBadge').textContent = currentUser.classCode;
  showPage('page-admin');
  adminTab('dashboard');
}

function showStudent() {
  if (document.getElementById('studentUserName')) document.getElementById('studentUserName').textContent = currentUser.name;
  if (document.getElementById('studentClassBadge')) document.getElementById('studentClassBadge').textContent = currentUser.classCode;
  showPage('page-student');
  studentTab('catalog');
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

// ===================== RENDER =====================
function renderDashboard() {
  const total = db.items.length;
  const borrowed = db.history.filter(h => !h.returnedAt).length;
  document.getElementById('statTotalItems').textContent = total;
  document.getElementById('statBorrowed').textContent = borrowed;
  document.getElementById('statAvailable').textContent = total - borrowed;
  
  const activeLogs = db.history.filter(h => !h.returnedAt);
  const bl = document.getElementById('currentBorrowList');
  if (!activeLogs.length) bl.innerHTML = '<div class="empty-state">대여 중인 비품이 없습니다</div>';
  else {
    bl.innerHTML = activeLogs.map(h => {
      const item = db.items.find(i => i.id === h.itemId);
      return `<div class="borrow-item">
        <div class="borrow-item-avatar">${CATEGORY_EMOJI[item?.category]||'📦'}</div>
        <div class="borrow-item-info">
          <div class="borrow-item-name">${item?.name||h.itemId}</div>
          <div class="borrow-item-sub">${h.studentName}</div>
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
    const imgHtml = item.imgData 
      ? `<div class="item-image"><img src="${item.imgData}"></div>`
      : `<div class="item-emoji">${CATEGORY_EMOJI[item.category]||'📦'}</div>`;

    return `<div class="item-card ${st.status==='available'?'':'unavailable'}">
      ${imgHtml}
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
    const imgHtml = item.imgData 
      ? `<div class="item-image"><img src="${item.imgData}"></div>`
      : `<div class="item-emoji">${CATEGORY_EMOJI[item.category]||'📦'}</div>`;

    return `<div class="item-card ${st.status==='available'?'':'unavailable'}" onclick="processQR('${item.id}')">
      ${imgHtml}
      <div class="item-card-name">${item.name}</div>
      <div class="item-card-cat">${item.category} · 최대 ${item.maxDays}일</div>
      <div class="item-status-badge status-${st.css}">${st.label}${active && active.studentId === currentUser.id ? ' (내가 대여 중)' : ''}</div>
    </div>`;
  }).join('');
}

function renderHistory() {
  const body = document.getElementById('historyBody');
  body.innerHTML = [...db.history].sort((a,b) => new Date(b.borrowedAt)-new Date(a.borrowedAt)).map((h, i) => {
    const item = db.items.find(it => it.id === h.itemId);
    return `<tr>
      <td>${i+1}</td><td>${h.studentName}</td><td>${item?.name||h.itemId}</td>
      <td>${fmt(h.borrowedAt)}</td><td>${h.returnedAt ? '반납완료' : '대여중'}</td>
    </tr>`;
  }).join('');
}

function renderStudents() {
  const list = document.getElementById('studentsList');
  fdb.collection("users").where("classCode", "==", currentUser.classCode).where("role", "==", "student").get().then(snap => {
    list.innerHTML = snap.docs.map(doc => {
      const s = doc.data();
      const count = db.history.filter(h => h.studentId === doc.id && !h.returnedAt).length;
      return `<div class="student-card">
        <div class="student-avatar">🎒</div>
        <div class="student-name">${s.name}</div>
        <div class="student-id">현재 대여: ${count}건</div>
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

// ===================== QR & MODALS =====================
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

function previewImage(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = e => {
      document.getElementById('imagePreview').innerHTML = `<img src="${e.target.result}" />`;
      document.getElementById('itemImageData').value = e.target.result;
    };
    reader.readAsDataURL(input.files[0]);
  }
}

function openAddItemModal() {
  document.getElementById('modalItemTitle').textContent = '비품 추가';
  document.getElementById('editItemId').value = '';
  document.getElementById('itemName').value = '';
  document.getElementById('itemImageData').value = '';
  document.getElementById('imagePreview').innerHTML = '<span>📷 사진 선택</span>';
  openModal('modal-item');
}

function openEditItem(id) {
  const item = db.items.find(i => i.id === id);
  document.getElementById('modalItemTitle').textContent = '비품 수정';
  document.getElementById('editItemId').value = id;
  document.getElementById('itemName').value = item.name;
  document.getElementById('itemCategory').value = item.category;
  document.getElementById('itemMaxDays').value = item.maxDays;
  document.getElementById('itemImageData').value = item.imgData || '';
  document.getElementById('imagePreview').innerHTML = item.imgData ? `<img src="${item.imgData}">` : '<span>📷 사진 선택</span>';
  openModal('modal-item');
}

async function saveItem(e) {
  e.preventDefault();
  const editId = document.getElementById('editItemId').value;
  const data = {
    name: document.getElementById('itemName').value.trim(),
    category: document.getElementById('itemCategory').value,
    maxDays: parseInt(document.getElementById('itemMaxDays').value)||7,
    imgData: document.getElementById('itemImageData').value,
    classCode: currentUser.classCode // 학급 코드 포함 저장
  };
  if (editId) await fdb.collection("items").doc(editId).update(data);
  else await fdb.collection("items").add({ id: 'ITEM-'+Date.now(), ...data });
  closeModal('modal-item');
}

async function deleteItem(id) {
  if (confirm('삭제하시겠습니까?')) await fdb.collection("items").doc(id).delete();
}

function processQR(itemId) {
  const item = db.items.find(i => i.id === itemId);
  if (!item) return;
  document.getElementById('borrowItemName').textContent = item.name;
  const active = db.history.find(h => h.itemId === itemId && !h.returnedAt);
  document.getElementById('borrowConfirmMsg').textContent = active ? '이 비품을 반납하시겠습니까?' : '이 비품을 대여하시겠습니까?';
  openModal('modal-borrow');
  window.pendingItemId = itemId;
}

async function confirmBorrow() {
  const itemId = window.pendingItemId;
  const active = db.history.find(h => h.itemId === itemId && !h.returnedAt);
  if (active) {
    await fdb.collection("history").doc(active.firestoreId).update({ returnedAt: new Date().toISOString() });
  } else {
    await fdb.collection("history").add({
      itemId, studentId: currentUser.id, studentName: currentUser.name, 
      borrowedAt: new Date().toISOString(), returnedAt: null, 
      classCode: currentUser.classCode // 학급 코드 포함 저장
    });
  }
  closeModal('modal-borrow');
}

// ===================== UTILS =====================
function fmt(iso) { return iso ? iso.split('T')[0].replace(/-/g,'.') : '-'; }
function getItemStatus(item) {
  const active = db.history.find(h => h.itemId === item.id && !h.returnedAt);
  if (!active) return { status:'available', label:'대여 가능', css:'available' };
  return { status:'borrowed', label:'대여 중', css:'borrowed' };
}

document.addEventListener('DOMContentLoaded', () => { showPage('page-login'); });
