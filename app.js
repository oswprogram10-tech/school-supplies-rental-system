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

// ===================== DATA & STATE =====================
const CATEGORY_EMOJI = { '문구':'✏️','도서':'📖','실험도구':'🔬','체육용품':'⚽','기타':'📦' };
const GRADES = [
  { name:'Gold', icon:'🥇', min:300, color:'#f59e0b', maxBorrow: 10 },
  { name:'Silver', icon:'🥈', min:100, color:'#94a3b8', maxBorrow: 5 },
  { name:'Bronze', icon:'🥉', min:0, color:'#b45309', maxBorrow: 3 },
  { name:'Warning', icon:'⚠️', min:-49, color:'#ef4444', maxBorrow: 1 },
  { name:'Banned', icon:'🚫', min:-Infinity, color:'#7f1d1d', maxBorrow: 0 }
];

let db = { items: [], history: [], pointHistory: [] };
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
      points: 0, grade: 'Bronze',
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
      let html = "<strong>조회 결과:</strong><br>";
      snapshot.forEach(doc => {
        const d = doc.data();
        html += `아이디: ${doc.id} / 비번: ${d.pw} (학급: ${d.classCode})<br>`;
      });
      resultBox.innerHTML = html;
    }
    resultBox.classList.remove('hidden');
  } catch (error) { alert("조회 오류"); }
}

function logout() {
  activeListeners.forEach(unsub => unsub());
  stopScan();
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
  renderStudentProfile();
  studentTab('catalog');
}

// ===================== SYNC & REALTIME =====================
function initRealtimeSync(classCode) {
  activeListeners.forEach(unsub => unsub());
  activeListeners = [];
  hasCheckedOverdue = false;

  const itemsUnsub = fdb.collection("items").where("classCode", "==", classCode)
    .onSnapshot(snap => {
      db.items = snap.docs.map(doc => ({ ...doc.data(), firestoreId: doc.id }));
      if (db.items.length === 0 && currentUser.role === 'teacher') seedInitialData(classCode);
      refreshCurrentUI();
      if (currentUser && currentUser.role === 'student') checkOverdueAlert();
    });

  const historyUnsub = fdb.collection("history").where("classCode", "==", classCode)
    .onSnapshot(snap => {
      db.history = snap.docs.map(doc => ({ ...doc.data(), firestoreId: doc.id }));
      refreshCurrentUI();
      if (currentUser && currentUser.role === 'student') checkOverdueAlert();
    });

  const pointUnsub = fdb.collection("pointHistory").where("classCode", "==", classCode)
    .onSnapshot(snap => {
      db.pointHistory = snap.docs.map(doc => ({ ...doc.data(), firestoreId: doc.id }));
      if (currentUser && currentUser.role === 'student') renderStudentProfile();
    });

  activeListeners.push(itemsUnsub, historyUnsub, pointUnsub);
}

function checkOverdueAlert() {
  if (hasCheckedOverdue || !db.items.length || !db.history.length) return;
  const overdue = db.history.filter(h => {
    if (h.studentId !== currentUser.id || h.returnedAt) return false;
    const item = db.items.find(i => i.id === h.itemId);
    return item && (Date.now() - new Date(h.borrowedAt)) > item.maxDays * 86400000;
  });
  if (overdue.length > 0) {
    alert("⚠️ 연체된 비품이 있습니다! 목록에서 확인 후 반납해 주세요.");
    hasCheckedOverdue = true;
  }
}

function refreshCurrentUI() {
  const page = document.querySelector('.page.active')?.id;
  if (page === 'page-admin') adminTab(document.querySelector('.tab-content.active')?.id.replace('tab-',''));
  if (page === 'page-student') studentTab(document.querySelector('.student-tab-content.active')?.id.replace('stTab-',''));
}

async function seedInitialData(classCode) {
  const items = [
    { id:'ITEM-1', name:'가위', category:'문구', maxDays:3, totalQuantity: 5, classCode, imgData:'' },
    { id:'ITEM-2', name:'자', category:'문구', maxDays:3, totalQuantity: 10, classCode, imgData:'' },
    { id:'ITEM-3', name:'풀', category:'문구', maxDays:3, totalQuantity: 8, classCode, imgData:'' }
  ];
  for (const it of items) await fdb.collection("items").doc(`${classCode}-${it.id}`).set(it);
}

// ===================== TABS & RENDERING =====================
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
  else if (tab === 'stats') renderStats();
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
  else if (tab === 'scan') startScan();
  else if (tab === 'mypoints') renderMyPointHistory();
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
    return `<div class="borrow-item">${it?.name || '정보없음'} (${h.studentName})</div>`;
  }).join('') : '대여 중인 비품 없음';
}

function renderItems() {
  const g = document.getElementById('itemsGrid');
  g.innerHTML = db.items.map(it => {
    const st = getItemStatus(it);
    return `<div class="item-card">
      <div class="item-emoji">${it.imgData ? `<img src="${it.imgData}" style="width:100%; height:100%; object-fit:cover; border-radius:8px;">` : CATEGORY_EMOJI[it.category]||'📦'}</div>
      <div class="item-card-name">${it.name}</div>
      <div class="item-status-badge status-${st.css}">${st.available} / ${st.total} 남음</div>
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
    return `<div class="item-card" onclick="processQR('${it.id}')">
      <div class="item-emoji">${it.imgData ? `<img src="${it.imgData}" style="width:100%; height:100%; object-fit:cover; border-radius:8px;">` : CATEGORY_EMOJI[it.category]||'📦'}</div>
      <div class="item-card-name">${it.name}</div>
      <div class="item-status-badge status-${st.css}">${st.available} / ${st.total} 대여 가능</div>
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
    const students = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (b.points||0) - (a.points||0));
    list.innerHTML = students.map((s, i) => {
      const g = getGrade(s.points||0);
      return `<div class="student-card-v2">
        <div class="sc-rank">${i+1}</div>
        <div class="sc-info">
          <div class="sc-name">${g.icon} ${s.name}</div>
          <div class="sc-meta">${s.id} · ${g.name} · <b>${s.points||0}점</b></div>
        </div>
        <button class="btn-icon" onclick="openPointModal('${s.id}','${s.name}',${s.points||0})">±점수</button>
      </div>`;
    }).join('') || '<div class="empty-state">등록된 학생이 없습니다.</div>';
  });
}

function renderStats() {
  const list = document.getElementById('itemStatsList');
  if (!list) return;

  // 1. 대여 횟수 집계
  const counts = {};
  db.history.forEach(h => {
    counts[h.itemId] = (counts[h.itemId] || 0) + 1;
  });

  // 2. 데이터 가공 및 정렬
  const stats = Object.entries(counts).map(([id, count]) => {
    const item = db.items.find(i => i.id === id);
    return { id, count, name: item ? item.name : id, emoji: item ? (CATEGORY_EMOJI[item.category] || '📦') : '📦' };
  }).sort((a, b) => b.count - a.count);

  if (stats.length === 0) {
    list.innerHTML = '<div class="empty-state">통계 데이터가 없습니다.</div>';
    return;
  }

  const maxCount = stats[0].count;

  // 3. HTML 생성
  list.innerHTML = stats.map((s, index) => {
    const percentage = (s.count / maxCount) * 100;
    return `
      <div class="stat-bar-item">
        <div class="stat-bar-info">
          <span class="stat-bar-rank">${index + 1}</span>
          <span class="stat-bar-name">${s.emoji} ${s.name}</span>
          <span class="stat-bar-count"><b>${s.count}</b>회 대여</span>
        </div>
        <div class="stat-bar-bg">
          <div class="stat-bar-fill" style="width: ${percentage}%;"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderMyBorrow() {
  const active = db.history.filter(h => h.studentId === currentUser.id && !h.returnedAt);
  document.getElementById('myBorrowList').innerHTML = active.map(h => `<div class="my-borrow-card">
    <b>${db.items.find(i=>i.id===h.itemId)?.name || h.itemId}</b> (대여일: ${fmt(h.borrowedAt)})
    <button class="btn-secondary" onclick="processQR('${h.itemId}')">반납하기</button>
  </div>`).join('');
}

// ===================== QR & SCAN =====================
function startScan() {
  const readerId = "qr-reader";
  if (!document.getElementById(readerId)) return;
  stopScan();
  scannerInstance = new Html5Qrcode(readerId);
  scannerInstance.start({ facingMode: "environment" }, { fps: 15, qrbox: 250 }, (decodedText) => {
    stopScan();
    processQR(decodedText);
  }, () => {}).catch(err => {
    console.error(err);
    alert("카메라를 열 수 없습니다. 권한을 확인하세요.");
  });
}

function stopScan() {
  if (scannerInstance && scannerInstance.isScanning) {
    scannerInstance.stop().catch(err => console.error(err));
  }
}

function manualScan() {
  const id = document.getElementById('manualQrInput').value.trim();
  if (id) processQR(id);
}

function processQR(itemId) {
  const it = db.items.find(i => i.id === itemId);
  if (!it) { alert("올바르지 않은 비품 QR입니다."); return; }
  
  const st = getItemStatus(it);
  const myActive = db.history.find(h => h.itemId === itemId && h.studentId === currentUser.id && !h.returnedAt);

  document.getElementById('borrowItemName').textContent = it.name;
  
  if (myActive) {
    document.getElementById('borrowConfirmMsg').textContent = '이 비품을 반납하시겠습니까?';
  } else {
    if (st.available <= 0) {
      alert("현재 남은 수량이 없습니다.");
      return;
    }
    document.getElementById('borrowConfirmMsg').textContent = `이 비품을 대여하시겠습니까? (현재 ${st.available}개 남음)`;
  }

  openModal('modal-borrow');
  window.pendingItemId = itemId;
}

async function confirmBorrow() {
  const itemId = window.pendingItemId;
  const myActive = db.history.find(h => h.itemId === itemId && h.studentId === currentUser.id && !h.returnedAt);
  const now = new Date().toISOString();

  if (myActive) {
    // 최소 대여 시간 체크 (1시간 = 3600000ms)
    const minBorrowTime = 3600000;
    const timeElapsed = Date.now() - new Date(myActive.borrowedAt).getTime();
    
    if (timeElapsed < minBorrowTime) {
      const remainingMin = Math.ceil((minBorrowTime - timeElapsed) / 60000);
      alert(`최소 대여 시간은 1시간입니다. ${remainingMin}분 후에 다시 시도해 주세요.`);
      closeModal('modal-borrow');
      return;
    }

    // 반납 처리 + 자동 점수 계산
    await fdb.collection("history").doc(myActive.firestoreId).update({ returnedAt: now });
    const it = db.items.find(i => i.id === itemId);
    const daysBorrowed = Math.floor((Date.now() - new Date(myActive.borrowedAt)) / 86400000);
    const maxDays = it?.maxDays || 7;
    let pts = 10; let reason = '기한 내 반납';
    if (daysBorrowed > maxDays) { pts = -(daysBorrowed - maxDays) * 5; reason = `${daysBorrowed - maxDays}일 연체 반납`; }
    else if (daysBorrowed <= maxDays - 2) { pts += 3; reason = '조기 반납 보너스'; }
    await addPoints(currentUser.id, pts, reason);
  } else {
    const it = db.items.find(i => i.id === itemId);
    const st = getItemStatus(it);
    if (st.available > 0) {
      await fdb.collection("history").add({
        itemId, studentId: currentUser.id, studentName: currentUser.name,
        borrowedAt: now, returnedAt: null, classCode: currentUser.classCode
      });
    } else { alert("그새 품절되었습니다!"); }
  }
  closeModal('modal-borrow');
}

// ===================== MODALS & UTILS =====================
function showQR(itemId) {
  const item = db.items.find(i => i.id === itemId);
  document.getElementById('qrItemName').textContent = item.name;
  document.getElementById('qrCodeCanvas').innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?data=${itemId}&size=200x200" style="border-radius:8px;" />`;
  openModal('modal-qr');
}

function printQR() {
  const content = document.getElementById('qrCodeCanvas').innerHTML;
  const win = window.open('', '', 'width=400,height=400');
  win.document.write('<html><body style="text-align:center;">' + content + '<h2>' + document.getElementById('qrItemName').textContent + '</h2></body></html>');
  win.document.close();
  win.print();
}

function previewImage(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = e => {
      document.getElementById('imagePreview').innerHTML = `<img src="${e.target.result}" style="width:100%; border-radius:8px;">`;
      document.getElementById('itemImageData').value = e.target.result;
    };
    reader.readAsDataURL(input.files[0]);
  }
}

function openAddItemModal() {
  document.getElementById('modalItemTitle').textContent = '비품 추가';
  document.getElementById('editItemId').value = '';
  document.getElementById('itemName').value = '';
  document.getElementById('itemTotalQuantity').value = 1;
  document.getElementById('itemImageData').value = '';
  document.getElementById('imagePreview').innerHTML = '사진 미리보기';
  openModal('modal-item');
}

function openEditItem(id) {
  const it = db.items.find(i => i.id === id);
  document.getElementById('modalItemTitle').textContent = '비품 수정';
  document.getElementById('editItemId').value = id;
  document.getElementById('itemName').value = it.name;
  document.getElementById('itemCategory').value = it.category;
  document.getElementById('itemMaxDays').value = it.maxDays;
  document.getElementById('itemTotalQuantity').value = it.totalQuantity || 1;
  document.getElementById('itemImageData').value = it.imgData || '';
  document.getElementById('imagePreview').innerHTML = it.imgData ? `<img src="${it.imgData}" style="width:100%">` : '<span>📷 사진 선택</span>';
  openModal('modal-item');
}

async function saveItem(e) {
  e.preventDefault();
  const editId = document.getElementById('editItemId').value;
  const data = {
    name: document.getElementById('itemName').value.trim(),
    category: document.getElementById('itemCategory').value,
    maxDays: parseInt(document.getElementById('itemMaxDays').value)||7,
    totalQuantity: parseInt(document.getElementById('itemTotalQuantity').value)||1,
    imgData: document.getElementById('itemImageData').value,
    classCode: currentUser.classCode
  };
  if (editId) await fdb.collection("items").doc(editId).update(data);
  else await fdb.collection("items").add({ id: 'ITEM-'+Date.now(), ...data });
  closeModal('modal-item');
}

async function deleteItem(id) {
  if (confirm('삭제하시겠습니까?')) await fdb.collection("items").doc(id).delete();
}

function getItemStatus(it) {
  const activeCount = db.history.filter(h => h.itemId === it.id && !h.returnedAt).length;
  const total = it.totalQuantity || 1;
  const available = total - activeCount;
  return { 
    available, 
    total, 
    css: available > 0 ? 'available' : 'borrowed',
    label: available > 0 ? '대여 가능' : '수량 없음'
  };
}

function fmt(iso) { return iso ? iso.split('T')[0] : '-'; }
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function closeModalOutside(e, id) { if (e.target.id === id) closeModal(id); }
function toggleSidebar() { document.querySelector('.admin-layout')?.classList.toggle('sidebar-collapsed'); }

// ===================== POINT SYSTEM =====================
function getGrade(pts) {
  return GRADES.find(g => pts >= g.min) || GRADES[GRADES.length-1];
}

function getNextGrade(pts) {
  for (let i = GRADES.length - 1; i >= 0; i--) {
    if (pts < GRADES[i].min) return GRADES[i];
  }
  return null;
}

async function addPoints(userId, change, reason) {
  const userRef = fdb.collection("users").doc(userId);
  const doc = await userRef.get();
  const data = doc.data();
  const newPts = (data.points || 0) + change;
  const newGrade = getGrade(newPts).name;
  await userRef.update({ points: newPts, grade: newGrade });
  await fdb.collection("pointHistory").add({
    userId, change, reason, type: change >= 0 ? 'plus' : 'minus',
    classCode: data.classCode, timestamp: new Date().toISOString()
  });
  if (userId === currentUser?.id) {
    currentUser.points = newPts;
    currentUser.grade = newGrade;
    renderStudentProfile();
  }
}

function renderStudentProfile() {
  const el = document.getElementById('studentProfileCard');
  if (!el || !currentUser) return;
  const pts = currentUser.points || 0;
  const g = getGrade(pts);
  const next = getNextGrade(pts);
  
  // 남은 대여 횟수 계산
  const activeCount = db.history.filter(h => h.studentId === currentUser.id && !h.returnedAt).length;
  const remainingBorrow = Math.max(0, g.maxBorrow - activeCount);

  const pctText = next ? `다음 등급(${next.icon})까지 ${next.min - pts}점` : '최고 등급 달성!';
  const pct = next ? Math.min(100, Math.max(0, ((pts - (g.min < 0 ? g.min : 0)) / (next.min - (g.min < 0 ? g.min : 0))) * 100)) : 100;
  const myHist = db.pointHistory.filter(p => p.userId === currentUser.id).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 5);
  
  el.innerHTML = `
    <div class="profile-top">
      <div class="profile-grade-icon">${g.icon}</div>
      <div class="profile-info">
        <div class="profile-name">${currentUser.name}</div>
        <div class="profile-grade-name" style="color:${g.color}">${g.name} 등급</div>
      </div>
      <div class="profile-limit">
        <div class="limit-label">남은 대여 횟수</div>
        <div class="limit-value"><span>${remainingBorrow}</span> / ${g.maxBorrow}</div>
      </div>
      <div class="profile-points"><span>${pts}</span>점</div>
    </div>
    <div class="profile-progress-wrap">
      <div class="profile-progress-bar"><div class="profile-progress-fill" style="width:${pct}%; background:${g.color}"></div></div>
      <div class="profile-progress-label">${pctText}</div>
    </div>
    <div class="profile-history">
      ${myHist.length ? myHist.map(h => `<div class="ph-row ${h.type}"><span>${h.reason}</span><span class="ph-pts">${h.change > 0 ? '+' : ''}${h.change}점</span></div>`).join('') : '<div class="ph-empty">아직 기록이 없습니다.</div>'}
    </div>`;
}

function renderMyPointHistory() {
  const el = document.getElementById('myPointsList');
  if (!el) return;
  const myHist = db.pointHistory.filter(p => p.userId === currentUser.id).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
  el.innerHTML = myHist.length ? myHist.map(h => `<div class="ph-row-full ${h.type}">
    <div><b>${h.reason}</b><br><small>${fmt(h.timestamp)}</small></div>
    <span class="ph-pts">${h.change > 0 ? '+' : ''}${h.change}점</span>
  </div>`).join('') : '<div class="empty-state">포인트 기록이 없습니다.</div>';
}

function openPointModal(userId, name, pts) {
  document.getElementById('pointStudentName').textContent = name;
  document.getElementById('pointCurrentPts').textContent = pts + '점';
  document.getElementById('pointChange').value = '';
  document.getElementById('pointReason').value = '';
  window.pendingPointUserId = userId;
  openModal('modal-point');
}

async function submitPointAdjust(e) {
  e.preventDefault();
  const change = parseInt(document.getElementById('pointChange').value);
  const reason = document.getElementById('pointReason').value.trim() || '관리자 조정';
  if (isNaN(change) || change === 0) { alert('점수를 입력하세요.'); return; }
  await addPoints(window.pendingPointUserId, change, reason);
  closeModal('modal-point');
  renderStudents();
}

document.addEventListener('DOMContentLoaded', () => {
  // 스플래시 화면을 2.5초간 보여준 후 로그인 화면으로 이동
  setTimeout(() => {
    showPage('page-login');
  }, 2500);
});
