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
const CATEGORY_EMOJI = { '문구':'✏️','도서':'📖','실험도구':'🔬','체육용품':'⚽','전자기기':'💻','기타':'📦' };
const GRADES = [
  { name:'Gold', icon:'🥇', min:300, color:'#f59e0b', maxBorrow: 10 },
  { name:'Silver', icon:'🥈', min:100, color:'#94a3b8', maxBorrow: 5 },
  { name:'Bronze', icon:'🥉', min:0, color:'#b45309', maxBorrow: 3 },
  { name:'Warning', icon:'⚠️', min:-49, color:'#ef4444', maxBorrow: 1 },
  { name:'Banned', icon:'🚫', min:-Infinity, color:'#7f1d1d', maxBorrow: 0 }
];

let db = { users: [], items: [], history: [], pointHistory: [], reports: [], waitlists: [] };
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
        if (userData.role === 'student' && userData.status === 'pending') {
          err.textContent = "가입 승인 대기 중입니다. 선생님께 문의하세요.";
          err.classList.remove('hidden');
          return;
        }
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
      status: role === 'teacher' ? 'approved' : 'pending',
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

async function toggleSignupClassInput() {
  const role = document.getElementById('signupRole').value;
  const wrapper = document.getElementById('signupClassCodeWrapper');
  
  if (role === 'teacher') {
    wrapper.innerHTML = `<input type="text" id="signupClassCode" placeholder="예: 3-2 (새로운 코드 생성)" required />`;
  } else {
    wrapper.innerHTML = `<select id="signupClassCode" required><option value="">학급 정보를 불러오는 중...</option></select>`;
    try {
      const snap = await fdb.collection("users").where("role", "==", "teacher").get();
      const codes = [...new Set(snap.docs.map(doc => doc.data().classCode))].sort();
      
      let html = codes.length > 0 ? '<option value="">학급을 선택하세요</option>' : '<option value="">등록된 학급이 없습니다</option>';
      html += codes.map(c => `<option value="${c}">${c}</option>`).join('');
      document.getElementById('signupClassCode').innerHTML = html;
    } catch (e) {
      document.getElementById('signupClassCode').innerHTML = '<option value="">로딩 실패</option>';
    }
  }
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

  const reportsUnsub = fdb.collection("reports").onSnapshot(snap => {
    db.reports = snap.docs.map(doc => ({ ...doc.data(), firestoreId: doc.id }));
    if (currentUser && currentUser.role === 'admin') renderDashboard();
  });

  const waitlistsUnsub = fdb.collection("waitlists").where("classCode", "==", classCode).onSnapshot(snap => {
    db.waitlists = snap.docs.map(doc => ({ ...doc.data(), firestoreId: doc.id }));
    if (currentUser && currentUser.role === 'student') updateStudentAlerts();
  });

  const usersUnsub = fdb.collection("users").where("classCode", "==", classCode)
    .onSnapshot(snap => {
      db.users = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      refreshCurrentUI();
    });

  activeListeners.push(itemsUnsub, historyUnsub, pointUnsub, reportsUnsub, waitlistsUnsub, usersUnsub);
}

function checkOverdueAlert() {
  if (hasCheckedOverdue || !db.items.length || !db.history.length) return;
  updateStudentAlerts();
  hasCheckedOverdue = true;
}

function updateStudentAlerts() {
  const banner = document.getElementById('studentAlertBanner');
  if(!banner || !currentUser || currentUser.role !== 'student') return;
  
  const myActive = db.history.filter(h => h.studentId === currentUser.id && !h.returnedAt);
  let overdueCount = 0;
  let dueTomorrowCount = 0;
  
  myActive.forEach(h => {
    const it = db.items.find(i => i.id === h.itemId);
    const maxDays = it ? (it.maxDays || 7) : 7;
    
    // 날짜 차이 계산 (시간 제외)
    const startDate = new Date(h.borrowedAt.split('T')[0]);
    const todayDate = new Date(new Date().toISOString().split('T')[0]);
    const elapsedDays = Math.floor((todayDate - startDate) / 86400000);
    
    if(elapsedDays > maxDays) overdueCount++;
    else if(elapsedDays > maxDays - 1) dueTomorrowCount++;
  });
  
  let availableWaitlist = [];
  if (db.waitlists) {
    const myWaitlists = db.waitlists.filter(w => w.studentId === currentUser.id);
    myWaitlists.forEach(w => {
      const it = db.items.find(i => i.id === w.itemId);
      if (it && getItemStatus(it).available > 0) {
        availableWaitlist.push(it.name);
      }
    });
  }

  if (availableWaitlist.length > 0) {
    banner.className = 'alert-banner';
    banner.style.borderColor = 'var(--green)';
    banner.style.background = 'rgba(16, 185, 129, 0.1)';
    banner.innerHTML = `<span>🎉</span> <div style="color:var(--green);"><b>대기 완료!</b> 기다리시던 [${availableWaitlist.join(', ')}] 비품이 반납되었습니다. 지금 바로 대여하세요!</div>`;
  } else if (overdueCount > 0) {
    banner.className = 'alert-banner'; // red
    banner.style.borderColor = ''; banner.style.background = '';
    banner.innerHTML = `<span>🚨</span> <div><b>연체 주의!</b> 반납 기한이 지난 비품이 ${overdueCount}개 있습니다. 신속히 반납해주세요!</div>`;
  } else if (dueTomorrowCount > 0) {
    banner.className = 'alert-banner warning'; // yellow
    banner.style.borderColor = ''; banner.style.background = '';
    banner.innerHTML = `<span>⚠️</span> <div><b>반납 임박!</b> 내일이 반납 기한인 비품이 ${dueTomorrowCount}개 있습니다.</div>`;
  } else {
    banner.className = 'alert-banner hidden';
  }
}

let currentReportItemId = '';
function openReportModal(itemId) {
  currentReportItemId = itemId;
  const it = db.items.find(i => i.id === itemId);
  document.getElementById('reportItemName').textContent = it ? it.name : '비품';
  document.getElementById('reportContent').value = '';
  openModal('modal-report');
}

async function submitReport(e) {
  e.preventDefault();
  const content = document.getElementById('reportContent').value.trim();
  if(!content) return;
  
  const it = db.items.find(i => i.id === currentReportItemId);
  await fdb.collection("reports").add({
    itemId: currentReportItemId,
    itemName: it ? it.name : 'Unknown',
    studentId: currentUser.id,
    studentName: currentUser.name,
    content: content,
    timestamp: new Date().toISOString()
  });
  
  alert("신고가 접수되었습니다.");
  closeModal('modal-report');
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
  else if (tab === 'approvals') renderApprovals();
  else if (tab === 'stats') { /* CSV 내보내기 탭은 렌더링 함수 필요 없음 */ }
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
  const activeHistory = db.history.filter(h => !h.returnedAt);
  const totalItems = db.items.length;
  const borrowedCount = activeHistory.reduce((sum, h) => sum + (h.quantity || 1), 0);
  const totalQuantity = db.items.reduce((sum, it) => sum + (it.totalQuantity || 1), 0);
  
  document.getElementById('statTotalItems').textContent = totalItems;
  document.getElementById('statBorrowed').textContent = borrowedCount;
  document.getElementById('statAvailable').textContent = totalQuantity - borrowedCount;
  
  // 1. 비품 인기 순위 차트 (TOP 5)
  const counts = {};
  db.history.forEach(h => counts[h.itemId] = (counts[h.itemId] || 0) + (h.quantity || 1));
  const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]).slice(0, 5);
  const max = sorted.length ? sorted[0][1] : 1;
  
  const chartHtml = sorted.map(([id, count]) => {
    const it = db.items.find(i => i.id === id);
    const name = it ? it.name : id;
    const width = (count / max) * 100;
    return `
      <div style="margin-bottom:10px;">
        <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
          <span>${name}</span><span>${count}회</span>
        </div>
        <div style="height:8px; background:var(--bg2); border-radius:4px; overflow:hidden;">
          <div style="height:100%; width:${width}%; background:var(--accent); transition:width 0.5s;"></div>
        </div>
      </div>`;
  }).join('') || '<div style="color:var(--text3); font-size:12px;">데이터가 없습니다.</div>';
  document.getElementById('dashboardStatsChart').innerHTML = chartHtml;

  // 2. 비품 재고 상태 리스트
  const inventoryHtml = db.items.map(it => {
    const st = getItemStatus(it);
    const color = st.available === 0 ? 'var(--red)' : (st.available < 3 ? 'var(--yellow)' : 'var(--green)');
    return `
      <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--bg2); font-size:13px;">
        <span>${it.name}</span>
        <span style="color:${color}; font-weight:600;">${st.available} / ${st.total}</span>
      </div>`;
  }).join('');
  document.getElementById('dashboardInventoryList').innerHTML = inventoryHtml || '등록된 비품 없음';

  // 3. 학생 포인트 랭킹 (TOP 5) - 승인된 학생만
  const allUsers = db.users || [];
  const rankedStudents = [...allUsers].filter(u => u.role === 'student' && (u.status === 'approved' || !u.status))
                                    .sort((a,b) => (b.points || 0) - (a.points || 0))
                                    .slice(0, 5);
  const rankingHtml = rankedStudents.map((u, i) => `
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
      <div style="width:24px; height:24px; background:var(--accent2); color:white; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700;">${i+1}</div>
      <div style="flex:1; font-size:13px;">${u.name} <span style="color:var(--text3); font-size:11px;">(${u.grade})</span></div>
      <div style="font-weight:600; font-size:13px; color:var(--accent2);">${u.points || 0}P</div>
    </div>
  `).join('');
  document.getElementById('dashboardStudentRanking').innerHTML = rankingHtml || '학생 데이터 없음';

  // 4. 실시간 대여 현황
  const list = document.getElementById('currentBorrowList');
  list.innerHTML = activeHistory.length ? activeHistory.map(h => {
    const it = db.items.find(i => i.id === h.itemId);
    const qtyText = h.quantity > 1 ? ` x${h.quantity}` : '';
    return `<div style="font-size:13px; padding:6px 0; border-bottom:1px solid var(--bg2);">
      <b>${h.studentName}</b>: ${it?.name || '정보없음'}${qtyText}
    </div>`;
  }).join('') : '<div style="color:var(--text3); font-size:12px;">대여 중인 비품 없음</div>';

  // 5. 최근 신고 내역
  const reportsHtml = db.reports.sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp)).slice(0,3).map(r => `
    <div style="background:var(--card2); padding:8px; border-radius:8px; margin-bottom:8px; border-left:4px solid var(--red);">
      <div style="font-weight:600; font-size:12px;">[${r.itemName}] ${r.studentName}</div>
      <div style="font-size:12px; color:var(--text); margin-top:2px;">${r.content}</div>
    </div>
  `).join('');
  document.getElementById('adminReportList').innerHTML = reportsHtml || '<div style="color:var(--text3); font-size:12px;">신고 내역 없음</div>';
}

function renderItems() {
  const g = document.getElementById('itemsGrid');
  const searchStr = document.getElementById('adminSearchInput')?.value.toLowerCase() || '';
  const categoryFilter = document.getElementById('adminCategoryFilter')?.value || 'all';

  const filteredItems = db.items.filter(it => {
    const matchSearch = it.name.toLowerCase().includes(searchStr);
    const matchCat = categoryFilter === 'all' || it.category === categoryFilter;
    return matchSearch && matchCat;
  });

  g.innerHTML = filteredItems.map(it => {
    const st = getItemStatus(it);
    const statusLabel = it.status && it.status !== '정상' ? `<span style="color:var(--red); font-size:12px;">[${it.status}]</span>` : '';
    return `<div class="item-card ${it.status && it.status !== '정상' ? 'unavailable' : ''}">
      <div class="item-emoji">${it.imgData ? `<img src="${it.imgData}" style="width:100%; height:100%; object-fit:cover; border-radius:8px;">` : CATEGORY_EMOJI[it.category]||'📦'}</div>
      <div class="item-card-name">${it.name} ${statusLabel}</div>
      <div class="item-status-badge status-${st.css}">${st.available} / ${st.total} 남음</div>
      <div class="item-card-actions">
        <button class="btn-icon" onclick="showQR('${it.id}')">🔍 QR</button>
        <button class="btn-icon" onclick="openEditItem('${it.firestoreId}')">✏️ 수정</button>
        <button class="btn-danger" onclick="deleteItem('${it.firestoreId}')">🗑️ 삭제</button>
      </div>
    </div>`;
  }).join('');
}

function renderCatalog() {
  const g = document.getElementById('catalogGrid');
  const searchStr = document.getElementById('studentSearchInput')?.value.toLowerCase() || '';
  const categoryFilter = document.getElementById('studentCategoryFilter')?.value || 'all';

  const filteredItems = db.items.filter(it => {
    if (it.status && it.status !== '정상') return false; // 점검 모드 항목 숨김
    const matchSearch = it.name.toLowerCase().includes(searchStr);
    const matchCat = categoryFilter === 'all' || it.category === categoryFilter;
    return matchSearch && matchCat;
  });

  g.innerHTML = filteredItems.map(it => {
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
  if (!list || !db.users) return;

  // 승인된 학생 또는 상태 필드가 없는 학생(초기 가입자) 필터링
  const students = db.users.filter(u => u.role === 'student' && (u.status === 'approved' || !u.status))
                           .sort((a,b) => (b.points||0) - (a.points||0));
  
  const top3 = students.slice(0, 3).filter(s => (s.points || 0) > 0);
  const topHtml = top3.length > 0 ? `<div style="background:linear-gradient(135deg, #fffbeb, #fef3c7); border:1px solid #fde68a; border-radius:12px; padding:16px; margin-bottom:20px; color:#92400e;">
    <h3 style="margin-bottom:10px; font-size:16px;">🏆 이달의 우수 학생</h3>
    <div style="display:flex; gap:12px; font-size:14px; flex-wrap:wrap;">
      ${top3.map((s, i) => `<div style="background:#fff; padding:4px 10px; border-radius:20px;"><b>${i+1}위</b> ${s.name}(${s.points||0}점)</div>`).join('')}
    </div>
  </div>` : '';

  list.innerHTML = topHtml + students.map((s, i) => {
    const g = getGrade(s.points||0);
    return `<div class="student-card-v2">
      <div class="sc-rank">${i+1}</div>
      <div class="sc-info">
        <div class="sc-name">${g.icon} ${s.name}</div>
        <div class="sc-meta">${s.id} · ${g.name} · <b>${s.points||0}점</b></div>
      </div>
      <button class="btn-icon" onclick="openPointModal('${s.id}','${s.name}',${s.points||0})">±점수</button>
    </div>`;
  }).join('') || '<div class="empty-state">승인된 학생이 없습니다. [승인 관리] 탭을 확인해 보세요.</div>';
}



function renderMyBorrow() {
  const active = db.history.filter(h => h.studentId === currentUser.id && !h.returnedAt);
  document.getElementById('myBorrowList').innerHTML = active.map(h => {
    const itemName = db.items.find(i=>i.id===h.itemId)?.name || h.itemId;
    const qtyText = h.quantity > 1 ? ` (x${h.quantity})` : '';
    return `<div class="my-borrow-card" style="display:flex; justify-content:space-between; align-items:center;">
    <div>
      <b>${itemName}${qtyText}</b><br>
      <span style="font-size:12px; color:var(--text2);">대여일: ${fmt(h.borrowedAt)}</span>
    </div>
    <div style="display:flex; gap:8px;">
      <button class="btn-report" onclick="openReportModal('${h.itemId}')">🚨 신고</button>
      <button class="btn-secondary" onclick="processQR('${h.itemId}')">반납</button>
    </div>
  </div>`}).join('');
  updateStudentAlerts();
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
  
  const btnConfirm = document.getElementById('btnBorrowConfirm');
  const qtyWrapper = document.getElementById('borrowQtyWrapper');
  
  if (myActive) {
    document.getElementById('borrowConfirmMsg').textContent = '이 비품을 반납하시겠습니까?';
    if(qtyWrapper) qtyWrapper.style.display = 'none';
    if(btnConfirm) {
      btnConfirm.textContent = '확인';
      btnConfirm.setAttribute('onclick', 'confirmBorrow()');
    }
  } else {
    if (st.available <= 0) {
      document.getElementById('borrowConfirmMsg').textContent = `현재 모두 대여 중입니다. 반납 시 알림을 받으시겠습니까?`;
      if(qtyWrapper) qtyWrapper.style.display = 'none';
      if(btnConfirm) {
        btnConfirm.textContent = '대기 신청';
        btnConfirm.setAttribute('onclick', 'confirmWaitlist()');
      }
    } else {
      document.getElementById('borrowConfirmMsg').textContent = `이 비품을 대여하시겠습니까? (현재 ${st.available}개 남음)`;
      if(qtyWrapper) {
        qtyWrapper.style.display = 'block';
        const qtyInput = document.getElementById('borrowQuantity');
        qtyInput.max = st.available;
        qtyInput.value = 1;
        document.getElementById('maxQtyLabel').textContent = `(최대 ${st.available}개)`;
      }
      if(btnConfirm) {
        btnConfirm.textContent = '확인';
        btnConfirm.setAttribute('onclick', 'confirmBorrow()');
      }
    }
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

    // 반납 처리
    await fdb.collection("history").doc(myActive.firestoreId).update({ returnedAt: now });
    
    // 날짜 차이 계산 (시간 제외)
    const startDate = new Date(myActive.borrowedAt.split('T')[0]);
    const todayDate = new Date(now.split('T')[0]);
    const daysBorrowed = Math.floor((todayDate - startDate) / 86400000);
    
    const it = db.items.find(i => i.id === itemId);
    const maxDays = it?.maxDays || 7;
    let pts = 10; let reason = '기한 내 반납';
    if (daysBorrowed > maxDays) { pts = -(daysBorrowed - maxDays) * 5; reason = `${daysBorrowed - maxDays}일 연체 반납`; }
    else if (daysBorrowed <= maxDays - 2) { pts += 3; reason = '조기 반납 보너스'; }
    await addPoints(currentUser.id, pts, reason);
  } else {
    const it = db.items.find(i => i.id === itemId);
    const st = getItemStatus(it);
    const borrowQty = parseInt(document.getElementById('borrowQuantity').value) || 1;

    if (st.available >= borrowQty) {
      await fdb.collection("history").add({
        itemId, studentId: currentUser.id, studentName: currentUser.name,
        borrowedAt: now, returnedAt: null, classCode: currentUser.classCode,
        quantity: borrowQty
      });
      // 대기 명단에서 제거
      const wList = db.waitlists?.find(w => w.itemId === itemId && w.studentId === currentUser.id);
      if (wList) await fdb.collection("waitlists").doc(wList.firestoreId).delete();
    } else { alert("그새 수량이 부족해졌습니다!"); }
  }
  closeModal('modal-borrow');
}

async function confirmWaitlist() {
  const itemId = window.pendingItemId;
  const it = db.items.find(i => i.id === itemId);
  
  const existing = db.waitlists?.find(w => w.itemId === itemId && w.studentId === currentUser.id);
  if (existing) {
    alert("이미 대기 명단에 등록되어 있습니다.");
  } else {
    await fdb.collection("waitlists").add({
      itemId, itemName: it ? it.name : 'Unknown',
      studentId: currentUser.id, studentName: currentUser.name,
      classCode: currentUser.classCode,
      timestamp: new Date().toISOString()
    });
    alert(`[${it.name}] 대기 신청이 완료되었습니다. 반납되면 로그인 시 알림을 보내드립니다!`);
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
  document.getElementById('itemStatus').value = '정상';
  document.getElementById('itemTotalQuantity').value = 1;
  document.getElementById('itemImageData').value = '';
  document.getElementById('imagePreview').innerHTML = '사진 미리보기';
  openModal('modal-item');
}

function openEditItem(firestoreId) {
  const it = db.items.find(i => i.firestoreId === firestoreId);
  document.getElementById('modalItemTitle').textContent = '비품 수정';
  document.getElementById('editItemId').value = firestoreId;
  document.getElementById('itemName').value = it.name;
  document.getElementById('itemCategory').value = it.category;
  document.getElementById('itemStatus').value = it.status || '정상';
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
    status: document.getElementById('itemStatus').value,
    maxDays: parseInt(document.getElementById('itemMaxDays').value)||7,
    totalQuantity: parseInt(document.getElementById('itemTotalQuantity').value)||1,
    imgData: document.getElementById('itemImageData').value,
    classCode: currentUser.classCode
  };
  if (editId) await fdb.collection("items").doc(editId).update(data);
  else await fdb.collection("items").add({ id: 'ITEM-'+Date.now(), ...data });
  closeModal('modal-item');
}

async function deleteItem(firestoreId) {
  if (confirm('삭제하시겠습니까?')) await fdb.collection("items").doc(firestoreId).delete();
}

function getItemStatus(it) {
  const activeCount = db.history.filter(h => h.itemId === it.id && !h.returnedAt)
                                .reduce((sum, h) => sum + (h.quantity || 1), 0);
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

function toggleTheme() {
  document.body.classList.toggle('light-mode');
  const isLight = document.body.classList.contains('light-mode');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  const icon = isLight ? '🌞' : '🌙';
  ['loginThemeBtn', 'adminThemeBtn', 'studentThemeBtn'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.textContent = icon;
  });
}

function exportHistoryCSV() {
  if (!db.history.length) {
    alert("내보낼 데이터가 없습니다."); return;
  }
  const headers = ["번호", "학생명", "아이디", "비품명", "대여일", "반납일", "상태"];
  const rows = [...db.history].sort((a,b)=>new Date(b.borrowedAt)-new Date(a.borrowedAt)).map((h, i) => {
    const itemName = db.items.find(it=>it.id===h.itemId)?.name || h.itemId;
    const status = h.returnedAt ? '반납완료' : '대여중';
    return [i+1, h.studentName, h.studentId, itemName, fmt(h.borrowedAt), fmt(h.returnedAt), status];
  });
  
  let csvContent = "\uFEFF" + headers.join(",") + "\n"; // \uFEFF ensures UTF-8 BOM for Excel
  rows.forEach(row => {
    csvContent += row.join(",") + "\n";
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `대여이력_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

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

  // 뱃지 계산 로직
  const myHistories = db.history.filter(h => h.studentId === currentUser.id);
  const myPointHistories = db.pointHistory.filter(p => p.userId === currentUser.id);
  
  let badges = [];
  if (myPointHistories.filter(p => p.reason === '조기 반납 보너스').length >= 3) badges.push('🦅 얼리버드');
  if (myHistories.length >= 5 && !myPointHistories.some(p => p.type === 'minus')) badges.push('✨ 깔끔쟁이');
  if (myHistories.filter(h => db.items.find(i => i.id === h.itemId)?.category === '도서').length >= 3) badges.push('📚 독서왕');

  const badgesHtml = badges.length > 0 ? `<div style="margin-top:10px; font-size:12px; color:var(--text2);">획득 뱃지: <b style="color:var(--accent2);">${badges.join(' ')}</b></div>` : '';

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
    ${badgesHtml}
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

function renderApprovals() {
  const list = document.getElementById('pendingApprovalsList');
  if (!list) return;
  fdb.collection("users").where("classCode", "==", currentUser.classCode).where("role", "==", "student").where("status", "==", "pending").get().then(snap => {
    const pendings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    list.innerHTML = pendings.map(s => `
      <div class="student-card-v2" style="border-left: 4px solid var(--accent2);">
        <div class="sc-info">
          <div class="sc-name">🐣 ${s.name}</div>
          <div class="sc-meta">${s.id} · 가입 요청함</div>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn-primary" onclick="approveUser('${s.id}')">승인</button>
          <button class="btn-danger" onclick="rejectUser('${s.id}')">거절</button>
        </div>
      </div>
    `).join('') || '<div class="empty-state">승인 대기 중인 학생이 없습니다.</div>';
  });
}

async function approveUser(id) {
  if (confirm('이 학생의 가입을 승인하시겠습니까?')) {
    await fdb.collection("users").doc(id).update({ status: 'approved' });
    alert('승인되었습니다.');
    renderApprovals();
  }
}

async function rejectUser(id) {
  if (confirm('가입 요청을 거절하고 삭제하시겠습니까?')) {
    await fdb.collection("users").doc(id).delete();
    alert('거절되었습니다.');
    renderApprovals();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // 저장된 테마 불러오기
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
    ['loginThemeBtn', 'adminThemeBtn', 'studentThemeBtn'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.textContent = '🌞';
    });
  }

  // 스플래시 화면을 2.5초간 보여준 후 로그인 화면으로 이동
  setTimeout(() => {
    showPage('page-login');
  }, 2500);
});
