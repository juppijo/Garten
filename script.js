/* =============================================================
   GARTEN PLANER – JavaScript
   ============================================================= */
'use strict';

// ── Werkzeuge ─────────────────────────────────────────────────
const TOOLS = {
  rasen:        { name: 'Rasen',          emoji: '🟩', bg: '#66bb6a' },
  terrasse:     { name: 'Terrasse',       emoji: '🟫', bg: '#8d6e63' },
  teich:        { name: 'Gartenteich',    emoji: '💧', bg: '#1e88e5' },
  rosenbeet:    { name: 'Rosenbeet',      emoji: '🌸', bg: '#e91e8c' },
  blumenbeet:   { name: 'Blumenbeet',     emoji: '🌻', bg: '#fbc02d' },
  kraeuterbeet: { name: 'Kräuterbeet',    emoji: '🌿', bg: '#26a69a' },
  strauch:      { name: 'Strauch',        emoji: '🌳', bg: '#2e7d32' },
  baum:         { name: 'Baum',           emoji: '🌲', bg: '#1b5e20' },
  weg:          { name: 'Weg / Pfad',     emoji: '🪨', bg: '#d7ccc8' },
  zaun:         { name: 'Zaun',           emoji: '🚧', bg: '#a1887f' },
  gewaechshaus: { name: 'Gewächshaus',    emoji: '🏡', bg: '#b3e5fc' },
  label:        { name: 'Beschriftung',   emoji: '✏️',  bg: '#fff9c4' },
  eraser:       { name: 'Radiergummi',    emoji: '⬜', bg: '#ffffff' },
  zami:         { name: 'Zami',           emoji: '👩‍🦰', bg: '#ffffaa' },
};

// ── Zustand ───────────────────────────────────────────────────
let customTools  = [];
let currentTool  = 'rasen';
let isDrawing    = false;
let gridCols     = 40;
let gridRows     = 30;
let cellSize     = 18;
let gridState    = [];
let labels       = {};     // "r,c" → text
let showRuler    = true;
let history      = [];
let historyIndex = -1;
const LS_KEY     = 'gartenplaner_v1';
const RULER_W    = 26;

// ── DOM ───────────────────────────────────────────────────────
const gardenGrid   = document.getElementById('gardenGrid');
const labelOverlay = document.getElementById('labelOverlay');
const cursorInfo   = document.getElementById('cursorInfo');
const cellInfo     = document.getElementById('cellInfo');
const statsDiv     = document.getElementById('stats');
const legendDiv    = document.getElementById('legend');
const toolGridEl   = document.getElementById('toolGrid');
const storageInfo  = document.getElementById('storageInfo');

// ── Init ──────────────────────────────────────────────────────
function init() {
  buildToolButtons();
  buildLegend();
  if (!loadFromLocalStorage()) initGrid();
  bindControls();
}

// ── Werkzeug-Buttons ──────────────────────────────────────────
function buildToolButtons() {
  toolGridEl.innerHTML = '';
  for (const [key, t] of Object.entries(TOOLS)) {
    if (!key.startsWith('custom_')) toolGridEl.appendChild(createToolButton(key, t, false));
  }
  for (const ct of customTools) {
    toolGridEl.appendChild(createToolButton(ct.key, TOOLS[ct.key], true));
  }
}

function createToolButton(key, t, isDeletable) {
  const btn = document.createElement('button');
  btn.className = 'tool-btn' + (key === currentTool ? ' active' : '');
  btn.dataset.tool = key;
  btn.title = t.name;
  const del = isDeletable
    ? `<button class="tool-btn-delete" data-delete="${key}" title="Löschen">✕</button>` : '';
  btn.innerHTML = `<span class="t-emoji">${t.emoji}</span><span class="t-name">${t.name}</span>${del}`;
  if (key.startsWith('custom_')) {
    btn.style.background  = t.bg;
    btn.style.borderColor = t.bg;
    btn.style.color       = contrastColor(t.bg);
  }
  btn.addEventListener('click', e => { if (!e.target.closest('[data-delete]')) selectTool(key); });
  return btn;
}

toolGridEl.addEventListener('click', e => {
  const d = e.target.closest('[data-delete]');
  if (!d) return;
  e.stopPropagation();
  const key = d.dataset.delete;
  if (confirm(`„${TOOLS[key]?.name}" wirklich löschen?`)) deleteCustomTool(key);
});

function selectTool(key) {
  currentTool = key;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === key));
  const t = TOOLS[key];
  cursorInfo.textContent = `Werkzeug: ${t.emoji} ${t.name}`;
  gardenGrid.style.cursor = key === 'label' ? 'text' : 'crosshair';
}

// ── Eigene Elemente ───────────────────────────────────────────
function addCustomTool(name, color) {
  const key = 'custom_' + Date.now();
  customTools.push({ key, name, color });
  TOOLS[key] = { name, emoji: '🎨', bg: color };
  buildToolButtons(); buildLegend(); selectTool(key); saveToLocalStorage();
}

function deleteCustomTool(key) {
  customTools = customTools.filter(ct => ct.key !== key);
  delete TOOLS[key];
  for (let r = 0; r < gridRows; r++)
    for (let c = 0; c < gridCols; c++)
      if (gridState[r][c] === key) gridState[r][c] = null;
  if (currentTool === key) selectTool('rasen');
  buildToolButtons(); buildLegend(); renderGrid(); pushHistory();
}

// ── Legende ───────────────────────────────────────────────────
function buildLegend() {
  legendDiv.innerHTML = '';
  for (const [key, t] of Object.entries(TOOLS)) {
    if (key === 'eraser' || key === 'label') continue;
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `<div class="legend-swatch" style="background:${t.bg};border:1px solid rgba(0,0,0,.15);width:18px;height:18px;border-radius:3px;flex-shrink:0"></div><span>${t.emoji} ${t.name}</span>`;
    legendDiv.appendChild(item);
  }
}

// ── Grid initialisieren ───────────────────────────────────────
function initGrid() {
  gridState = Array.from({ length: gridRows }, () => Array(gridCols).fill(null));
  labels = {};
  history = []; historyIndex = -1;
  pushHistory(); renderGrid();
}

// ── Grid rendern ──────────────────────────────────────────────
function renderGrid() {
  gardenGrid.style.gridTemplateColumns = `repeat(${gridCols}, ${cellSize}px)`;
  gardenGrid.style.width  = `${gridCols * cellSize}px`;
  gardenGrid.style.height = `${gridRows * cellSize}px`;

  gardenGrid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      cell.style.width  = `${cellSize}px`;
      cell.style.height = `${cellSize}px`;
      cell.dataset.r = r; cell.dataset.c = c;
      applyCellStyle(cell, gridState[r][c]);
      frag.appendChild(cell);
    }
  }
  gardenGrid.appendChild(frag);
  renderRuler();
  renderLabels();
  updateStats();
}

function applyCellStyle(cell, key) {
  cell.className = 'grid-cell';
  cell.style.backgroundColor = '';
  if (key && TOOLS[key]) {
    if (key.startsWith('custom_')) cell.style.backgroundColor = TOOLS[key].bg;
    else cell.classList.add('cell-' + key);
  }
}

function paintCell(r, c) {
  const v = currentTool === 'eraser' ? null : currentTool;
  if (gridState[r][c] === v) return;
  gridState[r][c] = v;
  const cell = gardenGrid.children[r * gridCols + c];
  if (cell) applyCellStyle(cell, v);
  updateStats();
}

// ── Maus ──────────────────────────────────────────────────────
gardenGrid.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  e.preventDefault();
  const cell = e.target.closest('.grid-cell');
  if (!cell) return;
  const r = +cell.dataset.r, c = +cell.dataset.c;
  if (currentTool === 'label') { showLabelInput(r, c, e.clientX, e.clientY); return; }
  isDrawing = true; paintCell(r, c);
});
gardenGrid.addEventListener('mousemove', e => {
  const cell = e.target.closest('.grid-cell');
  if (!cell) return;
  const r = +cell.dataset.r, c = +cell.dataset.c;
  cellInfo.textContent = `Zeile ${r + 1}, Spalte ${c + 1}`;
  if (isDrawing && currentTool !== 'label') paintCell(r, c);
});
gardenGrid.addEventListener('mouseleave', () => { cellInfo.textContent = ''; });
document.addEventListener('mouseup', () => { if (isDrawing) { isDrawing = false; pushHistory(); } });

// ── Touch ─────────────────────────────────────────────────────
gardenGrid.addEventListener('touchstart', e => {
  e.preventDefault();
  const t = e.touches[0];
  const cell = document.elementFromPoint(t.clientX, t.clientY)?.closest('.grid-cell');
  if (!cell) return;
  const r = +cell.dataset.r, c = +cell.dataset.c;
  if (currentTool === 'label') { showLabelInput(r, c, t.clientX, t.clientY); return; }
  isDrawing = true; paintCell(r, c);
}, { passive: false });
gardenGrid.addEventListener('touchmove', e => {
  e.preventDefault();
  const t = e.touches[0];
  const cell = document.elementFromPoint(t.clientX, t.clientY)?.closest('.grid-cell');
  if (cell && isDrawing && currentTool !== 'label') paintCell(+cell.dataset.r, +cell.dataset.c);
}, { passive: false });
gardenGrid.addEventListener('touchend', () => { if (isDrawing) { isDrawing = false; pushHistory(); } });

// ── Beschriftungs-Popup ───────────────────────────────────────
function showLabelInput(r, c, cx, cy) {
  document.getElementById('labelPopup')?.remove();
  const key   = `${r},${c}`;
  const popup = document.createElement('div');
  popup.id    = 'labelPopup';
  popup.className = 'label-popup';

  const coord = document.createElement('span');
  coord.className   = 'label-popup-coord';
  coord.textContent = `${c + 1}|${r + 1}`;

  const input = document.createElement('input');
  input.type        = 'text';
  input.className   = 'label-popup-input';
  input.value       = labels[key] || '';
  input.placeholder = 'Text…';
  input.maxLength   = 20;

  const del = document.createElement('button');
  del.className   = 'label-popup-del';
  del.textContent = '🗑';
  del.title       = 'Löschen';

  popup.append(coord, input, del);

  // Positionierung (viewport-relativ, an Bildschirmrand anpassen)
  popup.style.left = '-9999px'; popup.style.top = '-9999px';
  document.body.appendChild(popup);
  requestAnimationFrame(() => {
    const pw = popup.offsetWidth, ph = popup.offsetHeight;
    const vw = window.innerWidth,  vh = window.innerHeight;
    popup.style.left = Math.min(cx + 8, vw - pw - 8) + 'px';
    popup.style.top  = (cy + ph + 8 > vh ? cy - ph - 8 : cy + 8) + 'px';
  });
  input.focus(); input.select();

  function save() {
    const val = input.value.trim();
    if (val) labels[key] = val; else delete labels[key];
    popup.remove(); renderLabels(); pushHistory();
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); save(); }
    if (e.key === 'Escape') popup.remove();
  });
  input.addEventListener('blur', e => { if (!popup.contains(e.relatedTarget)) save(); });
  del.addEventListener('mousedown', e => e.preventDefault());
  del.addEventListener('click', () => { delete labels[key]; popup.remove(); renderLabels(); pushHistory(); });

  setTimeout(() => {
    document.addEventListener('mousedown', function outside(e) {
      if (!popup.contains(e.target)) { save(); document.removeEventListener('mousedown', outside); }
    });
  }, 80);
}

// ── Beschriftungs-Overlay ─────────────────────────────────────
function renderLabels() {
  labelOverlay.style.width  = `${gridCols * cellSize}px`;
  labelOverlay.style.height = `${gridRows * cellSize}px`;
  labelOverlay.innerHTML    = '';
  for (const [key, text] of Object.entries(labels)) {
    const [r, c] = key.split(',').map(Number);
    if (r >= gridRows || c >= gridCols) continue;
    const div = document.createElement('div');
    div.className    = 'label-item';
    div.style.left   = `${c * cellSize + 2}px`;
    div.style.top    = `${r * cellSize + (cellSize - Math.max(7, Math.min(cellSize * 0.52, 13))) / 2}px`;
    div.style.width  = 'max-content';
    div.style.height = `${cellSize}px`;
    div.style.fontSize = `${Math.max(7, Math.min(cellSize * 0.48, 13))}px`;
    div.textContent  = text;
    labelOverlay.appendChild(div);
  }
}

// ── Raster-Lineal ─────────────────────────────────────────────
function renderRuler() {
  const container = document.getElementById('gridRulerContainer');
  const corner    = document.getElementById('rulerCorner');
  const top       = document.getElementById('rulerTop');
  const left      = document.getElementById('rulerLeft');

  if (!showRuler) {
    container.style.gridTemplateColumns = 'auto';
    container.style.gridTemplateRows    = 'auto';
    [corner, top, left].forEach(el => el.style.display = 'none');
    return;
  }

  container.style.gridTemplateColumns = `${RULER_W}px auto`;
  container.style.gridTemplateRows    = `${RULER_W}px auto`;
  corner.style.display = '';
  top.style.display    = 'flex';
  left.style.display   = 'flex';

  const step = cellSize < 14 ? 10 : cellSize < 20 ? 5 : cellSize < 28 ? 2 : 1;

  // Oberes Lineal – Spalten
  top.innerHTML = '';
  top.style.height = `${RULER_W}px`;
  for (let c = 0; c < gridCols; c++) {
    const cell = document.createElement('div');
    cell.className  = 'ruler-cell';
    cell.style.width  = `${cellSize}px`;
    cell.style.height = `${RULER_W}px`;
    const n = c + 1;
    if (n === 1 || n % step === 0) { cell.textContent = n; cell.classList.add('ruler-cell--mark'); }
    top.appendChild(cell);
  }

  // Linkes Lineal – Zeilen
  left.innerHTML = '';
  left.style.width = `${RULER_W}px`;
  for (let r = 0; r < gridRows; r++) {
    const cell = document.createElement('div');
    cell.className  = 'ruler-cell';
    cell.style.height = `${cellSize}px`;
    cell.style.width  = `${RULER_W}px`;
    const n = r + 1;
    if (n === 1 || n % step === 0) { cell.textContent = n; cell.classList.add('ruler-cell--mark'); }
    left.appendChild(cell);
  }
}

// ── Undo / Redo ───────────────────────────────────────────────
function pushHistory() {
  history = history.slice(0, historyIndex + 1);
  history.push({ grid: gridState.map(r => [...r]), labels: { ...labels } });
  historyIndex++;
  if (history.length > 60) { history.shift(); historyIndex--; }
  saveToLocalStorage();
}
function undo() {
  if (historyIndex <= 0) return;
  restoreSnapshot(history[--historyIndex]);
}
function redo() {
  if (historyIndex >= history.length - 1) return;
  restoreSnapshot(history[++historyIndex]);
}
function restoreSnapshot(snap) {
  gridState = snap.grid.map(r => [...r]);
  labels    = { ...snap.labels };
  renderGrid(); saveToLocalStorage();
}

// ── Steuerelemente ────────────────────────────────────────────
function bindControls() {
  const colsSlider  = document.getElementById('gridCols');
  const rowsSlider  = document.getElementById('gridRows');
  const colsVal     = document.getElementById('colsVal');
  const rowsVal     = document.getElementById('rowsVal');
  const cellSizeSel = document.getElementById('cellSize');

  colsSlider.addEventListener('input',  () => { colsVal.textContent = gridCols = +colsSlider.value; resizeGrid(); });
  rowsSlider.addEventListener('input',  () => { rowsVal.textContent = gridRows = +rowsSlider.value; resizeGrid(); });
  cellSizeSel.addEventListener('change',() => { cellSize = +cellSizeSel.value; renderGrid(); });

  document.getElementById('btnUndo').addEventListener('click', undo);
  document.getElementById('btnRedo').addEventListener('click', redo);
  document.getElementById('btnClear').addEventListener('click', () => { if (confirm('Garten löschen?')) initGrid(); });
  document.getElementById('btnSave').addEventListener('click', saveToJSON);
  document.getElementById('btnLoad').addEventListener('change', loadFromJSON);
  document.getElementById('btnSaveJPG').addEventListener('click', saveToJPG);
  document.getElementById('btnFullscreen').addEventListener('click', toggleFullscreen);
  document.getElementById('btnClearStorage').addEventListener('click', clearLocalStorage);

  document.getElementById('btnRuler').addEventListener('click', () => {
    showRuler = !showRuler;
    document.getElementById('btnRuler').classList.toggle('active', showRuler);
    renderRuler();
  });

  document.getElementById('btnAddCustom').addEventListener('click', () => {
    const color = document.getElementById('customColor').value;
    const name  = document.getElementById('customName').value.trim() || 'Sonstiges';
    addCustomTool(name, color);
    document.getElementById('customName').value = '';
  });

  document.addEventListener('fullscreenchange', updateFullscreenBtn);
  document.addEventListener('webkitfullscreenchange', updateFullscreenBtn);

  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
    if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); redo(); }
    if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); }
    if (e.key === 'Escape') document.getElementById('labelPopup')?.remove();
  });
}

// ── Größe ändern ──────────────────────────────────────────────
function resizeGrid() {
  gridState = Array.from({ length: gridRows }, (_, r) =>
    Array.from({ length: gridCols }, (_, c) => gridState[r]?.[c] ?? null));
  for (const k of Object.keys(labels)) {
    const [r, c] = k.split(',').map(Number);
    if (r >= gridRows || c >= gridCols) delete labels[k];
  }
  pushHistory(); renderGrid();
}

// ── Statistiken ───────────────────────────────────────────────
function updateStats() {
  const counts = {};
  for (const row of gridState) for (const v of row) if (v) counts[v] = (counts[v] || 0) + 1;
  const total = gridCols * gridRows;
  const free  = Math.round((1 - Object.values(counts).reduce((s, n) => s + n, 0) / total) * 100);
  let html = `<p class="stat-total">🔲 ${total} Felder &nbsp;|&nbsp; ${free}% frei</p>`;
  for (const [key, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    const t = TOOLS[key]; if (!t) continue;
    const pct = Math.round(count / total * 100);
    html += `<div class="stat-item"><div class="stat-header"><span>${t.emoji} ${t.name}</span><span>${count} (${pct}%)</span></div>
      <div class="stat-bar-track"><div class="stat-bar" style="width:${pct}%;background:${t.bg}"></div></div></div>`;
  }
  statsDiv.innerHTML = html;
}

// ── Speichern / Laden ─────────────────────────────────────────
function saveToJSON() {
  const blob = new Blob([JSON.stringify({ gridCols, gridRows, cellSize, gridState, customTools, labels }, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'mein-garten.json' });
  a.click(); URL.revokeObjectURL(a.href);
}
function loadFromJSON(e) {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = ev => { try { const d = JSON.parse(ev.target.result); if (!d.gridState) throw 0; applyLoadedData(d); } catch { alert('Ungültige Datei.'); } };
  r.readAsText(file); e.target.value = '';
}
function applyLoadedData(data) {
  gridCols = data.gridCols; gridRows = data.gridRows; cellSize = data.cellSize || 18;
  gridState = data.gridState; labels = data.labels || {};
  customTools = [];
  for (const k of Object.keys(TOOLS)) if (k.startsWith('custom_')) delete TOOLS[k];
  if (Array.isArray(data.customTools)) {
    for (const ct of data.customTools) { customTools.push(ct); TOOLS[ct.key] = { name: ct.name, emoji: '🎨', bg: ct.color }; }
  }
  syncSliders(); buildToolButtons(); buildLegend();
  history = [{ grid: gridState.map(r => [...r]), labels: { ...labels } }]; historyIndex = 0;
  renderGrid();
}

// ── JPG Export ────────────────────────────────────────────────
function saveToJPG() {
  const scale = 2, titleH = 44, footH = 28;
  const w = gridCols * cellSize, h = gridRows * cellSize;
  const canvas = document.createElement('canvas');
  canvas.width = w * scale; canvas.height = (titleH + h + footH) * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  ctx.fillStyle = '#f0f7ee'; ctx.fillRect(0, 0, w, titleH + h + footH);
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#1b5e20'); grad.addColorStop(1, '#388e3c');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, w, titleH);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.max(13, Math.round(cellSize * .85))}px Segoe UI, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('🌿 Mein Garten Planer', w / 2, titleH / 2);

  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const key = gridState[r][c];
      const x = c * cellSize, y = titleH + r * cellSize;
      ctx.fillStyle = key && TOOLS[key] ? TOOLS[key].bg : '#e8f5e9';
      ctx.fillRect(x, y, cellSize, cellSize);
      ctx.strokeStyle = 'rgba(0,0,0,.08)'; ctx.lineWidth = .5;
      ctx.strokeRect(x + .25, y + .25, cellSize - .5, cellSize - .5);
    }
  }

  // Beschriftungen
  const lfs = Math.max(7, Math.min(cellSize * 0.48, 13));
  ctx.font = `bold ${lfs}px Segoe UI, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const [key, text] of Object.entries(labels)) {
    const [r, c] = key.split(',').map(Number);
    if (r >= gridRows || c >= gridCols) continue;
    const x = c * cellSize + cellSize / 2, y = titleH + r * cellSize + cellSize / 2;
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3; ctx.strokeText(text, x, y);
    ctx.fillStyle = '#111'; ctx.fillText(text, x, y);
  }

  const datum = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const footY = titleH + h;
  ctx.fillStyle = '#2c5f34'; ctx.fillRect(0, footY, w, footH);
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.font = `${Math.max(9, Math.round(cellSize * .6))}px Segoe UI, sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(`📅 ${datum}  •  ${gridCols}×${gridRows}`, 10, footY + footH / 2);

  canvas.toBlob(blob => {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `mein-garten-${datum.replace(/\./g,'-')}.jpg` });
    a.click(); URL.revokeObjectURL(a.href);
  }, 'image/jpeg', 0.93);
}

// ── Vollbild ──────────────────────────────────────────────────
function toggleFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement && !document.webkitFullscreenElement)
    (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  else (document.exitFullscreen || document.webkitExitFullscreen).call(document);
}
function updateFullscreenBtn() {
  const isFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
  document.getElementById('btnFullscreen').textContent = isFS ? '✕ Vollbild beenden' : '⛶ Vollbild';
}

// ── Browser-Speicher ──────────────────────────────────────────
let _st = null;
function saveToLocalStorage() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ gridCols, gridRows, cellSize, gridState, customTools, labels }));
    showStorageStatus('✅ Automatisch gespeichert', 'saved');
  } catch { showStorageStatus('⚠️ Fehler beim Speichern', 'error'); }
}
function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data.gridState) return false;
    applyLoadedData(data);
    showStorageStatus('📂 Garten geladen', 'saved');
    return true;
  } catch { return false; }
}
function clearLocalStorage() {
  if (!confirm('Browser-Speicher löschen?')) return;
  localStorage.removeItem(LS_KEY);
  customTools = []; labels = {};
  for (const k of Object.keys(TOOLS)) if (k.startsWith('custom_')) delete TOOLS[k];
  showStorageStatus('🧹 Speicher geleert', '');
  initGrid(); buildToolButtons(); buildLegend();
}
function showStorageStatus(msg, cls) {
  storageInfo.textContent = msg; storageInfo.className = 'storage-info ' + (cls || '');
  clearTimeout(_st);
  _st = setTimeout(() => { storageInfo.textContent = '💾 Automatisch gespeichert'; storageInfo.className = 'storage-info'; }, 2500);
}

// ── Slider sync ───────────────────────────────────────────────
function syncSliders() {
  document.getElementById('gridCols').value      = gridCols;
  document.getElementById('colsVal').textContent = gridCols;
  document.getElementById('gridRows').value      = gridRows;
  document.getElementById('rowsVal').textContent = gridRows;
  document.getElementById('cellSize').value      = cellSize;
}

// ── Kontrast ──────────────────────────────────────────────────
function contrastColor(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return (r*299 + g*587 + b*114) / 1000 > 128 ? '#222' : '#fff';
}

// ── Start ─────────────────────────────────────────────────────
init();
selectTool('rasen');
