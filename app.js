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
let hasCheckedOverdue = false;
let scannerInstance = null;

// ===================== AUTH & NAVIGATION =====================
function selectRole(role) {
  selectedRole = role;
  const btnT = document.getElementById('roleTeacher');
  const btnS = document.getElementById('roleStudent');
  if (btnT) btnT.classList.toggle('active', role === 'teacher');
  if (btnS) btnS.classList.toggle('active', role === 'student');
}

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
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
    alert("로그인 오류: " + error.message);
  }
}

async function handleSignUp(e) {
  e.preventDefault();
  const role = document.getElementById('signupRole').value;
  const classCode = document.getElementById('signupClassCode').value.trim();
  const id = document.getElementById('signupId').value.trim();
  const pw = document.getElementById('signupPw').value;
  const name = document.getElementById('signupName').value.trim();

  try {
    const checkDoc = await fdb.collection("users").doc(id).get();
    if (checkDoc.exists) { alert("이미 존재하는 아이디입니다."); return; }

    await fdb.collection("users").doc(id).set({
      role, classCode, pw, name,
      createdAt: new Date().toISOString()
    });

    alert("가입 완료! 선택한 역할로 로그인해 주세요.");
    showPage('page-login');
  } catch (error) {
    alert("가입 실패: " + error.message);
  }
}

async function handleFindAuth(e) {
  e.preventDefault();
  const name = document.getElementById('findName').value.trim();
  const resultBox = document.getElementById('findResult');
  try {
    const snapshot = await fdb.collection("users").where("name", "==", name).get();
    if (snapshot.empty) resultBox.innerHTML = "정보 없음";
    else {
      let html = "";
      snapshot.forEach(doc => {
        const d = doc.data();
        html += `ID: ${doc.id} / PW: ${d.pw} (${d.classCode})<br>`;
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

function showAdmin() {
  document.getElementById('adminUserName').textContent = currentUser.name;
  document.getElementById('adminClassBadge').textContent = currentUser.classCode;
  showPage('page-admin');
  adminTab('dashboard');
}

function showStudent() {
  document.getElementById('studentUserName').textContent = currentUser.name;
  document.getElementById('studentClassBadge').textContent = currentUser.classCode;
  showPage('page-student');
  studentTab('catalog');
}

// ===================== SYNC & DATA =====================
function initRealtimeSync(classCode) {
  activeListeners.forEach(unsub => unsub());
  activeListeners = [];
  hasCheckedOverdue = false;

  const itemsUnsub = fdb.collection("items").where("classCode", "==", classCode)
    .onSnapshot(snap => {
      db.items = snap.docs.map(doc => ({ ...doc.data(), firestoreId: doc.id }));
      if (db.items.length === 0 && currentUser.role === 'teacher') seedInitialData(classCode);
      refreshCurrentUI();
      if (currentUser.role === 'student') checkOverdueAlert();
    });

  const historyUnsub = fdb.collection("history").where("classCode", "==", classCode)
    .onSnapshot(snap => {
      db.history = snap.docs.map(doc => ({ ...doc.data(), firestoreId: doc.id }));
      refreshCurrentUI();
      if (currentUser.role === 'student') checkOverdueAlert();
    });

  activeListeners.push(itemsUnsub, historyUnsub);
}

function checkOverdueAlert() {
  if (hasCheckedOverdue || !db.items.length || !db.history.length) return;
  const overdue = db.history.filter(h => {
    if (h.studentId !== currentUser.id || h.returnedAt) return false;
    const item = db.items.find(i => i.id === h.itemId);
    return item && (Date.now() - new Date(h.borrowedAt)) > item.maxDays * 86400000;
  });
  if (overdue.length > 0) {
    alert("⚠️ 연체된 비품이 있습니다! 즉시 반납해 주세요.");
    hasCheckedOverdue = true;
  }
}

async function seedInitialData(classCode) {
  const items = [
    { id:'ITEM-1', name:'가위', category:'문구', maxDays:3, classCode, imgData:'' },
    { id:'ITEM-2', name:'자', category:'문구', maxDays:3, classCode, imgData:'' },
    { id:'ITEM-3', name:'풀', category:'문구', maxDays:3, classCode, imgData:'' }
  ];
  for (const it of items) await fdb.collection("items").doc(`${classCode}-${it.id}`).set(it);
}

function refreshCurrentUI() {
  const page = document.querySelector('.page.active')?.id;
  if (page === 'page-admin') adminTab(document.querySelector('.tab-content.active')?.id.replace('tab-',''));
  if (page === 'page-student') studentTab(document.querySelector('.student-tab-content.active')?.id.replace('stTab-',''));
}

// ===================== TABS & RENDER =====================
function adminTab(tab) {
  if (!tab) tab = 'dashboard';
  document.querySelectorAll('.tab-content, .sidebar-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  const btn = document.getElementById('sideBtn-' + tab);
  if (btn) btn.classList.add('active');
  
  if (tab === 'dashboard') renderDashboard();
  else if (tab === 'items') renderItems();
  else if (tab === 'history') renderHistory();
  else if (tab === 'students') renderStudents();
}

function studentTab(tab) {
  if (!tab) tab = 'catalog';
  stopScan(); 
  document.querySelectorAll('.student-tab-content, .student-tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('stTab-' + tab).classList.add('active');
  const btn = document.getElementById('stBtn-' + tab);
  if (btn) btn.classList.add('active');
  
  if (tab === 'myborrow') renderMyBorrow();
  else if (tab === 'catalog') renderCatalog();
}

function renderDashboard() {
  const borrowed = db.history.filter(h => !h.returnedAt).length;
  document.getElementById('statTotalItems').textContent = db.items.length;
  document.getElementById('statBorrowed').textContent = borrowed;
  document.getElementById('statAvailable').textContent = db.items.length - borrowed;
  const list = document.getElementById('currentBorrowList');
  const active = db.history.filter(h => !h.returnedAt);
  list.innerHTML = active.length ? active.map(h => {
    const it = db.items.find(i => i.id === h.itemId);
    return `<div class="borrow-item" style="padding:10px; border-bottom:1px solid #eee;"><b>${it?.name}</b> (${h.studentName})</div>`;
  }).join('') : '<div style="padding:20px; color:#999; text-align:center;">대여 중인 비품 없음</div>';
}

function renderItems() {
  const g = document.getElementById('itemsGrid');
  g.innerHTML = db.items.map(it => {
    const st = getItemStatus(it);
    const active = db.history.find(h => h.itemId === it.id && !h.returnedAt);
    return `<div class="item-card">
      <div class="item-emoji">${it.imgData ? `<img src="${it.imgData}" style="width:100%; height:100px; object-fit:cover; border-radius:10px;">` : CATEGORY_EMOJI[it.category]||'📦'}</div>
      <div class="item-card-name">${it.name}</div>
      <div class="item-status-badge status-${st.css}">${st.label}${active ? ' ('+active.studentName+')':''}</div>
      <div class="item-card-actions">
        <button class="btn-icon" onclick="showQR('${it.id}')">🔍 QR</button>
        <button class="btn-icon" onclick="openEditItem('${it.id}')">✏️ 수정</button>
        <button class="btn-danger" onclick="deleteItem('${it.id}')">🗑️ 삭제</button>
      </div>
    </div>`;
  }).join('');
}

function renderCatalog() {
  const g = document.getElementById('catalogGrid');
  g.innerHTML = db.items.map(it => {
    const st = getItemStatus(it);
    return `<div class="item-card" onclick="processQR('${it.id}')" style="cursor:pointer;">
      <div class="item-emoji">${it.imgData ? `<img src="${it.imgData}" style="width:100%; height:100px; object-fit:cover; border-radius:10px;">` : CATEGORY_EMOJI[it.category]||'📦'}</div>
      <div class="item-card-name">${it.name}</div>
      <div class="item-status-badge status-${st.css}">${st.label}</div>
    </div>`;
  }).join('');
}

function renderHistory() {
  document.getElementById('historyBody').innerHTML = [...db.history].sort((a,b)=>new Date(b.borrowedAt)-new Date(a.borrowedAt)).map((h, i) => `<tr>
    <td>${i+1}</td><td>${h.studentName}</td><td>${db.items.find(it=>it.id===h.itemId)?.name||h.itemId}</td>
    <td>${fmt(h.borrowedAt)}</td><td>${h.returnedAt?'반납완료':'대여중'}</td>
  </tr>`).join('');
}

function renderStudents() {
  const list = document.getElementById('studentsList');
  fdb.collection("users").where("classCode", "==", currentUser.classCode).where("role", "==", "student").get().then(snap => {
    list.innerHTML = snap.docs.map(doc => `<div class="card" style="margin-bottom:10px;">🎒 ${doc.data().name} (${doc.id})</div>`).join('');
  });
}

function renderMyBorrow() {
  const active = db.history.filter(h => h.studentId === currentUser.id && !h.returnedAt);
  document.getElementById('myBorrowList').innerHTML = active.map(h => `<div class="card" style="display:flex; justify-content:space-between; align-items:center;">
    <div><b>${db.items.find(i=>i.id===h.itemId)?.name}</b><br><small>대여일: ${fmt(h.borrowedAt)}</small></div>
    <button class="btn-primary" onclick="processQR('${h.itemId}')">반납하기</button>
  </div>`).join('');
}

// ===================== QR & SCANNER =====================
function startScan() {
  const readerId = "qr-reader";
  if (!document.getElementById(readerId)) return;
  stopScan();
  scannerInstance = new Html5Qrcode(readerId);
  scannerInstance.start({ facingMode: "environment" }, { fps:10, qrbox:250 }, (text) => {
    stopScan();
    processQR(text);
  }).catch(err => alert("카메라 오류: " + err));
}

function stopScan() {
  if (scannerInstance && scannerInstance.isScanning) {
    scannerInstance.stop().catch(err => console.error(err));
  }
}

function processQR(itemId) {
  const it = db.items.find(i => i.id === itemId);
  if (!it) return alert("비품 정보를 찾을 수 없습니다.");
  document.getElementById('borrowItemName').textContent = it.name;
  const active = db.history.find(h => h.itemId === itemId && !h.returnedAt);
  document.getElementById('borrowConfirmMsg').textContent = active ? '반납하시겠습니까?' : '대여하시겠습니까?';
  openModal('modal-borrow');
  window.pendingItemId = itemId;
}

async function confirmBorrow() {
  const itemId = window.pendingItemId;
  const active = db.history.find(h => h.itemId === itemId && !h.returnedAt);
  if (active) await fdb.collection("history").doc(active.firestoreId).update({ returnedAt: new Date().toISOString() });
  else await fdb.collection("history").add({
    itemId, studentId: currentUser.id, studentName: currentUser.name, 
    borrowedAt: new Date().toISOString(), returnedAt: null, classCode: currentUser.classCode
  });
  closeModal('modal-borrow');
}

function showQR(itemId) {
  const item = db.items.find(i => i.id === itemId);
  document.getElementById('qrItemName').textContent = item.name;
  document.getElementById('qrItemId').textContent = itemId;
  document.getElementById('qrCodeCanvas').innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?data=${itemId}&size=200x200" />`;
  openModal('modal-qr');
}

// ===================== UTILS =====================
function getItemStatus(it) {
  const active = db.history.find(h => h.itemId === it.id && !h.returnedAt);
  if (!active) return { status:'available', label:'대여 가능', css:'available' };
  return { status:'borrowed', label:'대여 중', css:'borrowed' };
}
function fmt(iso) { return iso ? iso.split('T')[0] : '-'; }
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function previewImage(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = e => {
      document.getElementById('imagePreview').innerHTML = `<img src="${e.target.result}" style="width:100%; max-height:100px; object-fit:contain;">`;
      document.getElementById('itemImageData').value = e.target.result;
    };
    reader.readAsDataURL(input.files[0]);
  }
}
async function saveItem(e) {
  e.preventDefault();
  const editId = document.getElementById('editItemId').value;
  const data = {
    name: document.getElementById('itemName').value.trim(),
    category: document.getElementById('itemCategory').value,
    maxDays: parseInt(document.getElementById('itemMaxDays').value)||7,
    imgData: document.getElementById('itemImageData').value,
    classCode: currentUser.classCode
  };
  if (editId) await fdb.collection("items").doc(editId).update(data);
  else await fdb.collection("items").add({ id: 'ITEM-'+Date.now(), ...data });
  closeModal('modal-item');
}
async function deleteItem(id) { if (confirm('삭제?')) await fdb.collection("items").doc(id).delete(); }
function openAddItemModal() {
  document.getElementById('modalItemTitle').textContent='비품 추가';
  document.getElementById('editItemId').value='';
  document.getElementById('itemName').value='';
  document.getElementById('itemImageData').value='';
  document.getElementById('imagePreview').innerHTML='사진 선택';
  openModal('modal-item');
}
function openEditItem(id) {
  const it = db.items.find(i => i.id === id);
  document.getElementById('modalItemTitle').textContent='비품 수정';
  document.getElementById('editItemId').value=id;
  document.getElementById('itemName').value=it.name;
  document.getElementById('itemCategory').value=it.category;
  document.getElementById('itemMaxDays').value=it.maxDays;
  document.getElementById('itemImageData').value=it.imgData||'';
  document.getElementById('imagePreview').innerHTML=it.imgData?`<img src="${it.imgData}" style="width:100%; max-height:100px; object-fit:contain;">`:'사진 선택';
  openModal('modal-item');
}

document.addEventListener('DOMContentLoaded', () => { showPage('page-login'); });
