/* ============================================================
   Mortar & Pestle SAT — application logic
   Storage is browser-local. Bank is read-only from ./data/bank.json
   ============================================================ */
(function () {
'use strict';

/* ---------- constants ---------- */
var PACE_TARGET = 71;              // seconds per question, R&W section pace
var SLOW_FACTOR = 2;               // auto-flag above 2x target
var DEFAULT_LEN = 22;              // questions per session
var LETTERS = ['A', 'B', 'C', 'D'];

var DOMAINS = [
  { name: 'Information and Ideas', types: ['Central idea', 'Detail retrieval', 'Inference', 'Textual evidence', 'Quantitative evidence'] },
  { name: 'Craft and Structure', types: ['Words in context', 'Text structure', 'Function of underlined portion', 'Purpose of the text', 'Cross-text connections'] },
  { name: 'Expression of Ideas', types: ['Transitions', 'Rhetorical synthesis'] },
  { name: 'Standard English Conventions', types: ['Boundaries & form'] }
];
var TYPES = DOMAINS.reduce(function (a, d) { return a.concat(d.types); }, []);
var FLAG_REASONS = ['Concept gap', 'Misread question', 'Careless', 'Time pressure', 'Vocabulary'];

/* ---------- tiny helpers ---------- */
function $(id) { return document.getElementById(id); }
function el(tag, cls, html) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function uid(p) { return (p || 'x') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function pct(n, d) { return d ? Math.round((n / d) * 100) : null; }
function mmss(s) {
  s = Math.max(0, Math.round(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function fmtDate(ts) {
  var d = new Date(ts);
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}
function fmtDateTime(ts) {
  var d = new Date(ts);
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) + ' ' +
         d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
function shuffle(a) {
  a = a.slice();
  for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function toast(msg) {
  var t = el('div', 'toast', esc(msg));
  document.body.appendChild(t);
  setTimeout(function () { t.remove(); }, 2200);
}

/* ============================================================
   STORE
   ============================================================ */
var KEY = 'mp.v1.';
var Store = {
  get: function (k, fb) {
    try { var v = localStorage.getItem(KEY + k); return v == null ? fb : JSON.parse(v); }
    catch (e) { return fb; }
  },
  set: function (k, v) {
    try { localStorage.setItem(KEY + k, JSON.stringify(v)); }
    catch (e) { toast('Storage full — export and reset.'); }
  },
  clear: function () {
    Object.keys(localStorage).filter(function (k) { return k.indexOf(KEY) === 0; })
      .forEach(function (k) { localStorage.removeItem(k); });
  }
};

var DB = {
  profile: null,     // {name, baseline, examDate, token, deviceId, createdAt}
  attempts: [],      // append-only
  sessions: [],
  collections: [],
  notes: [],
  vocab: []
};

function loadDB() {
  DB.profile     = Store.get('profile', null);
  DB.attempts    = Store.get('attempts', []);
  DB.sessions    = Store.get('sessions', []);
  DB.collections = Store.get('collections', null) || seedCollections();
  DB.notes       = Store.get('notes', []);
  DB.vocab       = Store.get('vocab', []);
}
function seedCollections() {
  var c = [{ id: 'redemption', name: 'Redemption', builtin: true, qids: [], createdAt: Date.now() }];
  Store.set('collections', c);
  return c;
}
function save(k) { Store.set(k, DB[k]); }

/* ============================================================
   BANK
   ============================================================ */
var BANK = [];       // normalised questions
var BY_ID = {};

function normaliseType(row) {
  var prompt = (row.PromptText || row.QuestionText || '').toLowerCase();
  var skill = (row.Skill || row.QuestionType || '').toLowerCase();

  if (/most logical transition/.test(prompt) || /transition/.test(skill)) return 'Transitions';
  if (/wants to|would like to/.test(prompt) && /which choice|best accomplish/.test(prompt)) return 'Rhetorical synthesis';
  if (/rhetorical synthesis|synthesis/.test(skill)) return 'Rhetorical synthesis';
  if (/conventions of standard english/.test(prompt)) return 'Boundaries & form';
  if (/boundaries|form, structure/.test(skill)) return 'Boundaries & form';
  if (/most logical and precise word|logically completes the text.*word|word or phrase/.test(prompt)) return 'Words in context';
  if (/words in context/.test(skill)) return 'Words in context';
  if (/function of the underlined|underlined (sentence|portion)/.test(prompt)) return 'Function of underlined portion';
  if (/main purpose|primary purpose/.test(prompt)) return 'Purpose of the text';
  if (/overall structure|structure of the text/.test(prompt)) return 'Text structure';
  if (/text structure|purpose/.test(skill)) return 'Text structure';
  if (/author of text 2|both texts|text 1 and text 2/.test(prompt)) return 'Cross-text connections';
  if (/cross-text/.test(skill)) return 'Cross-text connections';
  if (/(table|graph|data)/.test(prompt) && /(illustrate|complete|support)/.test(prompt)) return 'Quantitative evidence';
  if (/quantitative/.test(skill)) return 'Quantitative evidence';
  if (/most effectively (supports|illustrates)|would most (directly|strongly) support/.test(prompt)) return 'Textual evidence';
  if (/command of evidence/.test(skill)) return 'Textual evidence';
  if (/most logically completes the text/.test(prompt)) return 'Inference';
  if (/inference/.test(skill)) return 'Inference';
  if (/according to the text|based on the text.*true/.test(prompt)) return 'Detail retrieval';
  if (/main idea|central idea/.test(prompt) || /central ideas/.test(skill)) return 'Central idea';
  return 'Central idea';
}
function domainOf(type) {
  for (var i = 0; i < DOMAINS.length; i++) if (DOMAINS[i].types.indexOf(type) > -1) return DOMAINS[i].name;
  return DOMAINS[0].name;
}
function normDifficulty(d) {
  d = String(d || '').trim().toUpperCase();
  if (d[0] === 'E') return 'E';
  if (d[0] === 'H') return 'H';
  return 'M';
}

function normalise(row) {
  var type = normaliseType(row);
  var passage = row.QuestionHTML || row.FigureHTML || '';
  if (!passage) passage = '<p>' + esc(row.PassageText || '') + '</p>';
  else if (row.TableHTML) passage += row.TableHTML;
  return {
    id: row.QuestionID || row.id || uid('q'),
    passage: passage,
    plain: row.PassageText || '',
    prompt: row.PromptText || row.QuestionText || '',
    choices: [row.OptionA, row.OptionB, row.OptionC, row.OptionD].map(function (c) { return c == null ? '' : String(c); }),
    answer: LETTERS.indexOf(String(row.CorrectAnswer || 'A').trim().toUpperCase()[0]),
    difficulty: normDifficulty(row.Difficulty),
    domain: row.Domain || domainOf(type),
    type: type,
    rationale: row.RationaleCorrect || row.RationaleFull || '',
    whyNot: [row.WhyNotA, row.WhyNotB, row.WhyNotC, row.WhyNotD],
    image: row.ImagePath || ''
  };
}

function loadBank() {
  return fetch('./data/bank.json', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('no bank'); return r.json(); })
    .then(function (rows) {
      BANK = rows.map(normalise).filter(function (q) { return q.answer >= 0 && q.choices[0]; });
    })
    .catch(function () {
      BANK = (window.MP_SAMPLE_BANK || []).map(normalise);
      if (BANK.length) toast('Sample bank loaded — data/bank.json not found');
    })
    .then(function () {
      BY_ID = {};
      BANK.forEach(function (q) { BY_ID[q.id] = q; });
      $('bankStatus').textContent = BANK.length + ' questions on file';
    });
}

/* ============================================================
   STATS
   ============================================================ */
function attemptsFor(type) {
  return type ? DB.attempts.filter(function (a) { return a.type === type; }) : DB.attempts.slice();
}
function windowAcc(arr, n) {
  var w = n ? arr.slice(-n) : arr;
  if (!w.length) return null;
  var c = w.filter(function (a) { return a.correct; }).length;
  return { pct: pct(c, w.length), n: w.length, correct: c };
}
function windows(type) {
  var a = attemptsFor(type);
  return { L10: windowAcc(a, 10), L20: windowAcc(a, 20), L50: windowAcc(a, 50), OVR: windowAcc(a, 0) };
}
function seenCount() {
  var s = {};
  DB.attempts.forEach(function (a) { s[a.qid] = 1; });
  return Object.keys(s).length;
}
function missedIds() {
  var last = {};
  DB.attempts.forEach(function (a) { last[a.qid] = a.correct; });
  return Object.keys(last).filter(function (q) { return !last[q]; });
}
function flaggedAttempts() {
  return DB.attempts.filter(function (a) { return a.flagged || a.flagReason; });
}
function flaggedIds() {
  var seen = {}, out = [];
  flaggedAttempts().forEach(function (a) { if (!seen[a.qid]) { seen[a.qid] = 1; out.push(a.qid); } });
  return out;
}
function paceByType() {
  var m = {};
  DB.attempts.filter(function (a) { return a.mode === 'timed' && typeof a.seconds === 'number'; }).forEach(function (a) {
    (m[a.type] = m[a.type] || []).push(a.seconds);
  });
  return Object.keys(m).map(function (t) {
    var arr = m[t], avg = arr.reduce(function (x, y) { return x + y; }, 0) / arr.length;
    return { type: t, avg: avg, n: arr.length };
  }).sort(function (a, b) { return b.avg - a.avg; });
}
function slowAttempts() {
  return DB.attempts.filter(function (a) { return a.mode === 'timed' && a.seconds > PACE_TARGET * SLOW_FACTOR; })
    .slice().reverse().slice(0, 12);
}
function sessionSeries() {
  // L10 at the end of each session
  var out = [], run = [];
  DB.sessions.forEach(function (s) {
    var att = DB.attempts.filter(function (a) { return a.sessionId === s.id; });
    if (!att.length) return;
    run = run.concat(att);
    var w = windowAcc(run, 10);
    if (w) out.push({ ts: s.endedAt || s.startedAt, pct: w.pct });
  });
  return out;
}

/* ============================================================
   ROUTING
   ============================================================ */
var RENDER = {};
function go(page) {
  document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
  var t = $('page-' + page);
  if (t) t.classList.add('active');
  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.classList.toggle('active', b.dataset.page === page);
  });
  if (RENDER[page]) RENDER[page]();
  window.scrollTo(0, 0);
}
function renderAll() {
  ['dashboard', 'analytics', 'history', 'sets', 'toolbox'].forEach(function (p) { if (RENDER[p]) RENDER[p](); });
}

/* ============================================================
   MODAL
   ============================================================ */
function modal(html, onMount) {
  $('modalBody').innerHTML = html;
  $('modal').classList.remove('hidden');
  if (onMount) onMount($('modalBody'));
}
function closeModal() { $('modal').classList.add('hidden'); $('modalBody').innerHTML = ''; }
$('modal').addEventListener('click', function (e) { if (e.target === this) closeModal(); });

/* ============================================================
   GATE
   ============================================================ */
// Replace with your own list. Each entry authorises one browser.
var TOKENS = ['MP-DEMO-0001', 'MP-DEMO-0002', 'MP-DEMO-0003', 'MP-DEMO-0004', 'MP-DEMO-0005'];

function openApp() {
  $('gate').classList.add('hidden');
  $('app').classList.remove('hidden');
  paintChrome();
  renderAll();
}
function paintChrome() {
  var p = DB.profile || {};
  $('whoChip').textContent = (p.name || '—') + (p.baseline ? ' · ' + p.baseline : '');
  var d = daysOut();
  $('ddayChip').textContent = d == null ? 'no date set' : (d >= 0 ? 'T−' + d : 'test passed');
}
function daysOut() {
  var p = DB.profile;
  if (!p || !p.examDate) return null;
  var t = new Date(p.examDate + 'T00:00:00');
  var now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((t - now) / 86400000);
}
$('gateBtn').addEventListener('click', function () {
  var name = $('f-name').value.trim();
  var score = parseInt($('f-score').value, 10);
  var date = $('f-date').value;
  var token = $('f-token').value.trim().toUpperCase();
  var err = $('gateErr');
  if (!name) { err.textContent = 'Name is required.'; return; }
  if (!date) { err.textContent = 'Exam date is required — the counter needs it.'; return; }
  if (TOKENS.indexOf(token) === -1) { err.textContent = 'Token not recognised.'; return; }
  var used = Store.get('usedTokens', []);
  if (used.indexOf(token) > -1) { err.textContent = 'This token was already redeemed on this browser.'; return; }
  used.push(token); Store.set('usedTokens', used);
  DB.profile = {
    name: name, baseline: isNaN(score) ? null : score, examDate: date,
    token: token, deviceId: uid('dev'), createdAt: Date.now()
  };
  save('profile');
  openApp();
});
$('whoChip').addEventListener('click', function () {
  var p = DB.profile || {};
  modal(
    '<h3>Profile</h3><p class="sh-sub">Stored in this browser only.</p>' +
    '<div class="field"><label>Name</label><input id="pfName" value="' + esc(p.name || '') + '"></div>' +
    '<div class="row2"><div class="field"><label>Current R&amp;W</label><input id="pfScore" type="number" value="' + (p.baseline || '') + '"></div>' +
    '<div class="field"><label>Exam date</label><input id="pfDate" type="date" value="' + esc(p.examDate || '') + '"></div></div>' +
    '<div style="display:flex;gap:10px;margin-top:8px"><button class="btn ghost small" style="flex:1" data-x="c">Cancel</button>' +
    '<button class="btn small" style="flex:2" data-x="s">Save</button></div>',
    function (m) {
      m.querySelector('[data-x=c]').onclick = closeModal;
      m.querySelector('[data-x=s]').onclick = function () {
        DB.profile.name = $('pfName').value.trim() || DB.profile.name;
        var s = parseInt($('pfScore').value, 10);
        DB.profile.baseline = isNaN(s) ? null : s;
        DB.profile.examDate = $('pfDate').value || DB.profile.examDate;
        save('profile'); closeModal(); paintChrome(); RENDER.dashboard();
      };
    }
  );
});

/* ============================================================
   DASHBOARD
   ============================================================ */
RENDER.dashboard = function () {
  var p = DB.profile || {};
  var seen = seenCount(), total = BANK.length || 607;
  var w = windows(null);

  $('welcomeLine').innerHTML = 'Welcome, <em>' + esc(p.name || 'friend') + '</em>.';

  var remaining = total - seen;
  var line;
  if (seen === 0) line = 'Nothing logged yet. The first ten questions are the only ones that are hard to start.';
  else if (w.L10 && w.OVR && w.L10.pct > w.OVR.pct) line = 'Your last ten are running ' + (w.L10.pct - w.OVR.pct) + ' points above your all-time rate. Keep the streak of sessions, not of days.';
  else if (remaining < 60) line = 'Under sixty questions left in the bank. Finish it, then start the second pass on Redemption.';
  else line = 'Every question you post moves a number on this page. Nothing else does.';
  $('creedLine').textContent = line;

  $('bankBar').style.width = Math.min(100, (seen / total) * 100) + '%';

  var pills = [
    '<span class="pill">Attempted <b>' + seen + '</b> / ' + total + ' — keep going</span>',
    '<span class="pill">Sessions <b>' + DB.sessions.length + '</b></span>',
    '<span class="pill">Redemption queue <b>' + missedIds().length + '</b></span>'
  ];
  if (w.OVR) pills.push('<span class="pill">Overall <b>' + w.OVR.pct + '%</b></span>');
  $('creedPills').innerHTML = pills.join('');

  // D-day ring
  var d = daysOut();
  var horizon = 120;
  var frac = d == null ? 0 : Math.max(0, Math.min(1, 1 - (d / horizon)));
  var C = 327;
  $('ddayRing').innerHTML =
    '<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" fill="none" stroke="#D8CCA9" stroke-width="9"/>' +
    '<circle cx="60" cy="60" r="52" fill="none" stroke="#335745" stroke-width="9" stroke-linecap="round" ' +
    'stroke-dasharray="' + C + '" stroke-dashoffset="' + (C - C * frac) + '"/></svg>' +
    '<div class="center"><div class="dnum">' + (d == null ? '—' : Math.abs(d)) + '</div>' +
    '<div class="dlbl">' + (d == null ? 'set a date' : d >= 0 ? 'days out' : 'days past') + '</div></div>';

  $('cntFlagged').textContent = flaggedIds().length;
  $('cntRedemption').textContent = missedIds().length;

  // windows
  $('briefWindows').innerHTML = ['L10', 'L20', 'L50', 'OVR'].map(function (k) {
    var v = w[k];
    var cls = (v && w.OVR && k !== 'OVR') ? (v.pct >= w.OVR.pct ? 'up' : 'down') : '';
    return '<div class="lrow"><span class="tag">' + k + '</span><span class="val ' + cls + '">' +
      (v ? v.pct + '%' : '—') + '<small>' + (v ? v.correct + '/' + v.n : 'no data') + '</small></span></div>';
  }).join('');

  // sparkline
  var series = sessionSeries();
  if (series.length < 2) {
    $('briefSpark').innerHTML = '<div class="empty" style="padding:22px 12px"><b>Not enough sessions</b>Two sessions and the trend line starts drawing.</div>';
  } else {
    var pts = series.slice(-14).map(function (s, i, arr) {
      var x = 4 + (i / Math.max(1, arr.length - 1)) * 292;
      var y = 96 - (s.pct / 100) * 88;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var lastPt = pts.split(' ').pop().split(',');
    $('briefSpark').innerHTML =
      '<svg viewBox="0 0 300 104" preserveAspectRatio="none">' +
      '<line x1="0" y1="26" x2="300" y2="26" stroke="#D8CCA9"/><line x1="0" y1="52" x2="300" y2="52" stroke="#D8CCA9"/>' +
      '<line x1="0" y1="78" x2="300" y2="78" stroke="#D8CCA9"/>' +
      '<polyline fill="none" stroke="#335745" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="' + pts + '"/>' +
      '<circle cx="' + lastPt[0] + '" cy="' + lastPt[1] + '" r="4" fill="#A6452A"/></svg>';
  }

  // weakest three by L50
  var ranked = TYPES.map(function (t) { return { t: t, w: windows(t).L50 }; })
    .filter(function (r) { return r.w && r.w.n >= 3; })
    .sort(function (a, b) { return a.w.pct - b.w.pct; }).slice(0, 3);
  if (!ranked.length) {
    $('briefWeak').innerHTML = '<div class="empty" style="padding:22px 12px"><b>No category data</b>Three attempts in a category and it starts ranking.</div>';
  } else {
    $('briefWeak').innerHTML = ranked.map(function (r) {
      var cls = r.w.pct < 50 ? '' : r.w.pct < 70 ? 'mid' : 'ok';
      return '<div class="barline"><span class="bl">' + esc(r.t) + '</span><span class="btrack">' +
        '<span class="bfill ' + cls + '" style="width:' + r.w.pct + '%"></span></span><span class="bp">' + r.w.pct + '%</span></div>';
    }).join('') +
    '<div style="margin-top:14px"><button class="btn small ghost" id="grindWeak">Grind ' + esc(ranked[0].t) + ' now</button></div>';
    $('grindWeak').onclick = function () {
      startSession({ mode: 'untimed', label: ranked[0].t, filter: function (q) { return q.type === ranked[0].t; } });
    };
  }
};

document.querySelectorAll('[data-start]').forEach(function (b) {
  b.addEventListener('click', function () {
    startSession({ mode: b.dataset.start, label: 'Mixed' });
  });
});
document.querySelectorAll('[data-goto]').forEach(function (b) {
  b.addEventListener('click', function () { go(b.dataset.goto); });
});
$('tabs').addEventListener('click', function (e) {
  var b = e.target.closest('button'); if (b) go(b.dataset.page);
});

$('btnCategory').addEventListener('click', function () {
  var counts = {};
  BANK.forEach(function (q) { counts[q.type] = (counts[q.type] || 0) + 1; });
  var html = '<h3>Category practice</h3><p class="sh-sub">Pick one or more question types.</p><div class="opt-grid">' +
    TYPES.map(function (t) {
      return '<button class="opt" data-t="' + esc(t) + '"><span>' + esc(t) + '</span><span class="c">' + (counts[t] || 0) + '</span></button>';
    }).join('') + '</div>' + modeFooter();
  modal(html, function (m) {
    var picked = {};
    m.querySelectorAll('.opt').forEach(function (o) {
      o.onclick = function () { o.classList.toggle('on'); picked[o.dataset.t] = o.classList.contains('on'); };
    });
    wireModeFooter(m, function (mode) {
      var list = Object.keys(picked).filter(function (k) { return picked[k]; });
      if (!list.length) { toast('Pick at least one category'); return; }
      closeModal();
      startSession({
        mode: mode, label: list.length === 1 ? list[0] : list.length + ' categories',
        filter: function (q) { return list.indexOf(q.type) > -1; }
      });
    });
  });
});
$('btnFlagged').addEventListener('click', function () {
  var ids = flaggedIds();
  if (!ids.length) { toast('Nothing flagged yet'); return; }
  modal('<h3>Flagged questions</h3><p class="sh-sub">' + ids.length + ' saved. Oldest first.</p>' + modeFooter(), function (m) {
    wireModeFooter(m, function (mode) {
      closeModal();
      startSession({ mode: mode, label: 'Flagged', ids: ids, ordered: true });
    });
  });
});
$('btnTargeted').addEventListener('click', function () { openTargeted(); });

function openTargeted() {
  var missed = missedIds();
  var html = '<h3>Targeted practice</h3><p class="sh-sub">Redemption, your collections, or questions similar to what you keep missing.</p>' +
    '<div class="coll on" data-k="redemption"><span><span class="cname">Redemption</span><br>' +
    '<span class="cmeta">' + missed.length + ' questions · every one you last got wrong</span></span><span class="tick"></span></div>' +
    DB.collections.filter(function (c) { return !c.builtin; }).map(function (c) {
      return '<div class="coll" data-k="' + c.id + '"><span><span class="cname">' + esc(c.name) + '</span><br>' +
        '<span class="cmeta">' + c.qids.length + ' questions</span></span><span class="tick"></span></div>';
    }).join('') +
    '<div class="coll" data-k="similar"><span><span class="cname">Similar questions</span><br>' +
    '<span class="cmeta">Same type &amp; difficulty as your misses, not yet seen</span></span><span class="tick"></span></div>' +
    modeFooter();
  modal(html, function (m) {
    m.querySelectorAll('.coll').forEach(function (c) { c.onclick = function () { c.classList.toggle('on'); }; });
    wireModeFooter(m, function (mode) {
      var keys = Array.prototype.slice.call(m.querySelectorAll('.coll.on')).map(function (c) { return c.dataset.k; });
      if (!keys.length) { toast('Pick at least one source'); return; }
      var ids = {};
      keys.forEach(function (k) {
        if (k === 'redemption') missed.forEach(function (q) { ids[q] = 1; });
        else if (k === 'similar') similarIds(missed).forEach(function (q) { ids[q] = 1; });
        else {
          var c = DB.collections.filter(function (x) { return x.id === k; })[0];
          if (c) c.qids.forEach(function (q) { ids[q] = 1; });
        }
      });
      var list = Object.keys(ids);
      if (!list.length) { toast('That selection is empty'); return; }
      closeModal();
      startSession({ mode: mode, label: 'Targeted', ids: list });
    });
  });
}
function similarIds(missed) {
  var sigs = {};
  missed.forEach(function (id) { var q = BY_ID[id]; if (q) sigs[q.type + '|' + q.difficulty] = 1; });
  var seen = {}; DB.attempts.forEach(function (a) { seen[a.qid] = 1; });
  return BANK.filter(function (q) { return !seen[q.id] && sigs[q.type + '|' + q.difficulty]; }).map(function (q) { return q.id; });
}
function modeFooter() {
  return '<div class="card-label" style="margin-top:16px">Mode</div><div class="opt-grid">' +
    '<button class="opt mode on" data-m="untimed"><span>Untimed</span></button>' +
    '<button class="opt mode" data-m="timed"><span>Timed</span></button>' +
    '<button class="opt mode" data-m="openbook"><span>Open book</span></button></div>' +
    '<div class="field"><label>Questions this session</label><input id="mfLen" type="number" value="' + DEFAULT_LEN + '" min="1" max="100"></div>' +
    '<div style="display:flex;gap:10px"><button class="btn ghost small" style="flex:1" data-x="cancel">Cancel</button>' +
    '<button class="btn small" style="flex:2" data-x="start">Begin</button></div>';
}
function wireModeFooter(m, cb) {
  var mode = 'untimed';
  m.querySelectorAll('.opt.mode').forEach(function (o) {
    o.onclick = function () {
      m.querySelectorAll('.opt.mode').forEach(function (x) { x.classList.remove('on'); });
      o.classList.add('on'); mode = o.dataset.m;
    };
  });
  m.querySelector('[data-x=cancel]').onclick = closeModal;
  m.querySelector('[data-x=start]').onclick = function () {
    var n = parseInt(m.querySelector('#mfLen').value, 10);
    SESSION_LEN = isNaN(n) ? DEFAULT_LEN : Math.max(1, Math.min(100, n));
    cb(mode);
  };
}

/* ============================================================
   PRACTICE ENGINE
   ============================================================ */
var SESSION_LEN = DEFAULT_LEN;
var S = null;   // live session state

function startSession(opts) {
  if (!BANK.length) { toast('No questions loaded'); return; }
  var pool;
  if (opts.ids) {
    pool = opts.ids.map(function (id) { return BY_ID[id]; }).filter(Boolean);
    if (!opts.ordered) pool = shuffle(pool);
  } else {
    pool = BANK.filter(opts.filter || function () { return true; });
    // prefer unseen
    var seen = {}; DB.attempts.forEach(function (a) { seen[a.qid] = 1; });
    var fresh = pool.filter(function (q) { return !seen[q.id]; });
    pool = shuffle(fresh.length >= SESSION_LEN ? fresh : pool);
  }
  if (!pool.length) { toast('No questions match that'); return; }
  pool = pool.slice(0, SESSION_LEN);

  S = {
    id: uid('s'),
    mode: opts.mode || 'untimed',
    label: opts.label || 'Mixed',
    startedAt: Date.now(),
    queue: pool,
    i: 0,
    answers: pool.map(function () {
      return { selected: null, struck: [], submitted: false, seconds: 0, flagged: false, flagReason: null, collections: [] };
    }),
    qStart: Date.now()
  };
  $('practice').classList.remove('hidden');
  $('modeBadge').textContent = { timed: 'Timed', untimed: 'Untimed', openbook: 'Open book' }[S.mode];
  $('qLabel').textContent = '· ' + S.label;
  setOpenBook(S.mode === 'openbook');
  $('obBtn').classList.toggle('hidden', S.mode !== 'openbook');
  startTimer();
  paintQuestion();
}

var timerHandle = null;
function startTimer() {
  clearInterval(timerHandle);
  timerHandle = setInterval(function () {
    if (!S) return;
    var el2 = $('timer');
    if (S.mode === 'timed') el2.textContent = mmss((Date.now() - S.startedAt) / 1000);
    else el2.textContent = '—';
  }, 500);
}
function stopTimer() { clearInterval(timerHandle); timerHandle = null; }

function cur() { return { q: S.queue[S.i], a: S.answers[S.i] }; }

function paintQuestion() {
  var c = cur(), q = c.q, a = c.a;
  S.qStart = Date.now() - (a.seconds * 1000);

  $('qCounter').textContent = 'Question ' + (S.i + 1) + ' of ' + S.queue.length;
  $('progFill').style.width = ((S.i) / S.queue.length * 100) + '%';
  $('qMeta').textContent = q.domain + ' · ' + q.type + ' · ' + { E: 'Easy', M: 'Medium', H: 'Hard' }[q.difficulty];
  $('qPassage').innerHTML = q.passage;
  if (q.image && !/<img/i.test(q.passage)) {
    $('qPassage').innerHTML += '<img src="' + esc(q.image) + '" alt="">';
  }
  $('qStem').textContent = q.prompt;

  $('qChoices').innerHTML = q.choices.map(function (ch, i) {
    return '<button class="choice" data-i="' + i + '"><span class="letter">' + LETTERS[i] + '</span><span>' + ch + '</span></button>';
  }).join('');
  Array.prototype.forEach.call($('qChoices').children, function (btn) {
    btn.onclick = function (e) {
      var i = +btn.dataset.i;
      if (e.altKey) { toggleStrike(i); return; }
      if (a.submitted && S.mode !== 'timed') return;
      a.selected = i; paintChoiceState();
    };
  });
  paintChoiceState();

  $('flagBtn').classList.toggle('on', !!a.flagged);
  $('sessMeta').textContent = sessionMetaText();
  $('pPrev').disabled = S.i === 0;

  // feedback state
  if (a.submitted && S.mode !== 'timed') showFeedback(); else hideFeedback();
  $('pMain').textContent = (a.submitted || S.mode === 'timed')
    ? (S.i === S.queue.length - 1 ? 'Finish session' : 'Next question')
    : 'Submit';

  if (S.mode === 'openbook') paintOpenBook(q.type);
}
function sessionMetaText() {
  var done = S.answers.filter(function (a) { return a.submitted; }).length;
  var right = S.answers.filter(function (a, i) { return a.submitted && a.selected === S.queue[i].answer; }).length;
  var fl = S.answers.filter(function (a) { return a.flagged; }).length;
  return 'Session ' + (S.i + 1) + '/' + S.queue.length + ' · ' + done + ' answered' +
    (S.mode === 'timed' ? '' : ' · ' + right + ' correct') + ' · ' + fl + ' flagged';
}
function paintChoiceState() {
  var c = cur(), q = c.q, a = c.a;
  Array.prototype.forEach.call($('qChoices').children, function (btn) {
    var i = +btn.dataset.i;
    btn.className = 'choice';
    if (a.struck.indexOf(i) > -1) btn.classList.add('struck');
    if (a.submitted && S.mode !== 'timed') {
      if (i === q.answer) btn.classList.add('right');
      else if (i === a.selected) btn.classList.add('wrong');
    } else if (a.selected === i) btn.classList.add('picked');
  });
}
function toggleStrike(i) {
  var a = cur().a, k = a.struck.indexOf(i);
  if (k > -1) a.struck.splice(k, 1); else a.struck.push(i);
  paintChoiceState();
}
function hideFeedback() { $('drawer').classList.add('hidden'); }
function showFeedback() {
  var c = cur(), q = c.q, a = c.a;
  var ok = a.selected === q.answer;
  $('drawer').classList.remove('hidden');
  $('resultTag').textContent = ok ? 'Correct' : 'Incorrect';
  $('resultTag').className = 'result-tag' + (ok ? ' ok' : '');
  $('resultMeta').textContent = 'You chose ' + (a.selected == null ? '—' : LETTERS[a.selected]) +
    ' · Correct answer ' + LETTERS[q.answer] + ' · ' + mmss(a.seconds);
  var html = '<div>' + (q.rationale || 'No explanation in the bank for this item.') + '</div>';
  var wn = q.whyNot.filter(Boolean);
  if (wn.length) {
    html += '<h4>Why the others fail</h4>' + q.whyNot.map(function (t, i) {
      return t ? '<div class="whynot"><b>' + LETTERS[i] + '</b> — ' + t + '</div>' : '';
    }).join('');
  }
  $('explain').innerHTML = html;
  paintFlagReasons();
}
function paintFlagReasons() {
  var a = cur().a;
  document.querySelectorAll('#flagReasons .fr').forEach(function (b) {
    b.classList.toggle('on', a.flagReason === b.dataset.fr);
  });
}
document.querySelectorAll('#flagReasons .fr').forEach(function (b) {
  b.addEventListener('click', function () {
    var a = cur().a;
    a.flagReason = (a.flagReason === b.dataset.fr) ? null : b.dataset.fr;
    if (a.flagReason) a.flagged = true;
    $('flagBtn').classList.toggle('on', !!a.flagged);
    paintFlagReasons();
    persistAttempt(S.i);
  });
});

function submitCurrent() {
  var c = cur(), a = c.a;
  if (a.selected == null) { toast('Pick an answer first'); return; }
  a.seconds = Math.round((Date.now() - S.qStart) / 1000);
  a.submitted = true;
  if (S.mode === 'timed' && a.seconds > PACE_TARGET * SLOW_FACTOR) a.flagged = true;
  persistAttempt(S.i);
  if (S.mode === 'timed') { advance(); }
  else { showFeedback(); $('pMain').textContent = S.i === S.queue.length - 1 ? 'Finish session' : 'Next question'; }
  $('sessMeta').textContent = sessionMetaText();
  paintChoiceState();
}
function persistAttempt(idx) {
  var q = S.queue[idx], a = S.answers[idx];
  if (!a.submitted) return;
  var existing = DB.attempts.filter(function (x) { return x.sessionId === S.id && x.qid === q.id; })[0];
  var row = existing || {
    id: uid('a'), qid: q.id, sessionId: S.id, mode: S.mode, type: q.type,
    domain: q.domain, difficulty: q.difficulty, ts: Date.now()
  };
  row.selected = a.selected == null ? null : LETTERS[a.selected];
  row.correct = a.selected === q.answer;
  row.seconds = a.seconds;
  row.flagged = !!a.flagged;
  row.flagReason = a.flagReason;
  row.collections = a.collections.slice();
  if (!existing) DB.attempts.push(row);
  save('attempts');
  if (!row.correct) addToCollection('redemption', q.id, true);
}
function advance() {
  // in timed mode an answer can still be changed after submitting, so re-save first
  if (S.mode === 'timed' && S.answers[S.i].submitted) persistAttempt(S.i);
  if (S.i === S.queue.length - 1) { finishSession(); return; }
  S.i++; paintQuestion();
}
$('pMain').addEventListener('click', function () {
  var a = cur().a;
  if (!a.submitted) submitCurrent();
  else advance();
});
$('pPrev').addEventListener('click', function () { if (S.i > 0) { S.i--; paintQuestion(); } });
$('flagBtn').addEventListener('click', function () {
  var a = cur().a; a.flagged = !a.flagged;
  $('flagBtn').classList.toggle('on', a.flagged);
  persistAttempt(S.i);
  $('sessMeta').textContent = sessionMetaText();
});
$('saveBtn').addEventListener('click', function () { openCollectionSheet(cur().q.id); });
$('obBtn').addEventListener('click', function () { setOpenBook($('openbook').classList.contains('hidden')); });
function setOpenBook(on) {
  $('openbook').classList.toggle('hidden', !on);
  $('qBody').classList.toggle('ob', !!on);
}
$('pExit').addEventListener('click', function () {
  if (S && S.answers.some(function (a) { return a.submitted; })) {
    if (!confirm('Exit? Answered questions are already saved; the rest are dropped.')) return;
    finishSession();
  } else { closePractice(); }
});
function closePractice() {
  stopTimer(); S = null;
  $('practice').classList.add('hidden');
  renderAll(); paintChrome();
}
function finishSession() {
  var answered = S.answers.filter(function (a) { return a.submitted; }).length;
  if (answered) {
    var right = S.answers.filter(function (a, i) { return a.submitted && a.selected === S.queue[i].answer; }).length;
    DB.sessions.push({
      id: S.id, mode: S.mode, label: S.label, startedAt: S.startedAt, endedAt: Date.now(),
      count: answered, correct: right
    });
    save('sessions');
    showSummary(S, right, answered);
  }
  stopTimer();
  $('practice').classList.add('hidden');
  S = null;
  renderAll(); paintChrome();
}

/* keyboard */
document.addEventListener('keydown', function (e) {
  if (!S || $('practice').classList.contains('hidden')) return;
  if (/input|textarea|select/i.test(e.target.tagName)) return;
  var k = e.key.toUpperCase();
  var idx = LETTERS.indexOf(k);
  if (idx === -1 && k >= '1' && k <= '4') idx = +k - 1;
  if (idx > -1) {
    e.preventDefault();
    if (e.altKey) toggleStrike(idx);
    else { var a = cur().a; if (!(a.submitted && S.mode !== 'timed')) { a.selected = idx; paintChoiceState(); } }
    return;
  }
  if (e.key === 'Enter') { e.preventDefault(); $('pMain').click(); }
  else if (k === 'F') { e.preventDefault(); $('flagBtn').click(); }
  else if (k === 'S') { e.preventDefault(); $('saveBtn').click(); }
  else if (e.key === 'Escape') { $('pExit').click(); }
});

/* ---------- summary ---------- */
function showSummary(sess, right, answered) {
  var att = DB.attempts.filter(function (a) { return a.sessionId === sess.id; });
  var avg = att.reduce(function (x, a) { return x + (a.seconds || 0); }, 0) / Math.max(1, att.length);
  var byType = {};
  att.forEach(function (a) {
    byType[a.type] = byType[a.type] || { n: 0, c: 0 };
    byType[a.type].n++; if (a.correct) byType[a.type].c++;
  });
  var worst = Object.keys(byType).sort(function (x, y) {
    return (byType[x].c / byType[x].n) - (byType[y].c / byType[y].n);
  })[0];

  $('sumWrap').innerHTML =
    '<div class="sum-hero"><div class="big">' + pct(right, answered) + '%</div>' +
    '<h2>' + right + ' of ' + answered + '</h2>' +
    '<p>' + esc(sess.label) + ' · ' + esc(sess.mode) + ' · ' + mmss(avg) + ' average per question</p></div>' +
    '<div class="tbl-wrap"><table class="grid"><thead><tr><th>Question type</th><th class="numh">Correct</th><th class="numh">Attempted</th><th class="numh">Rate</th></tr></thead><tbody>' +
    Object.keys(byType).map(function (t) {
      var b = byType[t];
      return '<tr><td>' + esc(t) + '</td><td class="num">' + b.c + '</td><td class="num">' + b.n + '</td>' +
        '<td class="num ' + (pct(b.c, b.n) >= 70 ? 'cell-good' : 'cell-bad') + '">' + pct(b.c, b.n) + '</td></tr>';
    }).join('') + '</tbody></table></div>' +
    (worst ? '<p style="color:var(--text-on-ink-soft);font-size:13.5px;line-height:1.6">Weakest this session: <b style="color:var(--brass)">' + esc(worst) + '</b>. Everything you missed is already sitting in Redemption.</p>' : '') +
    '<div style="display:flex;gap:12px;margin-top:22px;flex-wrap:wrap">' +
    '<button class="btn" id="sumAgain">Run it again</button>' +
    '<button class="btn ghost-dark" id="sumRedeem">Grind Redemption</button>' +
    '<button class="btn ghost-dark" id="sumClose">Back to dashboard</button></div>';

  $('summary').classList.remove('hidden');
  $('sumClose').onclick = function () { $('summary').classList.add('hidden'); go('dashboard'); };
  $('sumAgain').onclick = function () {
    $('summary').classList.add('hidden');
    startSession({ mode: sess.mode, label: sess.label });
  };
  $('sumRedeem').onclick = function () {
    $('summary').classList.add('hidden');
    var ids = missedIds();
    if (!ids.length) { toast('Redemption is empty — good problem'); return; }
    startSession({ mode: 'untimed', label: 'Redemption', ids: ids });
  };
}

/* ---------- open book ---------- */
function paintOpenBook(type) {
  var notes = DB.notes.filter(function (n) { return n.tag === type || n.tag === 'General'; });
  $('obSub').textContent = 'Filtered to ' + type + ', plus general notes.';
  $('obList').innerHTML = notes.length
    ? notes.map(function (n) {
        return '<div class="ob-note"><div class="m">' + esc(n.tag) + '</div>' + esc(n.text) + '</div>';
      }).join('')
    : '<div class="ob-note" style="color:var(--text-on-ink-soft)">No notes yet. Toolbox → Personal notes.</div>';
}

/* ============================================================
   COLLECTIONS
   ============================================================ */
function addToCollection(cid, qid, silent) {
  var c = DB.collections.filter(function (x) { return x.id === cid; })[0];
  if (!c) return;
  if (c.qids.indexOf(qid) === -1) { c.qids.push(qid); save('collections'); if (!silent) toast('Saved to ' + c.name); }
}
function removeFromCollection(cid, qid) {
  var c = DB.collections.filter(function (x) { return x.id === cid; })[0];
  if (!c) return;
  var i = c.qids.indexOf(qid);
  if (i > -1) { c.qids.splice(i, 1); save('collections'); }
}
function openCollectionSheet(qid) {
  function body() {
    return '<h3>Save to collection</h3><p class="sh-sub">Pick any number. Targeted practice draws from what you select.</p>' +
      DB.collections.map(function (c) {
        var on = c.qids.indexOf(qid) > -1;
        return '<div class="coll' + (on ? ' on' : '') + '" data-c="' + c.id + '"><span><span class="cname">' + esc(c.name) + '</span><br>' +
          '<span class="cmeta">' + c.qids.length + ' questions' + (c.builtin ? ' · auto-fills on every miss' : '') + '</span></span>' +
          '<span class="tick"></span></div>';
      }).join('') +
      '<div class="field" style="margin-top:12px"><label>New collection</label><input id="newColl" placeholder="e.g. Transitions drill"></div>' +
      '<div style="display:flex;gap:10px"><button class="btn ghost small" style="flex:1" data-x="close">Done</button>' +
      '<button class="btn small" style="flex:1" data-x="create">Create &amp; add</button></div>';
  }
  modal(body(), function mount(m) {
    m.querySelectorAll('.coll').forEach(function (row) {
      row.onclick = function () {
        var cid = row.dataset.c;
        if (row.classList.contains('on')) { removeFromCollection(cid, qid); row.classList.remove('on'); }
        else { addToCollection(cid, qid); row.classList.add('on'); }
        if (S) {
          var a = cur().a;
          a.collections = DB.collections.filter(function (c) { return c.qids.indexOf(qid) > -1; }).map(function (c) { return c.id; });
          persistAttempt(S.i);
        }
      };
    });
    m.querySelector('[data-x=close]').onclick = function () { closeModal(); RENDER.sets(); };
    m.querySelector('[data-x=create]').onclick = function () {
      var name = m.querySelector('#newColl').value.trim();
      if (!name) { toast('Name it first'); return; }
      var c = { id: uid('c'), name: name, builtin: false, qids: [qid], createdAt: Date.now() };
      DB.collections.push(c); save('collections');
      modal(body(), mount);
      toast('Created ' + name);
    };
  });
}

RENDER.sets = function () {
  $('setsSub').textContent = DB.collections.length + ' collections · ' +
    DB.collections.reduce(function (a, c) { return a + c.qids.length; }, 0) + ' saved questions';
  $('setGrid').innerHTML = DB.collections.map(function (c) {
    var seen = {}; DB.attempts.forEach(function (a) { seen[a.qid] = a.correct; });
    var done = c.qids.filter(function (q) { return seen[q]; }).length;
    var right = c.qids.filter(function (q) { return seen[q] === true; }).length;
    return '<div class="set-card' + (c.builtin ? ' builtin' : '') + '">' +
      '<div class="s-top"><span class="s-name">' + esc(c.name) + '</span>' +
      '<svg class="bookmark-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
      '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/><path d="M12 7v6M9 10h6"/></svg></div>' +
      '<div class="s-meta">' + c.qids.length + ' questions · ' + done + ' attempted · ' +
      (done ? pct(right, done) + '% right' : 'untouched') + '</div>' +
      '<div class="s-bar"><i style="width:' + (c.qids.length ? (done / c.qids.length * 100) : 0) + '%"></i></div>' +
      '<div class="s-actions">' +
      '<button class="btn tiny" data-run="' + c.id + '">Practice</button>' +
      '<button class="btn tiny ghost" data-view="' + c.id + '">View</button>' +
      (c.builtin ? '' : '<button class="btn tiny ghost" data-ren="' + c.id + '">Rename</button>' +
        '<button class="btn tiny danger" data-del="' + c.id + '">Delete</button>') +
      '</div></div>';
  }).join('') || '<div class="empty"><b>No collections yet</b>Hit the bookmark on any question to start one.</div>';

  $('setGrid').querySelectorAll('[data-run]').forEach(function (b) {
    b.onclick = function () {
      var c = DB.collections.filter(function (x) { return x.id === b.dataset.run; })[0];
      if (!c || !c.qids.length) { toast('That collection is empty'); return; }
      SESSION_LEN = Math.max(1, c.qids.length);
      startSession({ mode: 'untimed', label: c.name, ids: c.qids });
    };
  });
  $('setGrid').querySelectorAll('[data-view]').forEach(function (b) {
    b.onclick = function () { showSetDetail(b.dataset.view); };
  });
  $('setGrid').querySelectorAll('[data-ren]').forEach(function (b) {
    b.onclick = function () {
      var c = DB.collections.filter(function (x) { return x.id === b.dataset.ren; })[0];
      var n = prompt('Rename collection', c.name);
      if (n && n.trim()) { c.name = n.trim(); save('collections'); RENDER.sets(); }
    };
  });
  $('setGrid').querySelectorAll('[data-del]').forEach(function (b) {
    b.onclick = function () {
      if (!confirm('Delete this collection? The questions stay in the bank.')) return;
      DB.collections = DB.collections.filter(function (x) { return x.id !== b.dataset.del; });
      save('collections'); $('setDetail').innerHTML = ''; RENDER.sets();
    };
  });
};

function showSetDetail(cid) {
  var c = DB.collections.filter(function (x) { return x.id === cid; })[0];
  if (!c) return;
  var last = {};
  DB.attempts.forEach(function (a) { last[a.qid] = a; });
  $('setDetail').innerHTML =
    '<h2 class="sec">' + esc(c.name) + '</h2><p class="sec-sub">' + c.qids.length + ' questions</p>' +
    (c.qids.length ? '<div class="tbl-wrap"><table class="grid"><thead><tr><th>ID</th><th>Question type</th><th>Diff</th><th>Last result</th><th>Time</th><th></th></tr></thead><tbody>' +
      c.qids.map(function (qid) {
        var q = BY_ID[qid], a = last[qid];
        return '<tr><td class="mono">' + esc(qid) + '</td><td>' + esc(q ? q.type : '—') + '</td>' +
          '<td class="mono">' + (q ? q.difficulty : '—') + '</td>' +
          '<td>' + (a ? (a.correct ? '<span class="cell-good">Right</span>' : '<span class="cell-bad">Wrong</span>') : '<span class="muted">unseen</span>') + '</td>' +
          '<td class="mono">' + (a && a.seconds ? mmss(a.seconds) : '—') + '</td>' +
          '<td><button class="btn tiny ghost" data-rm="' + esc(qid) + '">Remove</button></td></tr>';
      }).join('') + '</tbody></table></div>'
      : '<div class="empty"><b>Empty</b>Save questions into it from the practice screen.</div>');
  $('setDetail').querySelectorAll('[data-rm]').forEach(function (b) {
    b.onclick = function () { removeFromCollection(cid, b.dataset.rm); showSetDetail(cid); RENDER.sets(); };
  });
  if ($('setDetail').scrollIntoView) $('setDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('btnNewSet').addEventListener('click', function () {
  var n = prompt('Collection name');
  if (n && n.trim()) {
    DB.collections.push({ id: uid('c'), name: n.trim(), builtin: false, qids: [], createdAt: Date.now() });
    save('collections'); RENDER.sets();
  }
});

/* ============================================================
   ANALYTICS
   ============================================================ */
RENDER.analytics = function () {
  var w = windows(null);
  $('anStats').innerHTML = ['L10', 'L20', 'L50', 'OVR'].map(function (k) {
    var v = w[k];
    var delta = (v && w.OVR && k !== 'OVR') ? v.pct - w.OVR.pct : null;
    return '<div class="stat"><div class="n">' + (v ? v.pct + '%' : '—') + '</div>' +
      '<div class="l">' + k + ' · ' + (v ? v.n + ' attempts' : 'no data') + '</div>' +
      '<div class="d ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : '') + '">' +
      (delta == null ? (k === 'OVR' ? 'baseline' : '—') : delta === 0 ? 'level with OVR' : (delta > 0 ? '+' : '') + delta + ' vs OVR') + '</div></div>';
  }).join('');

  // chart
  var series = sessionSeries();
  if (series.length < 2) {
    $('anChart').innerHTML = '<div class="empty"><b>Not enough sessions</b>The rolling line needs at least two finished sessions.</div>';
  } else {
    var W = 900, H = 220, L = 40, R = 880, T = 20, B = 190;
    var pts = series.map(function (s, i) {
      var x = L + (i / Math.max(1, series.length - 1)) * (R - L);
      var y = B - ((s.pct - 40) / 60) * (B - T);
      return { x: Math.max(L, Math.min(R, x)), y: Math.max(T, Math.min(B, y)), pct: s.pct };
    });
    var ovrY = B - ((w.OVR.pct - 40) / 60) * (B - T);
    $('anChart').innerHTML =
      '<svg viewBox="0 0 900 220" style="width:100%;height:210px">' +
      '<g stroke="#D8CCA9"><line x1="40" y1="20" x2="880" y2="20"/><line x1="40" y1="62" x2="880" y2="62"/>' +
      '<line x1="40" y1="105" x2="880" y2="105"/><line x1="40" y1="148" x2="880" y2="148"/><line x1="40" y1="190" x2="880" y2="190"/></g>' +
      '<g font-family="IBM Plex Mono, monospace" font-size="10" fill="#5B5847">' +
      '<text x="8" y="24">100</text><text x="12" y="66">85</text><text x="12" y="109">70</text><text x="12" y="152">55</text><text x="12" y="194">40</text></g>' +
      '<line x1="40" y1="' + ovrY.toFixed(1) + '" x2="880" y2="' + ovrY.toFixed(1) + '" stroke="#B8894F" stroke-width="1.5" stroke-dasharray="5 5"/>' +
      '<text x="800" y="' + (ovrY - 6).toFixed(1) + '" font-family="IBM Plex Mono, monospace" font-size="10" fill="#B8894F">OVR ' + w.OVR.pct + '%</text>' +
      '<polyline fill="none" stroke="#335745" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" points="' +
      pts.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ') + '"/>' +
      pts.map(function (p, i) {
        return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' +
          (i === pts.length - 1 ? 5.5 : 3.5) + '" fill="' + (i === pts.length - 1 ? '#A6452A' : '#335745') + '"><title>' + p.pct + '%</title></circle>';
      }).join('') + '</svg>';
  }

  // per type table
  var rows = '';
  DOMAINS.forEach(function (d) {
    rows += '<tr class="dom-head"><td colspan="7">' + esc(d.name) + '</td></tr>';
    d.types.forEach(function (t) {
      var tw = windows(t);
      if (!tw.OVR) {
        rows += '<tr><td>' + esc(t) + '</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">0</td><td class="trend muted">no data</td></tr>';
        return;
      }
      var delta = tw.L10 ? tw.L10.pct - tw.OVR.pct : null;
      function cell(v) {
        if (!v) return '<td class="num">—</td>';
        var cls = v.pct >= 80 ? 'cell-good' : v.pct < 55 ? 'cell-bad' : '';
        return '<td class="num ' + cls + '">' + v.pct + '</td>';
      }
      rows += '<tr><td>' + esc(t) + '</td>' + cell(tw.L10) + cell(tw.L20) + cell(tw.L50) + cell(tw.OVR) +
        '<td class="num">' + tw.OVR.n + '</td><td class="trend ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : '') + '">' +
        (delta == null ? '—' : (delta > 0 ? '▲ +' : delta < 0 ? '▼ ' : '– ') + delta) + '</td></tr>';
    });
  });
  $('anTypes').innerHTML = '<table class="grid"><thead><tr><th>Question type</th><th class="numh">L10</th>' +
    '<th class="numh">L20</th><th class="numh">L50</th><th class="numh">OVR</th><th class="numh">Seen</th><th>L10 vs OVR</th></tr></thead><tbody>' +
    rows + '</tbody></table>';

  // pace
  var pace = paceByType();
  $('anPace').innerHTML = pace.length ? pace.map(function (p) {
    var slow = p.avg > PACE_TARGET;
    return '<div class="slowrow"><span>' + esc(p.type) + '</span><span class="t ' + (slow ? 'warn' : '') + '">' +
      mmss(p.avg) + ' <span style="opacity:.6">/ ' + mmss(PACE_TARGET) + '</span></span></div>';
  }).join('') : '<div class="empty"><b>No timed data</b>Pace is only logged in Timed mode.</div>';

  var slow = slowAttempts();
  $('anSlow').innerHTML = (slow.length ? slow.map(function (a) {
    return '<div class="slowrow"><span class="t">' + esc(a.qid) + '</span><span>' + mmss(a.seconds) + ' · ' + esc(a.type) + '</span></div>';
  }).join('') : '<div class="empty"><b>Nothing over pace</b>Or nothing timed yet.</div>') +
  '<p style="font-size:12px;color:var(--text-on-paper-soft);line-height:1.55;margin:14px 0 0">' +
  'Anything over 2× the pace target gets flagged automatically, right or wrong. Slow and correct is still a leak.</p>';
};

/* ============================================================
   HISTORY
   ============================================================ */
RENDER.history = function () {
  var list = $('histList');
  if (!DB.sessions.length) {
    list.innerHTML = '<div class="empty"><b>No sessions yet</b>Finish one set and it shows up here with every question you solved.</div>';
    return;
  }
  list.innerHTML = DB.sessions.slice().reverse().map(function (s) {
    var att = DB.attempts.filter(function (a) { return a.sessionId === s.id; });
    var secs = att.reduce(function (x, a) { return x + (a.seconds || 0); }, 0);
    return '<div class="sess" data-s="' + s.id + '">' +
      '<div class="sess-head"><div class="sh-l"><span class="sh-title">' + esc(s.label) + '</span>' +
      '<span class="sh-meta">' + fmtDateTime(s.startedAt) + ' · ' + esc(s.mode) + ' · ' + s.count + ' questions · ' + mmss(secs) + ' total</span></div>' +
      '<div class="sh-r"><span class="sh-score ' + (pct(s.correct, s.count) >= 70 ? 'up' : 'down') + '">' +
      pct(s.correct, s.count) + '%</span><span class="sh-meta">' + s.correct + '/' + s.count + '</span>' +
      '<svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg></div></div>' +
      '<div class="sess-body hidden"><table class="grid"><thead><tr><th>ID</th><th>Question type</th><th>Diff</th>' +
      '<th>Pick</th><th>Result</th><th class="numh">Time</th><th>Error type</th><th>Flag</th></tr></thead><tbody>' +
      att.map(function (a) {
        var q = BY_ID[a.qid];
        return '<tr><td class="mono">' + esc(a.qid) + '</td><td>' + esc(a.type) + '</td>' +
          '<td class="mono">' + esc(a.difficulty || (q ? q.difficulty : '—')) + '</td>' +
          '<td class="mono">' + esc(a.selected || '—') + '</td>' +
          '<td>' + (a.correct ? '<span class="cell-good">Right</span>' : '<span class="cell-bad">Wrong</span>') + '</td>' +
          '<td class="num ' + (a.seconds > PACE_TARGET * SLOW_FACTOR ? 'cell-bad' : '') + '">' + mmss(a.seconds || 0) + '</td>' +
          '<td>' + (a.flagReason ? '<span class="chip o">' + esc(a.flagReason) + '</span>' : '<span class="muted">—</span>') + '</td>' +
          '<td>' + (a.flagged ? '<span class="chip">flagged</span>' : '<span class="muted">—</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }).join('');

  list.querySelectorAll('.sess-head').forEach(function (h) {
    h.onclick = function () {
      var s = h.parentElement;
      s.classList.toggle('open');
      s.querySelector('.sess-body').classList.toggle('hidden');
    };
  });
};

/* ============================================================
   TOOLBOX
   ============================================================ */
$('toolTabs').addEventListener('click', function (e) {
  var b = e.target.closest('button'); if (!b) return;
  document.querySelectorAll('.tool-panel').forEach(function (p) { p.classList.remove('active'); });
  $('tool-' + b.dataset.tool).classList.add('active');
  document.querySelectorAll('#toolTabs button').forEach(function (x) { x.classList.remove('active'); });
  b.classList.add('active');
});

RENDER.toolbox = function () {
  // note tag options
  if (!$('noteTag').options.length) {
    $('noteTag').innerHTML = ['General'].concat(TYPES).map(function (t) {
      return '<option>' + esc(t) + '</option>';
    }).join('');
  }
  // notes
  $('noteList').innerHTML = DB.notes.length ? DB.notes.slice().reverse().map(function (n) {
    return '<div class="note-entry"><div class="n-meta"><span class="chip' + (n.tag === 'General' ? ' v' : '') + '">' + esc(n.tag) + '</span>' +
      '<span>' + fmtDate(n.ts) + '</span><button class="x-btn" data-dn="' + n.id + '" title="Delete">✕</button></div>' +
      '<div class="n-text">' + esc(n.text) + '</div></div>';
  }).join('') : '<div class="empty"><b>No notes yet</b>Anything you write here shows up beside the question in Open book mode.</div>';
  $('noteList').querySelectorAll('[data-dn]').forEach(function (b) {
    b.onclick = function () {
      DB.notes = DB.notes.filter(function (n) { return n.id !== b.dataset.dn; });
      save('notes'); RENDER.toolbox();
    };
  });

  // vocab
  $('vocabGrid').innerHTML = DB.vocab.length ? DB.vocab.slice().reverse().map(function (v) {
    return '<div class="card vocab"><div class="head-row"><div><span class="w">' + esc(v.word) + '</span>' +
      (v.pos ? '<span class="pos">' + esc(v.pos) + '</span>' : '') + '</div>' +
      '<button class="x-btn" data-dv="' + v.id + '" title="Delete">✕</button></div>' +
      (v.def1 ? '<div class="d1">' + esc(v.def1) + '</div>' : '') +
      (v.def2 ? '<div class="d2"><span>Tested sense</span>' + esc(v.def2) + '</div>' : '') +
      (v.note ? '<div class="vn">' + esc(v.note) + '</div>' : '') + '</div>';
  }).join('') : '<div class="empty"><b>No words yet</b>Add the word, the definition you knew, and the sense the test actually used.</div>';
  $('vocabGrid').querySelectorAll('[data-dv]').forEach(function (b) {
    b.onclick = function () {
      DB.vocab = DB.vocab.filter(function (v) { return v.id !== b.dataset.dv; });
      save('vocab'); RENDER.toolbox();
    };
  });

  // error log
  var errs = DB.attempts.filter(function (a) { return !a.correct; }).slice().reverse();
  $('errLog').innerHTML = errs.length ? '<table class="grid"><thead><tr><th>ID</th><th>Question type</th><th>Diff</th>' +
    '<th>Your pick</th><th>Correct</th><th>Error type</th><th class="numh">Time</th><th>Date</th></tr></thead><tbody>' +
    errs.map(function (a) {
      var q = BY_ID[a.qid];
      return '<tr><td class="mono">' + esc(a.qid) + '</td><td>' + esc(a.type) + '</td><td class="mono">' + esc(a.difficulty) + '</td>' +
        '<td class="mono">' + esc(a.selected || '—') + '</td><td class="mono">' + (q ? LETTERS[q.answer] : '—') + '</td>' +
        '<td>' + (a.flagReason ? esc(a.flagReason) : '<span class="muted">untagged</span>') + '</td>' +
        '<td class="num">' + mmss(a.seconds || 0) + '</td><td class="mono">' + fmtDate(a.ts) + '</td></tr>';
    }).join('') + '</tbody></table>'
    : '<div class="empty" style="border:none"><b>Clean sheet</b>Nothing missed yet.</div>';

  // flag log
  var fl = flaggedAttempts().slice().reverse();
  $('flagLog').innerHTML = fl.length ? '<table class="grid"><thead><tr><th>ID</th><th>Question type</th><th>Outcome</th>' +
    '<th>Flag reason</th><th>Collections</th><th>Date</th></tr></thead><tbody>' +
    fl.map(function (a) {
      var cols = DB.collections.filter(function (c) { return c.qids.indexOf(a.qid) > -1; }).map(function (c) { return c.name; });
      return '<tr><td class="mono">' + esc(a.qid) + '</td><td>' + esc(a.type) + '</td>' +
        '<td>' + (a.correct ? '<span class="cell-good">Right</span>' : '<span class="cell-bad">Wrong</span>') + '</td>' +
        '<td>' + (a.flagReason ? esc(a.flagReason) : '<span class="muted">—</span>') + '</td>' +
        '<td class="mono">' + (cols.length ? esc(cols.join(' · ')) : '—') + '</td>' +
        '<td class="mono">' + fmtDate(a.ts) + '</td></tr>';
    }).join('') + '</tbody></table>'
    : '<div class="empty" style="border:none"><b>Nothing flagged</b>Hit F during a session, or tag an error reason.</div>';
};

$('noteAdd').addEventListener('click', function () {
  var t = $('noteText').value.trim();
  if (!t) { toast('Write something first'); return; }
  DB.notes.push({ id: uid('n'), tag: $('noteTag').value, text: t, ts: Date.now() });
  save('notes'); $('noteText').value = ''; RENDER.toolbox(); toast('Note saved');
});
$('noteText').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('noteAdd').click(); });

$('vAdd').addEventListener('click', function () {
  var w = $('vWord').value.trim();
  if (!w) { toast('Word is required'); return; }
  DB.vocab.push({
    id: uid('v'), word: w, pos: $('vPos').value.trim(), def1: $('vDef1').value.trim(),
    def2: $('vDef2').value.trim(), note: $('vNote').value.trim(), ts: Date.now()
  });
  save('vocab');
  ['vWord', 'vPos', 'vDef1', 'vDef2', 'vNote'].forEach(function (id) { $(id).value = ''; });
  RENDER.toolbox(); toast('Added ' + w);
});

/* ============================================================
   EXPORT / RESET
   ============================================================ */
$('btnExport').addEventListener('click', function () {
  var blob = new Blob([JSON.stringify({
    exportedAt: new Date().toISOString(), profile: DB.profile, attempts: DB.attempts,
    sessions: DB.sessions, collections: DB.collections, notes: DB.notes, vocab: DB.vocab
  }, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mortar-pestle-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
});
$('btnWipe').addEventListener('click', function () {
  if (!confirm('Wipe every attempt, session, note and collection on this browser? This cannot be undone.')) return;
  Store.clear(); location.reload();
});

/* ============================================================
   BOOT
   ============================================================ */
loadDB();
loadBank().then(function () {
  if (DB.profile) openApp();
  else $('gate').classList.remove('hidden');
});
})();
