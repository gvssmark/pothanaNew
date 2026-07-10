//https://script.google.com/macros/s/AKfycbwo-TtPn3DAjHSPCXDwPFerT36QyfPPvUTi7uQEvcmjJso_aWpaKefUsgx_vpJOowHUgg/exec?sheetid=1azp8o_KQvmWNLPeiRK75JBY2Hu8DMY7wJYoWX_1WdWs&sheetname=Sheet1

/* =========================================================================
   పోతన తెలుగు భాగవతము — app.js
   ========================================================================= */

/* -------------------------------------------------------------------------
   CONFIG — EDIT THESE THREE VALUES to point at your published Apps Script
   ------------------------------------------------------------------------- */
const CONFIG = {
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwo-TtPn3DAjHSPCXDwPFerT36QyfPPvUTi7uQEvcmjJso_aWpaKefUsgx_vpJOowHUgg',
  SHEET_ID: '1azp8o_KQvmWNLPeiRK75JBY2Hu8DMY7wJYoWX_1WdWs',
  SHEET_NAME: 'Sheet1',              // the tab name inside the sheet
  SYNC_INTERVAL_DAYS: 7,             // auto re-sync if cached data is older than this
};

/* -------------------------------------------------------------------------
   STATE
   ------------------------------------------------------------------------- */
const state = {
  db: null,
  records: [],       // ordered array, records[i].id === i+1
  totalCount: 0,
  currentId: 1,
  skandaIndex: [],   // [{num, text, firstId, ghattas:[{num, text, firstId}]}]
  showMeaning: true, // global: whether టీక is shown on every card
  showBhavam: true,  // global: whether భావం is shown on every card
};

/* -------------------------------------------------------------------------
   INDEXEDDB LAYER
   ------------------------------------------------------------------------- */
const DB_NAME = 'PothanaBhagavatham';
const DB_VERSION = 1;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('padyams')) {
        const store = db.createObjectStore('padyams', { keyPath: 'id' });
        store.createIndex('skandaNum', 'skandaNum');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGetAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbClear(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function dbPutAll(db, storeName, records) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const r of records) store.put(r);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function dbGetMeta(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('meta', 'readonly');
    const req = tx.objectStore('meta').get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
    req.onerror = () => reject(req.error);
  });
}

function dbSetMeta(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function dbDeleteMeta(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* -------------------------------------------------------------------------
   FETCH + PARSE (Apps Script returns an array of arrays; row 0 is header)
   ------------------------------------------------------------------------- */
async function fetchSheetData() {
  const url = `${CONFIG.APPS_SCRIPT_URL}?sheetid=${encodeURIComponent(CONFIG.SHEET_ID)}&sheetname=${encodeURIComponent(CONFIG.SHEET_NAME)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('నెట్‌వర్క్ లోపం: ' + res.status);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length < 2) throw new Error('డేటా ఆకృతి తప్పు');

  const records = [];
  let idCounter = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    idCounter++;
    records.push({
      id: idCounter,
      skandaNum: Number(r[0]) || null,
      skandaText: (r[1] || '').toString().trim(),
      ghattaNum: Number(r[2]) || null,
      ghattaText: (r[3] || '').toString().trim(),
      padyaNum: Number(r[4]) || null,
      chandassu: (r[5] || '').toString().trim(),
      padyaSankhya: (r[6] || '').toString().trim(),
      padyamText: (r[7] || '').toString().trim(),
      teeka: (r[8] || '').toString().trim(),
      tippani: (r[9] || '').toString().trim(),
    });
  }
  return records;
}

/* -------------------------------------------------------------------------
   SKANDA / GHATTA INDEX (built once in memory from records)
   ------------------------------------------------------------------------- */
function buildSkandaIndex() {
  const skandaMap = new Map();
  for (const rec of state.records) {
    if (!skandaMap.has(rec.skandaNum)) {
      skandaMap.set(rec.skandaNum, {
        num: rec.skandaNum,
        text: rec.skandaText,
        firstId: rec.id,
        ghattaMap: new Map(),
      });
    }
    const sk = skandaMap.get(rec.skandaNum);
    if (!sk.ghattaMap.has(rec.ghattaNum)) {
      sk.ghattaMap.set(rec.ghattaNum, {
        num: rec.ghattaNum,
        text: rec.ghattaText,
        firstId: rec.id,
      });
    }
  }
  state.skandaIndex = Array.from(skandaMap.values())
    .sort((a, b) => a.num - b.num)
    .map((sk) => ({
      ...sk,
      ghattas: Array.from(sk.ghattaMap.values()).sort((a, b) => a.num - b.num),
    }));
}

function findLocation(id) {
  const rec = state.records[id - 1];
  if (!rec) return null;
  return { skandaNum: rec.skandaNum, ghattaNum: rec.ghattaNum };
}

/* -------------------------------------------------------------------------
   DOM REFS
   ------------------------------------------------------------------------- */
const stage = document.getElementById('stage');
const loadingState = document.getElementById('loadingState');
const errorState = document.getElementById('errorState');
const errorMsg = document.getElementById('errorMsg');
const retryBtn = document.getElementById('retryBtn');
const progressLabel = document.getElementById('progressLabel');
const menuBtn = document.getElementById('menuBtn');
const bookmarkBtn = document.getElementById('bookmarkBtn');
const overlay = document.getElementById('overlay');
const drawer = document.getElementById('drawer');
const skandaListEl = document.getElementById('skandaList');
const syncBtn = document.getElementById('syncBtn');
const syncStatus = document.getElementById('syncStatus');
const toggleMeaningBtn = document.getElementById('toggleMeaningBtn');
const toggleBhavamBtn = document.getElementById('toggleBhavamBtn');
const meaningState = document.getElementById('meaningState');
const bhavamState = document.getElementById('bhavamState');
const clearBookmarkBtn = document.getElementById('clearBookmarkBtn');
const confirmBackdrop = document.getElementById('confirmBackdrop');
const cancelClear = document.getElementById('cancelClear');
const confirmClear = document.getElementById('confirmClear');
const aboutBtn = document.getElementById('aboutBtn');
const aboutBackdrop = document.getElementById('aboutBackdrop');
const closeAbout = document.getElementById('closeAbout');
const aboutStats = document.getElementById('aboutStats');
const toastEl = document.getElementById('toast');

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

/* -------------------------------------------------------------------------
   CARD RENDERING
   ------------------------------------------------------------------------- */
function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* Normalizes every line-break variant that can end up in a spreadsheet cell
   (\r\n, lone \r, and Unicode line/paragraph separators from pasted text)
   into a single form, then renders explicit <br> tags. This avoids relying
   on CSS white-space handling, which some mobile browser engines interpret
   differently from desktop for these characters. */
function formatMultiline(str) {
  const normalized = (str || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n');
  return escapeHtml(normalized).split('\n').join('<br>');
}

/* Colors cycled across each line of the padyam (one color per pada/line).
   Tweak this list to change the palette or add more colors before it repeats. */
const PADYAM_LINE_COLORS = ['#a83232', '#2f4f8f'];

function formatPadyamLines(str) {
  const normalized = (str || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n');
  return normalized
    .split('\n')
    .map((line, i) => {
      const safe = escapeHtml(line);
      if (safe.trim() === '') return '';
      const color = PADYAM_LINE_COLORS[i % PADYAM_LINE_COLORS.length];
      return `<span class="padyam-line" style="color:${color}">${safe}</span>`;
    })
    .join('<br>');
}

function buildCardHTML(rec) {
  const chandassuTag = rec.chandassu ? ` <span class="chandassu">(${escapeHtml(rec.chandassu)})</span>` : '';
  const meaningBlock = state.showMeaning ? `
      <div class="field field-meaning">
        <div class="field-label">టీక</div>
        <div class="field-text">${formatMultiline(rec.teeka)}</div>
      </div>` : '';
  const bhavamBlock = state.showBhavam ? `
      <div class="field field-bhavam">
        <div class="field-label">భావం</div>
        <div class="field-text">${formatMultiline(rec.tippani)}</div>
      </div>` : '';
  const prevDisabled = rec.id <= 1 ? 'disabled' : '';
  const nextDisabled = rec.id >= state.totalCount ? 'disabled' : '';

  return `
    <div class="hole-bottom"></div>
    <div class="card-heading">
      <span>${escapeHtml(rec.skandaText)}</span>
      <span class="sep">•</span>
      <span>${escapeHtml(rec.ghattaText)}</span>
      <span class="sep">•</span>
      <span>${escapeHtml(rec.padyaSankhya)}</span>
    </div>
    <div class="card-body">
      <div class="field field-padyam">
        <div class="field-label">పద్యం${chandassuTag}</div>
        <div class="field-text">${formatPadyamLines(rec.padyamText)}</div>
      </div>${meaningBlock}${bhavamBlock}
    </div>
    <div class="card-footer">
      <button class="nav-btn prev-btn" onclick="goPrev()" ${prevDisabled}>◀ వెనుకకు</button>
      <span class="counter">${rec.id} / ${state.totalCount}</span>
      <button class="nav-btn next-btn" onclick="goNext()" ${nextDisabled}>తదుపరి ▶</button>
    </div>
  `;
}

/* Two persistent card elements, double-buffered for the swipe animation */
let elA, elB, activeEl, hiddenEl;

function setupCardElements() {
  elA = document.createElement('div');
  elB = document.createElement('div');
  elA.className = 'card current';
  elB.className = 'card';
  elB.style.transform = 'translateY(100%)';
  elB.style.opacity = '0';
  elB.style.zIndex = '2';
  stage.appendChild(elB);
  stage.appendChild(elA);
  activeEl = elA;
  hiddenEl = elB;
}

function updateProgressLabel(id) {
  const loc = findLocation(id);
  if (!loc) return;
  progressLabel.textContent = `స్కంధం ${loc.skandaNum} · ఘట్టం ${loc.ghattaNum} · ${id}/${state.totalCount}`;
}

function showCardAt(id) {
  state.currentId = id;
  activeEl.innerHTML = buildCardHTML(state.records[id - 1]);
  activeEl.className = 'card current';
  activeEl.style.transition = 'none';
  activeEl.style.transform = 'translateY(0)';
  activeEl.style.opacity = '1';
  activeEl.style.zIndex = '3';
  hiddenEl.style.transition = 'none';
  hiddenEl.style.transform = 'translateY(100%)';
  hiddenEl.style.opacity = '0';
  hiddenEl.style.zIndex = '2';
  updateProgressLabel(id);
  persistBookmark(id);
  highlightCurrentInDrawer();
}

/* -------------------------------------------------------------------------
   SWIPE / DRAG ENGINE
   ------------------------------------------------------------------------- */
let pointerStart = null;
let dragging = false;
let dragDirection = null; // 1 = next (finger moves up), -1 = prev (finger moves down)
let stageHeight = 0;

stage.addEventListener('pointerdown', (e) => {
  if (!state.totalCount) return;
  stageHeight = stage.clientHeight;
  const bodyEl = activeEl.querySelector('.card-body');
  pointerStart = { x: e.clientX, y: e.clientY, scrollTop: bodyEl ? bodyEl.scrollTop : 0 };
  dragging = false;
  dragDirection = null;
});

stage.addEventListener('pointermove', (e) => {
  if (!pointerStart || !state.totalCount) return;
  const dy = e.clientY - pointerStart.y;
  const dx = e.clientX - pointerStart.x;

  if (!dragging) {
    if (Math.abs(dy) < 12 || Math.abs(dx) > Math.abs(dy)) return;
    const bodyEl = activeEl.querySelector('.card-body');
    const atTop = !bodyEl || bodyEl.scrollTop <= 0;
    const atBottom = !bodyEl || Math.ceil(bodyEl.scrollTop + bodyEl.clientHeight) >= bodyEl.scrollHeight;
    if (dy < 0 && !atBottom) { pointerStart = null; return; } // let card-body scroll down
    if (dy > 0 && !atTop) { pointerStart = null; return; }    // let card-body scroll up
    const wantDirection = dy < 0 ? 1 : -1;
    const targetId = state.currentId + wantDirection;
    if (targetId < 1 || targetId > state.totalCount) return;  // no card that way — ignore
    dragging = true;
    dragDirection = wantDirection;
    prepareHiddenCard(dragDirection);
  }

  if (dragging) {
    e.preventDefault();
    followDrag(dy);
  }
});

stage.addEventListener('pointerup', (e) => {
  if (dragging) endDrag(e.clientY - pointerStart.y);
  pointerStart = null;
  dragging = false;
});
stage.addEventListener('pointercancel', () => {
  if (dragging) endDrag(0);
  pointerStart = null;
  dragging = false;
});

function prepareHiddenCard(direction) {
  const targetId = state.currentId + direction;
  hiddenEl.innerHTML = buildCardHTML(state.records[targetId - 1]);
  hiddenEl.style.transition = 'none';
  hiddenEl.style.transform = `translateY(${direction > 0 ? stageHeight : -stageHeight}px)`;
  hiddenEl.style.opacity = '1';
  hiddenEl.style.zIndex = '2';
}

function followDrag(dy) {
  activeEl.style.transition = 'none';
  activeEl.style.transform = `translateY(${dy}px)`;
  hiddenEl.style.transition = 'none';
  const base = dragDirection > 0 ? stageHeight : -stageHeight;
  hiddenEl.style.transform = `translateY(${base + dy}px)`;
}

function endDrag(dy) {
  const threshold = Math.min(stageHeight * 0.22, 110);
  const commit = Math.abs(dy) > threshold;
  if (commit) {
    commitDrag(dragDirection);
  } else {
    revertDrag();
  }
}

function commitDrag(direction) {
  const targetId = state.currentId + direction;
  const TRANS = 'transform 0.28s cubic-bezier(.22,.8,.36,1), opacity 0.28s ease';
  activeEl.style.transition = TRANS;
  hiddenEl.style.transition = TRANS;
  activeEl.style.transform = `translateY(${direction > 0 ? -stageHeight : stageHeight}px)`;
  hiddenEl.style.transform = 'translateY(0)';

  const onEnd = () => {
    activeEl.removeEventListener('transitionend', onEnd);
    // swap roles
    const oldActive = activeEl, oldHidden = hiddenEl;
    activeEl = oldHidden;
    hiddenEl = oldActive;
    activeEl.className = 'card current';
    activeEl.style.zIndex = '3';
    hiddenEl.style.transition = 'none';
    hiddenEl.style.transform = `translateY(${stageHeight}px)`;
    hiddenEl.style.opacity = '0';
    hiddenEl.style.zIndex = '2';
    state.currentId = targetId;
    updateProgressLabel(targetId);
    persistBookmark(targetId);
    highlightCurrentInDrawer();
  };
  activeEl.addEventListener('transitionend', onEnd, { once: true });
}

function revertDrag() {
  const TRANS = 'transform 0.24s ease, opacity 0.24s ease';
  activeEl.style.transition = TRANS;
  hiddenEl.style.transition = TRANS;
  activeEl.style.transform = 'translateY(0)';
  const base = dragDirection > 0 ? stageHeight : -stageHeight;
  hiddenEl.style.transform = `translateY(${base}px)`;
  hiddenEl.style.opacity = '0';
}

/* Jump navigation (menu selection) — always a quick forward-style transition */
function jumpTo(targetId) {
  if (targetId < 1 || targetId > state.totalCount || targetId === state.currentId) {
    closeDrawer();
    return;
  }
  stageHeight = stage.clientHeight;
  const direction = targetId > state.currentId ? 1 : -1;
  prepareHiddenCardForJump(targetId, direction);
  commitJump(direction, targetId);
  closeDrawer();
}

function prepareHiddenCardForJump(targetId, direction) {
  hiddenEl.innerHTML = buildCardHTML(state.records[targetId - 1]);
  hiddenEl.style.transition = 'none';
  hiddenEl.style.transform = `translateY(${direction > 0 ? stageHeight : -stageHeight}px)`;
  hiddenEl.style.opacity = '1';
  hiddenEl.style.zIndex = '2';
  // force reflow so the transition below actually animates
  void hiddenEl.offsetHeight;
}

function commitJump(direction, targetId) {
  const TRANS = 'transform 0.32s cubic-bezier(.22,.8,.36,1), opacity 0.32s ease';
  activeEl.style.transition = TRANS;
  hiddenEl.style.transition = TRANS;
  activeEl.style.transform = `translateY(${direction > 0 ? -stageHeight : stageHeight}px)`;
  hiddenEl.style.transform = 'translateY(0)';

  const onEnd = () => {
    activeEl.removeEventListener('transitionend', onEnd);
    const oldActive = activeEl, oldHidden = hiddenEl;
    activeEl = oldHidden;
    hiddenEl = oldActive;
    activeEl.className = 'card current';
    activeEl.style.zIndex = '3';
    hiddenEl.style.transition = 'none';
    hiddenEl.style.transform = `translateY(${stageHeight}px)`;
    hiddenEl.style.opacity = '0';
    hiddenEl.style.zIndex = '2';
    state.currentId = targetId;
    updateProgressLabel(targetId);
    persistBookmark(targetId);
    highlightCurrentInDrawer();
  };
  activeEl.addEventListener('transitionend', onEnd, { once: true });
}

/* Keyboard support (desktop testing / accessibility) */
window.addEventListener('keydown', (e) => {
  if (!state.totalCount || drawer.classList.contains('open')) return;
  if (e.key === 'ArrowUp' || e.key === 'PageDown') {
    e.preventDefault();
    if (state.currentId < state.totalCount) jumpTo(state.currentId + 1);
  } else if (e.key === 'ArrowDown' || e.key === 'PageUp') {
    e.preventDefault();
    if (state.currentId > 1) jumpTo(state.currentId - 1);
  }
});

/* -------------------------------------------------------------------------
   GLOBAL NAV + EXPAND TOGGLE (exposed on window for inline onclick handlers,
   since card markup is rebuilt via innerHTML on every navigation)
   ------------------------------------------------------------------------- */
window.goNext = function () {
  if (state.currentId < state.totalCount) jumpTo(state.currentId + 1);
};
window.goPrev = function () {
  if (state.currentId > 1) jumpTo(state.currentId - 1);
};
window.toggleMeaning = function () {
  state.showMeaning = !state.showMeaning;
  if (state.db) dbSetMeta(state.db, 'showMeaning', state.showMeaning).catch(() => {});
  activeEl.innerHTML = buildCardHTML(state.records[state.currentId - 1]);
  updateToggleButtonsUI();
};
window.toggleBhavam = function () {
  state.showBhavam = !state.showBhavam;
  if (state.db) dbSetMeta(state.db, 'showBhavam', state.showBhavam).catch(() => {});
  activeEl.innerHTML = buildCardHTML(state.records[state.currentId - 1]);
  updateToggleButtonsUI();
};
function updateToggleButtonsUI() {
  meaningState.textContent = state.showMeaning ? 'చూపిస్తోంది' : 'దాచింది';
  meaningState.classList.toggle('on', state.showMeaning);
  bhavamState.textContent = state.showBhavam ? 'చూపిస్తోంది' : 'దాచింది';
  bhavamState.classList.toggle('on', state.showBhavam);
}

/* -------------------------------------------------------------------------
   BOOKMARK
   ------------------------------------------------------------------------- */
let bookmarkSaveTimer = null;
function persistBookmark(id) {
  clearTimeout(bookmarkSaveTimer);
  bookmarkSaveTimer = setTimeout(() => {
    if (state.db) dbSetMeta(state.db, 'bookmarkId', id).catch(() => {});
  }, 350);
}

bookmarkBtn.addEventListener('click', async () => {
  if (!state.db) return;
  await dbSetMeta(state.db, 'bookmarkId', state.currentId);
  toast('ఈ పద్యం వద్ద గుర్తు పెట్టబడింది 🔖');
});

clearBookmarkBtn.addEventListener('click', () => {
  confirmBackdrop.classList.add('show');
});
cancelClear.addEventListener('click', () => confirmBackdrop.classList.remove('show'));
confirmClear.addEventListener('click', async () => {
  confirmBackdrop.classList.remove('show');
  if (state.db) await dbDeleteMeta(state.db, 'bookmarkId');
  closeDrawer();
  jumpTo(1);
  toast('గుర్తు తొలగించబడింది');
});

/* -------------------------------------------------------------------------
   HAMBURGER DRAWER
   ------------------------------------------------------------------------- */
function renderDrawer() {
  skandaListEl.innerHTML = '';
  state.skandaIndex.forEach((sk) => {
    const item = document.createElement('div');
    item.className = 'skanda-item';
    item.dataset.skanda = sk.num;

    const btn = document.createElement('button');
    btn.className = 'skanda-btn';
    btn.innerHTML = `<span><span class="num">${sk.num}</span>${escapeHtml(sk.text)}</span>
      <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`;
    btn.addEventListener('click', () => item.classList.toggle('expanded'));
    item.appendChild(btn);

    const ghattaList = document.createElement('div');
    ghattaList.className = 'ghatta-list';
    sk.ghattas.forEach((gh) => {
      const gbtn = document.createElement('button');
      gbtn.className = 'ghatta-btn';
      gbtn.dataset.ghatta = gh.num;
      gbtn.textContent = `${gh.num}. ${gh.text}`;
      gbtn.addEventListener('click', () => jumpTo(gh.firstId));
      ghattaList.appendChild(gbtn);
    });
    item.appendChild(ghattaList);
    skandaListEl.appendChild(item);
  });
}

function highlightCurrentInDrawer() {
  const loc = findLocation(state.currentId);
  if (!loc) return;
  skandaListEl.querySelectorAll('.ghatta-btn.current-ghatta').forEach((b) => b.classList.remove('current-ghatta'));
  const ghattaBtn = skandaListEl.querySelector(`.skanda-item[data-skanda="${loc.skandaNum}"] .ghatta-btn[data-ghatta="${loc.ghattaNum}"]`);
  if (ghattaBtn) ghattaBtn.classList.add('current-ghatta');
}

function openDrawer() {
  // auto-expand & scroll to current skanda for orientation
  const loc = findLocation(state.currentId);
  skandaListEl.querySelectorAll('.skanda-item').forEach((el) => el.classList.remove('expanded'));
  if (loc) {
    const item = skandaListEl.querySelector(`.skanda-item[data-skanda="${loc.skandaNum}"]`);
    if (item) {
      item.classList.add('expanded');
      setTimeout(() => item.scrollIntoView({ block: 'start' }), 50);
    }
  }
  overlay.classList.add('open');
  drawer.classList.add('open');
}
function closeDrawer() {
  overlay.classList.remove('open');
  drawer.classList.remove('open');
}
menuBtn.addEventListener('click', openDrawer);
overlay.addEventListener('click', closeDrawer);
toggleMeaningBtn.addEventListener('click', () => window.toggleMeaning());
toggleBhavamBtn.addEventListener('click', () => window.toggleBhavam());

/* -------------------------------------------------------------------------
   ABOUT MODAL
   ------------------------------------------------------------------------- */
aboutBtn.addEventListener('click', () => {
  aboutStats.textContent = `మొత్తం స్కంధాలు: ${state.skandaIndex.length} · మొత్తం పద్యాలు: ${state.totalCount}`;
  aboutBackdrop.classList.add('show');
  closeDrawer();
});
closeAbout.addEventListener('click', () => aboutBackdrop.classList.remove('show'));
aboutBackdrop.addEventListener('click', (e) => {
  if (e.target === aboutBackdrop) aboutBackdrop.classList.remove('show');
});

/* -------------------------------------------------------------------------
   SYNC
   ------------------------------------------------------------------------- */
async function doFetchAndStore() {
  const fresh = await fetchSheetData();
  await dbClear(state.db, 'padyams');
  await dbPutAll(state.db, 'padyams', fresh);
  await dbSetMeta(state.db, 'lastSynced', Date.now());
  return fresh;
}

async function maybeBackgroundSync() {
  const lastSynced = await dbGetMeta(state.db, 'lastSynced');
  const intervalMs = CONFIG.SYNC_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
  if (!lastSynced || Date.now() - lastSynced > intervalMs) {
    try {
      const fresh = await doFetchAndStore();
      state.records = fresh;
      state.totalCount = fresh.length;
      buildSkandaIndex();
      renderDrawer();
      if (state.currentId > state.totalCount) state.currentId = state.totalCount;
      updateProgressLabel(state.currentId);
      toast('భాగవతము డేటా నవీకరించబడింది');
    } catch (err) {
      /* silent — offline or unreachable, keep using cached data */
    }
  }
}

syncBtn.addEventListener('click', async () => {
  syncStatus.textContent = 'సమకాలీకరిస్తోంది…';
  try {
    const fresh = await doFetchAndStore();
    state.records = fresh;
    state.totalCount = fresh.length;
    buildSkandaIndex();
    renderDrawer();
    if (state.currentId > state.totalCount) jumpTo(state.totalCount); else highlightCurrentInDrawer();
    updateProgressLabel(state.currentId);
    syncStatus.textContent = '';
    toast('నవీకరించబడింది ✓');
  } catch (err) {
    syncStatus.textContent = '';
    toast('సమకాలీకరణ విఫలమైంది — ఇంటర్నెట్ తనిఖీ చేయండి');
  }
});

/* -------------------------------------------------------------------------
   LOADING / ERROR STATES
   ------------------------------------------------------------------------- */
function showLoading() { loadingState.style.display = 'flex'; errorState.style.display = 'none'; }
function hideLoading() { loadingState.style.display = 'none'; }
function showError(err) {
  loadingState.style.display = 'none';
  errorState.style.display = 'flex';
  errorMsg.textContent = 'డేటా తీసుకురాలేకపోయాము: ' + (err && err.message ? err.message : 'తెలియని లోపం');
}
retryBtn.addEventListener('click', () => init());

/* -------------------------------------------------------------------------
   SERVICE WORKER
   ------------------------------------------------------------------------- */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

/* -------------------------------------------------------------------------
   INIT
   ------------------------------------------------------------------------- */
async function init() {
  registerServiceWorker();
  showLoading();
  try {
    state.db = await openDatabase();
    let records = await dbGetAll(state.db, 'padyams');

    if (!records || records.length === 0) {
      records = await doFetchAndStore();
    }
    records.sort((a, b) => a.id - b.id);
    state.records = records;
    state.totalCount = records.length;
    buildSkandaIndex();
    renderDrawer();

    const savedShowMeaning = await dbGetMeta(state.db, 'showMeaning');
    if (typeof savedShowMeaning === 'boolean') state.showMeaning = savedShowMeaning;
    const savedShowBhavam = await dbGetMeta(state.db, 'showBhavam');
    if (typeof savedShowBhavam === 'boolean') state.showBhavam = savedShowBhavam;
    updateToggleButtonsUI();

    setupCardElements();
    const bookmark = await dbGetMeta(state.db, 'bookmarkId');
    const startId = bookmark && bookmark >= 1 && bookmark <= state.totalCount ? bookmark : 1;
    showCardAt(startId);

    hideLoading();
    maybeBackgroundSync();
  } catch (err) {
    showError(err);
  }
}

init();
