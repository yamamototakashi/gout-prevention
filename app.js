/* 痛風メモ - local-first, zero external API */
(() => {
'use strict';

// ===== Utilities =====
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const pad = (n) => String(n).padStart(2, '0');
const todayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtDate = (d) => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} (${'日月火水木金土'[d.getDay()]})`;
const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const diffDays = (a, b) => Math.round((parseKey(a) - parseKey(b)) / 86400000);

function toast(msg, ms = 1800) {
  try {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), ms);
  } catch (_) { /* noop */ }
}

// ===== Storage (local-first) =====
const KEY = 'tsufu-memo/v1';
const state = {
  settings: {
    theme: 'auto',
    font: 'normal',
    waterGoal: 2000,
    waterStep: 250,
    firstOpen: Date.now(),
  },
  meds: [], // {id,name,type:'daily'|'prn',times:[],note,reminder}
  medLogs: {}, // dateKey -> [{id,medId,time,status:'taken'|'missed'|'later', at}]
  entries: {}, // dateKey -> { pain:[], alcohol:[], water:[], risk:[], state:[], note:[] }
  attacks: [], // {id,start,end,parts:[{name,side}],maxPain,notes}
  visitNote: '',
  ua: {}, // dateKey -> mg/dL
  weight: {}, // dateKey -> kg
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    Object.assign(state, d);
  } catch (e) { /* ignore corrupt */ }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { toast('保存できませんでした'); }
}
function dayEntry(key) {
  if (!state.entries[key]) state.entries[key] = { pain: [], alcohol: [], water: [], risk: [], state: [], note: [] };
  return state.entries[key];
}

// ===== App state =====
const ui = {
  currentDate: todayKey(),
  view: 'home',
  painDraft: { score: null, parts: [], side: 'L', symptoms: new Set(), note: '', isAttack: false, bodyView: 'foot' },
  alcDraft: { kinds: new Set(), units: 1, note: '' },
  riskDraft: { items: new Set(), note: '' },
  stateDraft: { items: new Set(), weight: '', ua: '' },
  medEditing: null,
  reportRange: 30,
};

window.addEventListener('error', (e) => { toast('処理に失敗しました'); });
window.addEventListener('unhandledrejection', (e) => { toast('処理に失敗しました'); });

// ===== Navigation =====
function show(page) {
  ui.view = page;
  $$('.page').forEach(p => p.classList.toggle('hidden', p.dataset.page !== page));
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.nav === page));
  const titles = { home: '今日', timeline: '傾向', attacks: '発作の履歴', report: '受診レポート', settings: '設定', pain: '痛みの記録', meds: '服薬', 'meds-manage': '薬の管理', 'med-edit': '薬の編集', alcohol: '飲酒の記録', risk: '高リスク食品', state: '体調', note: 'メモ' };
  $('#pageTitle').textContent = titles[page] || '痛風メモ';
  window.scrollTo(0, 0);
  if (page === 'home') renderHome();
  if (page === 'timeline') renderTimeline();
  if (page === 'attacks') renderAttacks();
  if (page === 'report') renderReport();
  if (page === 'meds') renderMedsToday();
  if (page === 'meds-manage') renderMedsManage();
  if (page === 'pain') renderPainPage();
  if (page === 'alcohol') renderAlcoholPage();
  if (page === 'risk') renderRiskPage();
  if (page === 'state') renderStatePage();
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-nav]');
  if (t) { show(t.dataset.nav); }
});

// Expose for subsequent modules
window.__app = { state, ui, save, show, toast, dayEntry, fmtDate, fmtTime, todayKey, parseKey, addDays, diffDays, pad, uid };
})();

/* ===== Home screen ===== */
(() => {
const { state, ui, save, show, toast, dayEntry, fmtDate, todayKey, parseKey, addDays, pad, uid } = window.__app;

function setDate(key) {
  ui.currentDate = key;
  renderHome();
}

function renderHome() {
  const d = parseKey(ui.currentDate);
  document.getElementById('homeDate').textContent = fmtDate(d) + (ui.currentDate === todayKey() ? ' · 今日' : '');
  const e = dayEntry(ui.currentDate);
  const waterMl = e.water.reduce((a, b) => a + b.ml, 0);
  document.getElementById('waterTodayMl').textContent = waterMl;
  // meds status summary
  const today = new Date().toISOString().slice(0,10);
  const logs = state.medLogs[ui.currentDate] || [];
  const taken = logs.filter(l => l.status === 'taken').length;
  document.getElementById('medsTodayStatus').textContent = state.meds.length ? `${taken}/${state.meds.length}` : '未登録';

  const list = document.getElementById('todayList');
  const items = [];
  e.pain.forEach(p => items.push({ t: p.at, ico: '⚡', text: `痛み ${p.score} / ${p.parts.map(x => x.name + (x.side === 'B' ? '' : `(${x.side==='L'?'左':'右'})`)).join('、') || '部位未選択'}` }));
  e.alcohol.forEach(a => {
    if (a.kinds.length === 0 && a.units === 0) items.push({ t: a.at, ico: '🚫🍺', text: '飲酒なし' });
    else items.push({ t: a.at, ico: '🍺', text: `${a.kinds.map(kindLabel).join('、') || '飲酒'} × ${a.units}` });
  });
  e.water.forEach(w => items.push({ t: w.at, ico: '💧', text: `水分 +${w.ml}ml` }));
  e.risk.forEach(r => items.push({ t: r.at, ico: '🥩', text: r.items.map(riskLabel).join('、') }));
  e.state.forEach(s => items.push({ t: s.at, ico: '😴', text: s.items.map(stateLabel).join('、') || '体調記録' }));
  e.note.forEach(n => items.push({ t: n.at, ico: '📝', text: n.text.slice(0, 40) }));
  (state.medLogs[ui.currentDate] || []).forEach(l => {
    const m = state.meds.find(x => x.id === l.medId);
    if (!m) return;
    const sico = l.status === 'taken' ? '💊' : l.status === 'missed' ? '⛔' : '⏳';
    const st = l.status === 'taken' ? '服用' : l.status === 'missed' ? 'スキップ' : '後で';
    items.push({ t: l.at, ico: sico, text: `${m.name} ${st}${l.time ? ' ('+l.time+')' : ''}` });
  });
  if (state.ua[ui.currentDate]) items.push({ t: Date.now(), ico: '🧪', text: `尿酸値 ${state.ua[ui.currentDate]} mg/dL` });
  if (state.weight[ui.currentDate]) items.push({ t: Date.now(), ico: '⚖️', text: `体重 ${state.weight[ui.currentDate]} kg` });

  items.sort((a, b) => a.t - b.t);
  list.innerHTML = items.length === 0
    ? '<li class="muted">まだ記録がありません。上のボタンからどうぞ。</li>'
    : items.map(i => `<li><span class="t-ico">${i.ico}</span><span class="t-text">${escapeHtml(i.text)}</span><span class="t-time">${new Date(i.t).toTimeString().slice(0,5)}</span></li>`).join('');

  // attack banner
  const open = state.attacks.find(a => !a.end);
  const ab = document.getElementById('attackBanner');
  if (open) {
    ab.classList.remove('hidden');
    const days = Math.max(1, Math.round((Date.now() - open.start) / 86400000) + 1);
    document.getElementById('attackBannerText').textContent = `発作 ${days}日目 · 最大痛み ${open.maxPain || 0}`;
  } else {
    ab.classList.add('hidden');
  }
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
function kindLabel(k) { return ({ beer:'ビール', sake:'日本酒', wine:'ワイン', shochu:'焼酎/ウイスキー', other:'その他' })[k] || k; }
function riskLabel(k) { return ({ organ:'内臓系', roe:'魚卵・干物', redmeat:'赤身肉', seafood:'エビ/イカ/カツオ', sweet_drink:'甘い飲料', big_meal:'食べすぎ' })[k] || k; }
function stateLabel(k) { return ({ sleep_short:'睡眠不足', stress:'ストレス', dehydration:'脱水気味', overwork:'運動しすぎ', cold:'冷え' })[k] || k; }

// date nav
document.getElementById('dayPrev').addEventListener('click', () => setDate(keyOffset(ui.currentDate, -1)));
document.getElementById('dayNext').addEventListener('click', () => { const n = keyOffset(ui.currentDate, 1); if (n <= todayKey()) setDate(n); });
document.getElementById('dayToday').addEventListener('click', () => setDate(todayKey()));
function keyOffset(k, n) {
  const d = parseKey(k); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

// quick actions
document.querySelectorAll('.quick').forEach(b => b.addEventListener('click', () => {
  const q = b.dataset.quick;
  const e = dayEntry(ui.currentDate);
  const now = Date.now();
  if (q === 'nodrink') {
    e.alcohol.push({ id: uid(), at: now, kinds: [], units: 0, note: '' });
    save(); toast('飲まなかった、を記録しました 👍'); renderHome();
  } else if (q === 'water') {
    e.water.push({ id: uid(), at: now, ml: state.settings.waterStep });
    save(); toast(`水分 +${state.settings.waterStep}ml`); renderHome();
  } else if (q === 'pain') {
    ui.painDraft = { score: null, parts: [], side: 'L', symptoms: new Set(), note: '', isAttack: false, bodyView: 'foot' };
    show('pain');
  } else if (q === 'meds') {
    show('meds');
  }
}));

// secondary quick
document.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
  const a = b.dataset.add;
  if (a === 'alcohol') { ui.alcDraft = { kinds: new Set(), units: 1, note: '' }; show('alcohol'); }
  else if (a === 'risk') { ui.riskDraft = { items: new Set(), note: '' }; show('risk'); }
  else if (a === 'state') { ui.stateDraft = { items: new Set(), weight: state.weight[ui.currentDate] || '', ua: state.ua[ui.currentDate] || '' }; show('state'); }
  else if (a === 'note') { show('note'); }
}));

// End attack
document.getElementById('btnEndAttack').addEventListener('click', () => {
  const open = state.attacks.find(a => !a.end);
  if (!open) return;
  open.end = Date.now();
  save(); toast('発作の終了を記録しました'); renderHome();
});

// Today detail -> scroll or switch to attack if exists
document.getElementById('btnTodayDetail').addEventListener('click', () => show('timeline'));

window.__app.renderHome = renderHome;
window.__app.kindLabel = kindLabel;
window.__app.riskLabel = riskLabel;
window.__app.stateLabel = stateLabel;
window.__app.escapeHtml = escapeHtml;
})();

/* ===== Pain recording + body diagram ===== */
(() => {
const { state, ui, save, show, toast, dayEntry, uid, renderHome } = window.__app;

const FOOT_PARTS = [
  { id: 'big_toe', label: '母趾', x: 120, y: 70 },
  { id: 'toe2', label: '第2趾', x: 145, y: 80 },
  { id: 'toe3', label: '第3趾', x: 162, y: 90 },
  { id: 'toe4', label: '第4趾', x: 178, y: 100 },
  { id: 'toe5', label: '第5趾', x: 193, y: 115 },
  { id: 'instep', label: '足背', x: 150, y: 180 },
  { id: 'midfoot', label: '足の甲中央', x: 165, y: 230 },
  { id: 'ankle', label: '足首', x: 155, y: 290 },
  { id: 'heel', label: 'かかと', x: 155, y: 355 },
];

const FULL_PARTS = [
  { id: 'shoulder', label: '肩', x: 60, y: 100 },
  { id: 'elbow', label: '肘', x: 40, y: 170 },
  { id: 'wrist', label: '手首', x: 30, y: 240 },
  { id: 'finger', label: '指', x: 20, y: 285 },
  { id: 'knee', label: '膝', x: 80, y: 340 },
  { id: 'ankle2', label: '足首', x: 80, y: 450 },
  { id: 'toe', label: '足趾', x: 80, y: 500 },
];

function buildFootSVG() {
  // a simplified top-view of right foot (used for both sides)
  const parts = FOOT_PARTS.map(p => {
    const sel = ui.painDraft.parts.find(x => x.id === p.id);
    const cls = sel ? `part sel-${sel.side}` : 'part';
    return `<circle class="${cls}" data-part-id="${p.id}" data-part-label="${p.label}" cx="${p.x}" cy="${p.y}" r="18" />
            <text x="${p.x}" y="${p.y+4}" text-anchor="middle" font-size="10" fill="#6b7380" pointer-events="none">${p.label}</text>`;
  }).join('');
  return `<svg viewBox="0 0 300 400" width="260" height="340" aria-label="足の図">
    <path d="M90,40 Q150,-10 210,40 Q250,140 230,260 Q210,380 150,390 Q90,380 70,260 Q50,140 90,40 Z"
      fill="none" stroke="#9aa4b2" stroke-width="2" />
    ${parts}
  </svg>`;
}

function buildFullBodySVG() {
  const parts = FULL_PARTS.map(p => {
    const sel = ui.painDraft.parts.find(x => x.id === p.id);
    const cls = sel ? `part sel-${sel.side}` : 'part';
    return `<circle class="${cls}" data-part-id="${p.id}" data-part-label="${p.label}" cx="${p.x}" cy="${p.y}" r="14" />
            <circle class="${cls}" data-part-id="${p.id}" data-part-label="${p.label}" cx="${200-p.x}" cy="${p.y}" r="14" />
            <text x="${p.x}" y="${p.y+4}" text-anchor="middle" font-size="9" fill="#6b7380" pointer-events="none">${p.label}</text>
            <text x="${200-p.x}" y="${p.y+4}" text-anchor="middle" font-size="9" fill="#6b7380" pointer-events="none">${p.label}</text>`;
  }).join('');
  return `<svg viewBox="0 0 200 560" width="220" height="560" aria-label="全身図">
    <circle cx="100" cy="40" r="26" fill="none" stroke="#9aa4b2" stroke-width="2" />
    <path d="M70,70 L130,70 L150,120 L160,260 L120,260 L120,540 L90,540 L90,260 L40,260 L50,120 Z"
      fill="none" stroke="#9aa4b2" stroke-width="2" />
    ${parts}
  </svg>`;
}

function renderPainPage() {
  // NRS buttons
  const nrs = document.querySelector('#page-pain .nrs');
  if (!nrs.hasChildNodes()) {
    nrs.innerHTML = [...Array(11)].map((_, i) => `<button type="button" data-v="${i}">${i}</button>`).join('');
    nrs.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]'); if (!b) return;
      ui.painDraft.score = Number(b.dataset.v);
      nrs.querySelectorAll('button').forEach(x => x.classList.toggle('active', Number(x.dataset.v) === ui.painDraft.score));
    });
  }
  nrs.querySelectorAll('button').forEach(x => x.classList.toggle('active', Number(x.dataset.v) === ui.painDraft.score));

  // Body canvas
  const canvas = document.getElementById('bodyCanvas');
  canvas.innerHTML = ui.painDraft.bodyView === 'foot' ? buildFootSVG() : buildFullBodySVG();

  // Selected parts
  updateSelectedParts();

  // Sym chips
  document.querySelectorAll('#page-pain [data-sym]').forEach(b => {
    b.classList.toggle('active', ui.painDraft.symptoms.has(b.dataset.sym));
  });

  // attack checkbox
  document.getElementById('painIsAttack').checked = ui.painDraft.isAttack;
  document.getElementById('painNote').value = ui.painDraft.note || '';

  // side toggle
  document.querySelectorAll('#page-pain .side').forEach(b => {
    b.classList.toggle('active', b.dataset.side === ui.painDraft.side);
  });

  // view tabs
  document.querySelectorAll('#page-pain .view-tabs .tab').forEach(b => {
    b.classList.toggle('active', b.dataset.view === ui.painDraft.bodyView);
  });
}

function updateSelectedParts() {
  const wrap = document.getElementById('selectedParts');
  if (ui.painDraft.parts.length === 0) { wrap.innerHTML = '<span class="muted">部位をタップ</span>'; return; }
  wrap.innerHTML = ui.painDraft.parts.map(p =>
    `<span class="tag" data-remove="${p.id}">${p.name} ${p.side==='B'?'両側':(p.side==='L'?'左':'右')} ✕</span>`
  ).join('');
}

document.addEventListener('click', (e) => {
  if (ui.view !== 'pain') return;
  const t = e.target.closest('[data-part-id]');
  if (t) {
    const id = t.dataset.partId;
    const label = t.dataset.partLabel;
    const side = ui.painDraft.side;
    const idx = ui.painDraft.parts.findIndex(p => p.id === id && p.side === side);
    if (idx >= 0) ui.painDraft.parts.splice(idx, 1);
    else ui.painDraft.parts.push({ id, name: label, side });
    renderPainPage();
    return;
  }
  const tag = e.target.closest('[data-remove]');
  if (tag && tag.closest('#selectedParts')) {
    const id = tag.dataset.remove;
    ui.painDraft.parts = ui.painDraft.parts.filter(p => p.id !== id);
    renderPainPage();
  }
});

document.querySelectorAll('#page-pain .view-tabs .tab').forEach(b => b.addEventListener('click', () => {
  ui.painDraft.bodyView = b.dataset.view;
  renderPainPage();
}));
document.querySelectorAll('#page-pain .side').forEach(b => b.addEventListener('click', () => {
  ui.painDraft.side = b.dataset.side;
  renderPainPage();
}));
document.querySelectorAll('#page-pain [data-sym]').forEach(b => b.addEventListener('click', () => {
  const s = b.dataset.sym;
  if (ui.painDraft.symptoms.has(s)) ui.painDraft.symptoms.delete(s); else ui.painDraft.symptoms.add(s);
  renderPainPage();
}));
document.getElementById('painIsAttack').addEventListener('change', (e) => {
  ui.painDraft.isAttack = e.target.checked;
});
document.getElementById('painNote').addEventListener('input', (e) => {
  ui.painDraft.note = e.target.value;
});

document.getElementById('savePain').addEventListener('click', () => {
  if (ui.painDraft.score == null) { toast('痛みの強さを選んでください'); return; }
  const e = dayEntry(ui.currentDate);
  const rec = {
    id: uid(), at: Date.now(),
    score: ui.painDraft.score,
    parts: ui.painDraft.parts.map(p => ({ id: p.id, name: p.name, side: p.side })),
    symptoms: [...ui.painDraft.symptoms],
    note: ui.painDraft.note || '',
  };
  e.pain.push(rec);

  // Auto-attach to ongoing attack or create new
  let attack = state.attacks.find(a => !a.end);
  if (ui.painDraft.isAttack || (!attack && ui.painDraft.score >= 4)) {
    attack = { id: uid(), start: Date.now(), end: null, parts: [], maxPain: 0, painEntries: [] };
    state.attacks.push(attack);
  }
  if (attack) {
    attack.maxPain = Math.max(attack.maxPain || 0, rec.score);
    rec.parts.forEach(p => {
      if (!attack.parts.find(x => x.id === p.id && x.side === p.side)) attack.parts.push(p);
    });
    attack.painEntries = attack.painEntries || [];
    attack.painEntries.push(rec.id);
  }

  save();
  toast('痛みを記録しました');
  show('home');
});

window.__app.renderPainPage = renderPainPage;
})();

/* ===== Alcohol / Risk / State / Note ===== */
(() => {
const { state, ui, save, show, toast, dayEntry, uid } = window.__app;

function renderAlcoholPage() {
  document.querySelectorAll('#page-alcohol [data-kind]').forEach(b => b.classList.toggle('active', ui.alcDraft.kinds.has(b.dataset.kind)));
  document.getElementById('alcUnits').textContent = ui.alcDraft.units;
  document.getElementById('alcNote').value = ui.alcDraft.note || '';
}
document.querySelectorAll('#page-alcohol [data-kind]').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.kind;
  if (ui.alcDraft.kinds.has(k)) ui.alcDraft.kinds.delete(k); else ui.alcDraft.kinds.add(k);
  renderAlcoholPage();
}));
document.querySelectorAll('#page-alcohol .step').forEach(b => b.addEventListener('click', () => {
  const d = Number(b.dataset.delta);
  ui.alcDraft.units = Math.max(0, Math.min(30, ui.alcDraft.units + d));
  renderAlcoholPage();
}));
document.getElementById('alcNote').addEventListener('input', (e) => { ui.alcDraft.note = e.target.value; });
document.getElementById('saveAlcohol').addEventListener('click', () => {
  const e = dayEntry(ui.currentDate);
  e.alcohol.push({
    id: uid(), at: Date.now(),
    kinds: [...ui.alcDraft.kinds],
    units: ui.alcDraft.units,
    note: ui.alcDraft.note || '',
  });
  save(); toast('飲酒を記録しました'); show('home');
});

function renderRiskPage() {
  document.querySelectorAll('#page-risk [data-risk]').forEach(b => b.classList.toggle('active', ui.riskDraft.items.has(b.dataset.risk)));
  document.getElementById('riskNote').value = ui.riskDraft.note || '';
}
document.querySelectorAll('#page-risk [data-risk]').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.risk;
  if (ui.riskDraft.items.has(k)) ui.riskDraft.items.delete(k); else ui.riskDraft.items.add(k);
  renderRiskPage();
}));
document.getElementById('riskNote').addEventListener('input', (e) => { ui.riskDraft.note = e.target.value; });
document.getElementById('saveRisk').addEventListener('click', () => {
  if (ui.riskDraft.items.size === 0) { toast('1つ以上選んでください'); return; }
  const e = dayEntry(ui.currentDate);
  e.risk.push({ id: uid(), at: Date.now(), items: [...ui.riskDraft.items], note: ui.riskDraft.note || '' });
  save(); toast('食事傾向を記録しました'); show('home');
});

function renderStatePage() {
  document.querySelectorAll('#page-state [data-state]').forEach(b => b.classList.toggle('active', ui.stateDraft.items.has(b.dataset.state)));
  document.getElementById('weightInput').value = ui.stateDraft.weight || '';
  document.getElementById('uaInput').value = ui.stateDraft.ua || '';
}
document.querySelectorAll('#page-state [data-state]').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.state;
  if (ui.stateDraft.items.has(k)) ui.stateDraft.items.delete(k); else ui.stateDraft.items.add(k);
  renderStatePage();
}));
document.getElementById('saveState').addEventListener('click', () => {
  const e = dayEntry(ui.currentDate);
  if (ui.stateDraft.items.size > 0) {
    e.state.push({ id: uid(), at: Date.now(), items: [...ui.stateDraft.items] });
  }
  const w = parseFloat(document.getElementById('weightInput').value);
  const u = parseFloat(document.getElementById('uaInput').value);
  if (!isNaN(w) && w > 0) state.weight[ui.currentDate] = w;
  if (!isNaN(u) && u > 0) state.ua[ui.currentDate] = u;
  save(); toast('記録しました'); show('home');
});

document.getElementById('saveNote').addEventListener('click', () => {
  const txt = document.getElementById('freeNote').value.trim();
  if (!txt) { show('home'); return; }
  const e = dayEntry(ui.currentDate);
  e.note.push({ id: uid(), at: Date.now(), text: txt });
  document.getElementById('freeNote').value = '';
  save(); toast('メモを保存しました'); show('home');
});

window.__app.renderAlcoholPage = renderAlcoholPage;
window.__app.renderRiskPage = renderRiskPage;
window.__app.renderStatePage = renderStatePage;
})();

/* ===== Medication ===== */
(() => {
const { state, ui, save, show, toast, uid } = window.__app;

function renderMedsToday() {
  const list = document.getElementById('medsTodayList');
  const empty = document.getElementById('medsEmptyHint');
  if (state.meds.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  const logs = state.medLogs[ui.currentDate] || [];
  const items = [];
  state.meds.forEach(m => {
    if (m.type === 'daily') {
      const times = (m.times && m.times.length) ? m.times : [''];
      times.forEach(t => {
        const log = logs.find(l => l.medId === m.id && l.time === t);
        items.push({ med: m, time: t, log });
      });
    } else {
      // PRN - one row to record "take now"
      items.push({ med: m, time: '', log: null, prn: true });
      logs.filter(l => l.medId === m.id && l.status === 'taken').forEach(l => {
        items.push({ med: m, time: '', log: l, prn: true, past: true });
      });
    }
  });
  list.innerHTML = items.map((it, i) => {
    const statusTxt = it.log?.status === 'taken' ? '<span class="taken">服用済</span>' :
                       it.log?.status === 'missed' ? '<span class="missed">スキップ</span>' :
                       it.log?.status === 'later' ? '<span class="later">後で</span>' : '';
    const timeTxt = it.time ? it.time : (it.prn ? '頓服' : '');
    const ctrls = it.past ? '' : `
      <div class="m-actions">
        <button class="btn" data-take="${i}">飲んだ</button>
        <button class="btn" data-later="${i}">後で</button>
        <button class="btn ghost" data-skip="${i}">スキップ</button>
      </div>`;
    return `<li>
      <div style="flex:1">
        <div class="m-name">${window.__app.escapeHtml(it.med.name)} <small class="m-sub">${timeTxt}</small></div>
        <div class="m-sub">${statusTxt} ${it.log ? '· '+ new Date(it.log.at).toTimeString().slice(0,5) : ''}</div>
        ${it.med.note ? `<div class="m-sub">${window.__app.escapeHtml(it.med.note)}</div>` : ''}
      </div>
      ${ctrls}
    </li>`;
  }).join('');

  list._items = items;
  list.onclick = (e) => {
    const b = e.target.closest('button[data-take],button[data-later],button[data-skip]');
    if (!b) return;
    const idx = Number(b.dataset.take ?? b.dataset.later ?? b.dataset.skip);
    const it = list._items[idx]; if (!it) return;
    const action = b.dataset.take != null ? 'taken' : b.dataset.later != null ? 'later' : 'missed';
    logMed(it.med.id, it.time, action);
  };
}

function logMed(medId, time, status) {
  const day = ui.currentDate;
  if (!state.medLogs[day]) state.medLogs[day] = [];
  const logs = state.medLogs[day];
  const existing = logs.find(l => l.medId === medId && l.time === time && l.status !== 'taken');
  if (existing && status === 'taken') existing.status = 'taken';
  else {
    const prev = logs.find(l => l.medId === medId && l.time === time);
    if (prev) prev.status = status;
    else logs.push({ id: uid(), medId, time, status, at: Date.now() });
  }
  // PRN always creates new entry when taken
  if (status === 'taken' && state.meds.find(m => m.id === medId)?.type === 'prn') {
    logs.push({ id: uid(), medId, time: '', status: 'taken', at: Date.now() });
  }
  save(); toast('記録しました'); renderMedsToday();
}

function renderMedsManage() {
  const list = document.getElementById('medsRegList');
  if (state.meds.length === 0) {
    list.innerHTML = '<li class="muted">まだ薬が登録されていません</li>';
    return;
  }
  list.innerHTML = state.meds.map((m, i) => `
    <li>
      <div style="flex:1">
        <div class="m-name">${window.__app.escapeHtml(m.name)}</div>
        <div class="m-sub">${m.type === 'daily' ? '毎日服用' : '頓服'} ${(m.times||[]).join(', ')} ${m.reminder ? '🔔' : ''}</div>
        ${m.note ? `<div class="m-sub">${window.__app.escapeHtml(m.note)}</div>` : ''}
      </div>
      <div class="m-actions"><button class="btn small" data-edit-med="${m.id}">編集</button></div>
    </li>`).join('');
  list.onclick = (e) => {
    const b = e.target.closest('[data-edit-med]');
    if (!b) return;
    ui.medEditing = b.dataset.editMed;
    show('med-edit');
    fillMedForm();
  };
}

function fillMedForm() {
  const m = state.meds.find(x => x.id === ui.medEditing) || { name:'', type:'daily', times:[], note:'', reminder:false };
  document.getElementById('medName').value = m.name;
  document.getElementById('medType').value = m.type;
  document.getElementById('medTime').value = (m.times || []).join(', ');
  document.getElementById('medNote').value = m.note || '';
  document.getElementById('medReminder').checked = !!m.reminder;
  toggleTimeField();
}

function toggleTimeField() {
  const t = document.getElementById('medType').value;
  document.getElementById('fldMedTime').style.display = t === 'daily' ? '' : 'none';
}

document.getElementById('btnAddMed').addEventListener('click', () => {
  ui.medEditing = null;
  document.getElementById('medName').value = '';
  document.getElementById('medType').value = 'daily';
  document.getElementById('medTime').value = '';
  document.getElementById('medNote').value = '';
  document.getElementById('medReminder').checked = false;
  show('med-edit');
  toggleTimeField();
});

document.getElementById('medType').addEventListener('change', toggleTimeField);

document.querySelectorAll('[data-suggest]').forEach(b => b.addEventListener('click', () => {
  document.getElementById('medName').value = b.dataset.suggest;
}));

document.getElementById('saveMed').addEventListener('click', () => {
  const name = document.getElementById('medName').value.trim();
  if (!name) { toast('薬の名前を入力してください'); return; }
  const type = document.getElementById('medType').value;
  const times = document.getElementById('medTime').value.split(',').map(s => s.trim()).filter(Boolean);
  const note = document.getElementById('medNote').value.trim();
  const reminder = document.getElementById('medReminder').checked;

  let m = state.meds.find(x => x.id === ui.medEditing);
  if (m) { Object.assign(m, { name, type, times, note, reminder }); }
  else { state.meds.push({ id: uid(), name, type, times, note, reminder }); }
  save(); toast('薬を保存しました');
  if (reminder) scheduleLocalReminders();
  show('meds-manage');
});

document.getElementById('deleteMed').addEventListener('click', () => {
  if (!ui.medEditing) { show('meds-manage'); return; }
  if (!confirm('この薬を削除しますか？（服用履歴は残ります）')) return;
  state.meds = state.meds.filter(x => x.id !== ui.medEditing);
  save(); toast('削除しました'); show('meds-manage');
});

document.getElementById('btnManageMeds').addEventListener('click', () => show('meds-manage'));

// ----- local notification scheduler (page-open only, as fallback) -----
let reminderTimers = [];
function scheduleLocalReminders() {
  reminderTimers.forEach(clearTimeout);
  reminderTimers = [];
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  const now = new Date();
  state.meds.filter(m => m.reminder && m.type === 'daily').forEach(m => {
    (m.times || []).forEach(t => {
      const [h, mm] = t.split(':').map(Number);
      if (isNaN(h) || isNaN(mm)) return;
      const target = new Date(); target.setHours(h, mm, 0, 0);
      if (target <= now) target.setDate(target.getDate() + 1);
      const delay = target - now;
      if (delay < 0 || delay > 24 * 3600 * 1000) return;
      const id = setTimeout(() => {
        try { new Notification('服薬リマインド', { body: `${m.name} (${t})`, icon: 'icons/icon-192.png' }); } catch (_) {}
      }, delay);
      reminderTimers.push(id);
    });
  });
}
window.__app.scheduleLocalReminders = scheduleLocalReminders;
window.__app.renderMedsToday = renderMedsToday;
window.__app.renderMedsManage = renderMedsManage;
})();

/* ===== Timeline + correlation ===== */
(() => {
const { state, ui, save, show, toast, todayKey, parseKey, pad } = window.__app;

function dateKeyAdd(key, n) {
  const d = parseKey(key); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function daySummary(key) {
  const e = state.entries[key] || {};
  const pains = e.pain || [];
  const maxPain = pains.reduce((m, p) => Math.max(m, p.score), 0);
  const alc = (e.alcohol || []).filter(a => !(a.kinds.length === 0 && a.units === 0)).length > 0;
  const noDrink = (e.alcohol || []).some(a => a.kinds.length === 0 && a.units === 0);
  const water = (e.water || []).reduce((a, b) => a + b.ml, 0);
  const risk = (e.risk || []).length > 0;
  const med = (state.medLogs[key] || []).some(l => l.status === 'taken');
  const attack = state.attacks.some(a => {
    const s = new Date(a.start).toISOString().slice(0,10);
    const en = a.end ? new Date(a.end).toISOString().slice(0,10) : todayKey();
    return key >= s && key <= en;
  });
  return { maxPain, alc, noDrink, water, risk, med, attack, pains };
}

function renderTimeline() {
  const range = Number(document.getElementById('tlRange').value || 30);
  const end = todayKey();
  const cells = [];
  for (let i = range - 1; i >= 0; i--) {
    const k = dateKeyAdd(end, -i);
    cells.push({ key: k, ...daySummary(k) });
  }
  const tl = document.getElementById('timeline');
  tl.innerHTML = cells.map(c => {
    const d = parseKey(c.key);
    const dots = [];
    if (c.maxPain > 0) dots.push('<span class="dot-pain"></span>');
    if (c.alc) dots.push('<span class="dot-alc"></span>');
    if (c.water >= state.settings.waterGoal * 0.8) dots.push('<span class="dot-water"></span>');
    if (c.risk) dots.push('<span class="dot-risk"></span>');
    if (c.med) dots.push('<span class="dot-med"></span>');
    const cls = ['tl-cell'];
    if (c.attack) cls.push('attack');
    if (c.key === todayKey()) cls.push('today');
    return `<div class="${cls.join(' ')}" title="${c.key}">
      <div class="tl-date">${d.getMonth()+1}/${d.getDate()}</div>
      ${c.maxPain > 0 ? `<div class="tl-pain">${c.maxPain}</div>` : ''}
      <div class="tl-dots">${dots.join('')}</div>
    </div>`;
  }).join('');

  renderCorrelations(range);
  renderAttackWindow();
}

function renderCorrelations(range) {
  const end = todayKey();
  const painDays = [];
  const nonPainDays = [];
  for (let i = 0; i < range; i++) {
    const k = dateKeyAdd(end, -i);
    const s = daySummary(k);
    (s.maxPain >= 4 ? painDays : nonPainDays).push({ key: k, ...s });
  }
  const list = document.getElementById('correlationList');
  const obs = [];

  if (painDays.length < 2) {
    obs.push('まだ痛みの記録が少ないため、傾向は表示できません。毎日続けて記録してみてください。');
  } else {
    // Alcohol previous day
    const drinkBeforePain = painDays.filter(p => {
      const prev = dateKeyAdd(p.key, -1);
      return (state.entries[prev]?.alcohol || []).some(a => a.units > 0);
    }).length;
    const ratePain = drinkBeforePain / painDays.length;
    const drinkBeforeNonPain = nonPainDays.filter(p => {
      const prev = dateKeyAdd(p.key, -1);
      return (state.entries[prev]?.alcohol || []).some(a => a.units > 0);
    }).length;
    const rateNon = nonPainDays.length ? drinkBeforeNonPain / nonPainDays.length : 0;
    if (ratePain - rateNon > 0.15) obs.push(`<span class="corr-strong">飲酒の翌日に痛みが出やすい傾向</span>があるかもしれません（痛み日 ${Math.round(ratePain*100)}% vs それ以外 ${Math.round(rateNon*100)}%）。`);

    // Water deficit
    const lowWaterPain = painDays.filter(p => p.water < state.settings.waterGoal * 0.6).length;
    const lowWaterNon = nonPainDays.filter(p => p.water < state.settings.waterGoal * 0.6).length;
    const ratePw = lowWaterPain / painDays.length;
    const rateNw = nonPainDays.length ? lowWaterNon / nonPainDays.length : 0;
    if (ratePw - rateNw > 0.15) obs.push('<span class="corr-strong">水分が少ない日に痛みが出やすい</span>関係があるかもしれません。');

    // Risk food
    const riskBeforePain = painDays.filter(p => state.entries[dateKeyAdd(p.key, -1)]?.risk?.length).length;
    const riskBeforeNon = nonPainDays.filter(p => state.entries[dateKeyAdd(p.key, -1)]?.risk?.length).length;
    if ((riskBeforePain/painDays.length) - (nonPainDays.length ? riskBeforeNon/nonPainDays.length : 0) > 0.15)
      obs.push('前日に<span class="corr-strong">高リスク食品</span>を食べた日に痛みが出やすい傾向があるかもしれません。');

    // Recurring parts
    const partCount = {};
    painDays.forEach(p => {
      (state.entries[p.key]?.pain || []).forEach(pe => pe.parts.forEach(pt => {
        const k = `${pt.name}(${pt.side==='B'?'両側':pt.side==='L'?'左':'右'})`;
        partCount[k] = (partCount[k] || 0) + 1;
      }));
    });
    const top = Object.entries(partCount).sort((a,b) => b[1]-a[1]).slice(0,2);
    if (top.length) obs.push(`くり返し痛みが出ている部位：<span class="corr-strong">${top.map(t => `${t[0]} ×${t[1]}`).join(' / ')}</span>`);
  }

  list.innerHTML = obs.map(o => `<li>${o}</li>`).join('');
}

function renderAttackWindow() {
  const card = document.getElementById('attackWindowCard');
  const wrap = document.getElementById('attackWindow');
  const last = [...state.attacks].sort((a,b) => b.start - a.start)[0];
  if (!last) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');
  const dKey = new Date(last.start).toISOString().slice(0,10);
  const prev1 = dateKeyAdd(dKey, -1);
  const prev2 = dateKeyAdd(dKey, -2);
  wrap.innerHTML = `
    <div class="win"><h3>発作前24h</h3>${summarizeDay(prev1)}</div>
    <div class="win"><h3>発作前48h</h3>${summarizeDay(prev2)}</div>
  `;
}

function summarizeDay(k) {
  const e = state.entries[k] || {};
  const alc = (e.alcohol || []).filter(a => a.units > 0);
  const water = (e.water || []).reduce((a, b) => a + b.ml, 0);
  const risk = (e.risk || []).flatMap(r => r.items).map(window.__app.riskLabel || (x=>x));
  const st = (e.state || []).flatMap(s => s.items);
  const lines = [];
  if (alc.length) lines.push(`🍺 ${alc.reduce((a,b) => a+b.units, 0)}杯`);
  lines.push(`💧 ${water}ml`);
  if (risk.length) lines.push(`🥩 ${risk.join('、')}`);
  if (st.length) lines.push(`😴 ${st.map(x => window.__app.stateLabel ? window.__app.stateLabel(x) : x).join('、')}`);
  return `<div class="m-sub">${k}</div>${lines.map(l => `<div>${l}</div>`).join('') || '<div class="muted">記録なし</div>'}`;
}

document.getElementById('tlRange').addEventListener('change', renderTimeline);

/* ===== Attack list ===== */
function renderAttacks() {
  const list = document.getElementById('attackList');
  if (state.attacks.length === 0) {
    list.innerHTML = '<li class="muted">まだ発作の記録はありません。痛みの記録で「発作として登録」するか、強い痛みを記録すると自動で開始されます。</li>';
    return;
  }
  const arr = [...state.attacks].sort((a,b) => b.start - a.start);
  list.innerHTML = arr.map(a => {
    const s = new Date(a.start);
    const e = a.end ? new Date(a.end) : null;
    const days = Math.max(1, Math.round(((e || new Date()) - s) / 86400000) + 1);
    const parts = (a.parts || []).map(p => `${p.name}(${p.side==='B'?'両':p.side==='L'?'左':'右'})`).join('、') || '未選択';
    return `<li>
      <div class="a-head"><span>${s.getFullYear()}/${pad(s.getMonth()+1)}/${pad(s.getDate())}${e ? ' 〜 '+e.getFullYear()+'/'+pad(e.getMonth()+1)+'/'+pad(e.getDate()) : ' (継続中)'}</span><span>痛み最大 ${a.maxPain}</span></div>
      <div class="a-sub">${days}日 / 部位: ${parts}</div>
    </li>`;
  }).join('');
}

window.__app.renderTimeline = renderTimeline;
window.__app.renderAttacks = renderAttacks;
window.__app.dateKeyAdd = dateKeyAdd;
window.__app.daySummary = daySummary;
})();

/* ===== Report (receiving-visit) + Export/Import ===== */
(() => {
const { state, ui, save, show, toast, todayKey, parseKey, pad, dateKeyAdd } = window.__app;

function renderReport() {
  const range = ui.reportRange;
  const art = document.getElementById('reportView');
  document.querySelectorAll('#page-report [data-range]').forEach(b =>
    b.classList.toggle('active', String(b.dataset.range) === String(range)));

  document.getElementById('visitNote').value = state.visitNote || '';

  let html = `<h1>痛風メモ 受診レポート</h1>
    <div class="rpt-meta">作成日: ${new Date().toLocaleString('ja-JP')}</div>`;

  if (range === 'attacks') {
    html += buildAttackReport();
  } else {
    html += buildPeriodReport(Number(range));
  }

  html += `<h2>受診時メモ</h2><p>${escapeHtml(state.visitNote || '(なし)')}</p>`;
  html += `<h2>注意事項</h2><p class="rpt-meta">このレポートは自己記録の集計であり、診断を示すものではありません。用量・治療判断は医師の指示に従ってください。</p>`;
  art.innerHTML = html;
}

function buildPeriodReport(days) {
  const end = todayKey();
  const rows = [];
  let totalAlcDays = 0, totalNoDrinkDays = 0, totalAttackDays = 0;
  let waterSum = 0, waterCnt = 0;
  const recentUa = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = dateKeyAdd(end, -i);
    const e = state.entries[k] || {};
    const pains = e.pain || [];
    const maxPain = pains.reduce((m, p) => Math.max(m, p.score), 0);
    const alc = (e.alcohol || []).filter(a => a.units > 0);
    const alcU = alc.reduce((a,b)=>a+b.units,0);
    const alcK = [...new Set(alc.flatMap(a => a.kinds))].map(window.__app.kindLabel).join('、');
    const noDrink = (e.alcohol || []).some(a => a.units === 0 && a.kinds.length === 0);
    const water = (e.water || []).reduce((a,b)=>a+b.ml,0);
    const risks = [...new Set((e.risk||[]).flatMap(r => r.items))].map(window.__app.riskLabel).join('、');
    const meds = (state.medLogs[k] || []).filter(l => l.status === 'taken').map(l => {
      const m = state.meds.find(x => x.id === l.medId);
      return m ? m.name : '';
    }).filter(Boolean).join('、');
    const states = [...new Set((e.state||[]).flatMap(s => s.items))].map(window.__app.stateLabel).join('、');
    const ua = state.ua[k];
    const weight = state.weight[k];
    const attack = state.attacks.some(a => {
      const sd = new Date(a.start).toISOString().slice(0,10);
      const ed = a.end ? new Date(a.end).toISOString().slice(0,10) : todayKey();
      return k >= sd && k <= ed;
    });
    if (alcU > 0) totalAlcDays++;
    if (noDrink) totalNoDrinkDays++;
    if (attack) totalAttackDays++;
    if (water) { waterSum += water; waterCnt++; }
    if (ua) recentUa.push({ k, v: ua });

    rows.push({ k, maxPain, alcU, alcK, water, risks, meds, states, ua, weight, attack });
  }
  const avgWater = waterCnt ? Math.round(waterSum / waterCnt) : 0;

  let h = `<h2>サマリー（直近${days}日）</h2>
    <ul>
      <li>発作のあった日: ${totalAttackDays}日</li>
      <li>飲酒した日: ${totalAlcDays}日 / 飲まなかった日: ${totalNoDrinkDays}日</li>
      <li>平均水分量: ${avgWater} ml / 日</li>
      ${recentUa.length ? `<li>尿酸値（直近の記録）: ${recentUa.slice(-5).map(x => `${x.k.slice(5)} ${x.v}mg/dL`).join(' / ')}</li>` : ''}
    </ul>`;
  h += `<h2>日別記録</h2><table><thead><tr>
    <th>日付</th><th>痛み</th><th>発作</th><th>飲酒</th><th>水分ml</th><th>高リスク</th><th>服薬</th><th>体調</th><th>尿酸</th><th>体重</th></tr></thead><tbody>`;
  rows.forEach(r => {
    const d = parseKey(r.k);
    h += `<tr>
      <td>${d.getMonth()+1}/${d.getDate()}(${'日月火水木金土'[d.getDay()]})</td>
      <td>${r.maxPain || ''}</td>
      <td>${r.attack ? '●' : ''}</td>
      <td>${r.alcU ? `${r.alcU}(${escapeHtml(r.alcK)})` : ''}</td>
      <td>${r.water || ''}</td>
      <td>${escapeHtml(r.risks)}</td>
      <td>${escapeHtml(r.meds)}</td>
      <td>${escapeHtml(r.states)}</td>
      <td>${r.ua || ''}</td>
      <td>${r.weight || ''}</td>
    </tr>`;
  });
  h += `</tbody></table>`;
  return h;
}

function buildAttackReport() {
  const arr = [...state.attacks].sort((a,b) => b.start - a.start);
  if (arr.length === 0) return '<p>発作の記録はありません。</p>';
  let h = `<h2>発作サマリー</h2><table><thead><tr>
    <th>開始</th><th>終了</th><th>日数</th><th>最大痛み</th><th>部位</th><th>前日の飲酒/水分</th><th>使った薬</th></tr></thead><tbody>`;
  arr.forEach(a => {
    const s = new Date(a.start); const e = a.end ? new Date(a.end) : null;
    const days = Math.max(1, Math.round(((e || new Date()) - s) / 86400000) + 1);
    const parts = (a.parts || []).map(p => `${p.name}(${p.side==='B'?'両':p.side==='L'?'左':'右'})`).join('、');
    const dKey = s.toISOString().slice(0,10);
    const prev = window.__app.dateKeyAdd(dKey, -1);
    const alc = (state.entries[prev]?.alcohol || []).filter(a => a.units>0).reduce((a,b)=>a+b.units,0);
    const water = (state.entries[prev]?.water || []).reduce((a,b)=>a+b.ml,0);
    const meds = [];
    for (let i = 0; i < days; i++) {
      const k = window.__app.dateKeyAdd(dKey, i);
      (state.medLogs[k] || []).filter(l => l.status === 'taken').forEach(l => {
        const m = state.meds.find(x => x.id === l.medId);
        if (m) meds.push(m.name);
      });
    }
    h += `<tr>
      <td>${fmt(s)}</td>
      <td>${e ? fmt(e) : '継続中'}</td>
      <td>${days}</td>
      <td>${a.maxPain}</td>
      <td>${escapeHtml(parts)}</td>
      <td>酒${alc || 0} / 水${water}ml</td>
      <td>${escapeHtml([...new Set(meds)].join('、'))}</td>
    </tr>`;
  });
  h += `</tbody></table>`;
  return h;
}
function fmt(d) { return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())}`; }
function escapeHtml(s) { return window.__app.escapeHtml(s || ''); }

document.querySelectorAll('#page-report [data-range]').forEach(b => b.addEventListener('click', () => {
  ui.reportRange = b.dataset.range === 'attacks' ? 'attacks' : Number(b.dataset.range);
  renderReport();
}));
document.getElementById('visitNote').addEventListener('input', (e) => {
  state.visitNote = e.target.value;
  save();
});

document.getElementById('btnPrint').addEventListener('click', () => {
  try { window.print(); } catch (_) { toast('印刷ダイアログを開けませんでした'); }
});

document.getElementById('btnCsv').addEventListener('click', () => {
  try {
    const rows = [['date','maxPain','attack','alcUnits','alcKinds','waterMl','risk','meds','state','ua','weight']];
    const days = 180;
    const end = todayKey();
    for (let i = days - 1; i >= 0; i--) {
      const k = window.__app.dateKeyAdd(end, -i);
      const e = state.entries[k] || {};
      const mp = (e.pain || []).reduce((m,p) => Math.max(m, p.score), 0);
      const alc = (e.alcohol || []).filter(a => a.units>0);
      const attack = state.attacks.some(a => {
        const sd = new Date(a.start).toISOString().slice(0,10);
        const ed = a.end ? new Date(a.end).toISOString().slice(0,10) : todayKey();
        return k >= sd && k <= ed;
      }) ? 1 : 0;
      rows.push([
        k, mp, attack,
        alc.reduce((a,b)=>a+b.units,0),
        [...new Set(alc.flatMap(a=>a.kinds))].join('|'),
        (e.water||[]).reduce((a,b)=>a+b.ml,0),
        [...new Set((e.risk||[]).flatMap(r=>r.items))].join('|'),
        (state.medLogs[k]||[]).filter(l=>l.status==='taken').map(l=>state.meds.find(m=>m.id===l.medId)?.name||'').filter(Boolean).join('|'),
        [...new Set((e.state||[]).flatMap(s=>s.items))].join('|'),
        state.ua[k] || '',
        state.weight[k] || '',
      ]);
    }
    const csv = rows.map(r => r.map(x => {
      const s = String(x ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
    }).join(',')).join('\n');
    download('tsufu-memo.csv', 'text/csv;charset=utf-8', '\ufeff' + csv);
  } catch (_) { toast('CSV出力に失敗しました'); }
});

document.getElementById('btnExportJson').addEventListener('click', () => {
  try {
    download('tsufu-memo-backup.json', 'application/json', JSON.stringify(state, null, 2));
  } catch (_) { toast('エクスポートに失敗しました'); }
});

document.getElementById('importJson').addEventListener('change', (e) => {
  const f = e.target.files?.[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!confirm('現在のデータを上書きして復元しますか？')) return;
      Object.keys(state).forEach(k => delete state[k]);
      Object.assign(state, d);
      save(); toast('復元しました'); show('home');
    } catch (_) { toast('ファイルを読み込めませんでした'); }
  };
  r.readAsText(f);
});

function download(name, type, content) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

window.__app.renderReport = renderReport;
})();

/* ===== Settings + Theme + Install + Boot ===== */
(() => {
const { state, ui, save, show, toast, scheduleLocalReminders } = window.__app;

function applyTheme() {
  const t = state.settings.theme;
  const html = document.documentElement;
  if (t === 'auto') html.removeAttribute('data-theme'); else html.setAttribute('data-theme', t);
  html.setAttribute('data-font', state.settings.font || 'normal');
}

function renderSettings() {
  document.getElementById('setTheme').value = state.settings.theme;
  document.getElementById('setFont').value = state.settings.font;
  document.getElementById('setWaterGoal').value = state.settings.waterGoal;
  document.getElementById('setWaterStep').value = state.settings.waterStep;
  if ('Notification' in window) {
    const btn = document.getElementById('btnEnableNotif');
    btn.textContent = Notification.permission === 'granted' ? '許可済み' :
                      Notification.permission === 'denied' ? 'ブロック中' : '許可する';
  }
}
document.getElementById('setTheme').addEventListener('change', (e) => { state.settings.theme = e.target.value; save(); applyTheme(); });
document.getElementById('setFont').addEventListener('change', (e) => { state.settings.font = e.target.value; save(); applyTheme(); });
document.getElementById('setWaterGoal').addEventListener('change', (e) => { state.settings.waterGoal = Number(e.target.value) || 2000; save(); });
document.getElementById('setWaterStep').addEventListener('change', (e) => { state.settings.waterStep = Number(e.target.value) || 250; save(); });
document.getElementById('btnEnableNotif').addEventListener('click', async () => {
  if (!('Notification' in window)) { toast('この端末では通知が使えません'); return; }
  try {
    const r = await Notification.requestPermission();
    if (r === 'granted') { toast('通知が有効になりました'); scheduleLocalReminders && scheduleLocalReminders(); }
    else toast('通知は有効になりませんでした');
    renderSettings();
  } catch (_) { toast('通知の設定に失敗しました'); }
});
document.getElementById('btnWipe').addEventListener('click', () => {
  if (!confirm('すべての記録を消去します。よろしいですか？')) return;
  try { localStorage.removeItem('tsufu-memo/v1'); } catch (_) {}
  location.reload();
});

// Header buttons
document.getElementById('btnTheme').addEventListener('click', () => {
  const order = ['auto','light','dark'];
  const i = order.indexOf(state.settings.theme);
  state.settings.theme = order[(i+1) % order.length];
  save(); applyTheme(); toast(`表示: ${state.settings.theme}`);
});
document.getElementById('btnMenu').addEventListener('click', () => show('settings'));

// Install prompt
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const banner = document.getElementById('installBanner');
  if (!localStorage.getItem('tsufu-memo/install-dismissed')) banner.classList.remove('hidden');
});
document.getElementById('btnInstall').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  try { await deferredPrompt.userChoice; } catch (_) {}
  deferredPrompt = null;
  document.getElementById('installBanner').classList.add('hidden');
});
document.getElementById('btnInstallClose').addEventListener('click', () => {
  document.getElementById('installBanner').classList.add('hidden');
  try { localStorage.setItem('tsufu-memo/install-dismissed','1'); } catch (_) {}
});

// ===== Boot =====
function boot() {
  try {
    // Load
    const raw = localStorage.getItem('tsufu-memo/v1');
    if (raw) {
      try { Object.assign(state, JSON.parse(raw)); } catch (_) {}
    }
    applyTheme();
    renderSettings();
    show('home');

    // Register SW
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline ignored */ });
    }
    // Deep-link quick actions
    const p = new URLSearchParams(location.search);
    const q = p.get('quick');
    if (q === 'water') {
      const e = window.__app.dayEntry(ui.currentDate);
      e.water.push({ id: Math.random().toString(36).slice(2), at: Date.now(), ml: state.settings.waterStep });
      save(); toast(`水分 +${state.settings.waterStep}ml`); window.__app.renderHome();
    } else if (q === 'nodrink') {
      const e = window.__app.dayEntry(ui.currentDate);
      e.alcohol.push({ id: Math.random().toString(36).slice(2), at: Date.now(), kinds: [], units: 0, note: '' });
      save(); toast('飲まなかった、を記録'); window.__app.renderHome();
    } else if (q === 'pain') {
      show('pain');
    }
    if (q) history.replaceState(null, '', location.pathname);

    scheduleLocalReminders && scheduleLocalReminders();
  } catch (_) {
    toast('起動時エラーが発生しました');
  }
}

document.addEventListener('DOMContentLoaded', boot, { once: true });
if (document.readyState !== 'loading') boot();
})();
