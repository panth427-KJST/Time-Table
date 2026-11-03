/* =====================================================================
   ระบบจัดสอนแทน KJST — Google Apps Script (server)
   ฐานข้อมูล: Google Sheet ที่ผูกกับสคริปต์นี้ (ชีต Settings, Teachers, Timetable, ClassTimetable,
             Duty, Requests, Items, Log, UserMap)
   เข้าสู่ระบบ: ตรวจกับชีต Users ของ e-Score (อ่านอย่างเดียว)
   ทุกการบันทึกทำภายใต้ LockService และตรวจซ้ำด้วย SubEngine ก่อนบันทึก (กันจองครูซ้ำ)
   ===================================================================== */
var TZ = 'Asia/Bangkok';
var SH = { settings: 'Settings', teachers: 'Teachers', tt: 'Timetable', cls: 'ClassTimetable', duty: 'Duty',
  req: 'Requests', items: 'Items', log: 'Log', umap: 'UserMap' };
var HEAD = {
  settings: ['key', 'value', 'note'],
  teachers: ['teacher', 'dept'],
  tt: ['teacher', 'day', 'period', 'code', 'subject', 'class', 'room'],
  cls: ['class', 'day', 'period', 'code', 'subject', 'teachers', 'room'],
  duty: ['teacher', 'day', 'period', 'label'],
  req: ['id', 'type', 'type_label', 'teacher', 'dept', 'arranged_by', 'dates', 'slots', 'reason', 'file_name', 'file_url',
    'status', 'status_label', 'periods_total', 'ack_progress', 'created_at', 'updated_at', 'approved_by', 'approved_at', 'return_note', 'history'],
  items: ['request_id', 'item_id', 'date', 'period', 'time', 'teacher', 'code', 'subject', 'class', 'room', 'method', 'method_label',
    'sub_teacher', 'swap_teacher', 'swap_date', 'swap_period', 'swap_code', 'swap_subject', 'ack', 'ack_at',
    'decline_note', 'decline_at', 'declined_by', 'request_type', 'request_status'],
  log: ['at', 'username', 'name', 'action', 'request_id', 'detail'],
  umap: ['escore_username', 'teacher', 'note']
};
var DEFAULTS = [
  ['SCHOOL_NAME', 'โรงเรียนกาญจนาภิเษกวิทยาลัย สุราษฎร์ธานี', 'ชื่อโรงเรียน'],
  ['TERM_NAME', '2/2569', 'ภาคเรียน/ปีการศึกษา'],
  ['TERM_START', '2026-10-28', 'วันเปิดภาคเรียน (ค.ศ. YYYY-MM-DD)'],
  ['TERM_END', '2027-02-26', 'วันปิดภาคเรียน (ค.ศ. YYYY-MM-DD)'],
  ['MAX_AHEAD', '30', 'จัดล่วงหน้าได้สูงสุด (วัน)'],
  ['LEAD_DAYS', '1', 'ลากิจ/ไปราชการ/ติดภารกิจ ต้องจัดล่วงหน้าอย่างน้อย (วัน)'],
  ['HOLIDAYS', '2026-12-07,2026-12-10,2026-12-31,2027-01-01', 'วันหยุด คั่นด้วยจุลภาค (ค.ศ.)'],
  ['DEPT_HEADS', '{}', 'หัวหน้ากลุ่มสาระฯ JSON {"ชื่อกลุ่มสาระ":"ชื่อครู"} — แก้ได้ในหน้าตั้งค่าของระบบ'],
  ['ACAD_USERS', '', 'ชื่อผู้ใช้ e-Score ของหัวหน้ากลุ่มบริหารงานวิชาการ (คั่นด้วยจุลภาค)'],
  ['ADMIN_USERS', '', 'ชื่อผู้ใช้ e-Score ของผู้ดูแลระบบ (คั่นด้วยจุลภาค)'],
  ['ESCORE_SPREADSHEET_ID', '', 'ID ของ Google Sheet ระบบ e-Score (ส่วนระหว่าง /d/ กับ /edit ใน URL)'],
  ['ESCORE_USERS_SHEET', 'Users', 'ชื่อชีตผู้ใช้ใน e-Score'],
  ['ESCORE_COL_USERNAME', '', 'ชื่อหัวคอลัมน์ username (เว้นว่าง = ตรวจหาอัตโนมัติ)'],
  ['ESCORE_COL_PASSWORD', '', 'ชื่อหัวคอลัมน์ password (เว้นว่าง = ตรวจหาอัตโนมัติ)'],
  ['ESCORE_COL_NAME', '', 'ชื่อหัวคอลัมน์ชื่อ-สกุล (เว้นว่าง = ตรวจหาอัตโนมัติ)'],
  ['ESCORE_COL_EMAIL', '', 'ชื่อหัวคอลัมน์อีเมล (ถ้ามี)'],
  ['ESCORE_HASH', 'auto', 'รูปแบบรหัสผ่านใน e-Score: auto | plain | sha256 | md5'],
  ['NOTIFY_EMAIL', 'off', 'ส่งอีเมลแจ้งเตือน on/off (ต้องมีคอลัมน์อีเมลใน Users)'],
  ['UPLOAD_FOLDER_ID', '', 'โฟลเดอร์ Google Drive เก็บไฟล์แนบ (เว้นว่าง = สร้างอัตโนมัติ)'],
  ['TT_META', '', 'ข้อมูลโครงสร้างตารางสอน (ระบบจัดการเอง)']
];
var EDITABLE = ['SCHOOL_NAME', 'TERM_NAME', 'TERM_START', 'TERM_END', 'MAX_AHEAD', 'LEAD_DAYS', 'HOLIDAYS', 'DEPT_HEADS',
  'ACAD_USERS', 'ADMIN_USERS', 'ESCORE_SPREADSHEET_ID', 'ESCORE_USERS_SHEET', 'ESCORE_COL_USERNAME', 'ESCORE_COL_PASSWORD',
  'ESCORE_COL_NAME', 'ESCORE_COL_EMAIL', 'ESCORE_HASH', 'NOTIFY_EMAIL', 'UPLOAD_FOLDER_ID'];

/* ---------------------------------------------------------------- web */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('ระบบจัดสอนแทน KJST')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ---------------------------------------------------------------- sheet helpers */
function db_() {
  var id = PropertiesService.getScriptProperties().getProperty('DB_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}
function sheet_(key) {
  var ss = db_(), s = ss.getSheetByName(SH[key]);
  if (!s) {
    s = ss.insertSheet(SH[key]);
    s.getRange(1, 1, 1, HEAD[key].length).setValues([HEAD[key]]).setFontWeight('bold');
    s.setFrozenRows(1);
  }
  return s;
}
function cell_(v) {
  if (v instanceof Date) {
    var hasTime = v.getHours() || v.getMinutes() || v.getSeconds();
    return Utilities.formatDate(v, TZ, hasTime ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd');
  }
  return v == null ? '' : String(v);
}
function readRows_(key) {
  var s = db_().getSheetByName(SH[key]);
  if (!s || s.getLastRow() < 2) return [];
  var v = s.getRange(1, 1, s.getLastRow(), Math.max(1, s.getLastColumn())).getValues();
  var h = v[0].map(String);
  return v.slice(1).filter(function (r) { return r.some(function (c) { return c !== '' && c != null; }); })
    .map(function (r) { var o = {}; h.forEach(function (k, i) { o[k] = cell_(r[i]); }); return o; });
}
function writeRows_(key, rows) {
  var s = sheet_(key), h = HEAD[key];
  var values = [h].concat(rows.map(function (o) { return h.map(function (k) { return o[k] == null ? '' : String(o[k]); }); }));
  s.clearContents();
  var rg = s.getRange(1, 1, values.length, h.length);
  rg.setNumberFormat('@');           // เก็บเป็นข้อความ ไม่ให้ Sheets แปลงวันที่เอง
  rg.setValues(values);
  s.getRange(1, 1, 1, h.length).setFontWeight('bold');
}
function now_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }
function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }

/* ---------------------------------------------------------------- settings */
function settings_() {
  var S = {};
  DEFAULTS.forEach(function (d) { S[d[0]] = d[1]; });
  readRows_('settings').forEach(function (r) { if (r.key) S[r.key] = r.value; });
  return S;
}
function saveSettings_(patch) {
  var rows = readRows_('settings'), seen = {};
  rows.forEach(function (r) { if (patch.hasOwnProperty(r.key)) r.value = patch[r.key]; seen[r.key] = 1; });
  DEFAULTS.forEach(function (d) { if (!seen[d[0]]) rows.push({ key: d[0], value: patch.hasOwnProperty(d[0]) ? patch[d[0]] : d[1], note: d[2] }); });
  writeRows_('settings', rows);
}
function list_(s) { return String(s || '').split(/[,\s]+/).map(function (x) { return x.trim(); }).filter(String); }
function json_(s, dflt) { try { return s ? JSON.parse(s) : dflt; } catch (e) { return dflt; } }
function engineSettings_(S) {
  return { termStart: S.TERM_START, termEnd: S.TERM_END, maxAhead: Math.max(0, parseInt(S.MAX_AHEAD, 10) || 30),
    leadDays: Math.max(0, parseInt(S.LEAD_DAYS, 10) || 0), holidays: list_(S.HOLIDAYS) };
}

/* ---------------------------------------------------------------- timetable */
function loadTimetable_(S) {
  var meta = json_(S.TT_META, null);
  if (!meta) throw new Error('ยังไม่ได้นำเข้าตารางสอน — ให้ผู้ดูแลรันฟังก์ชัน setup()');
  var teachers = readRows_('teachers');
  var D = { days: meta.days, times: meta.times, groups: meta.groups, noCover: meta.noCover, activity: meta.activity || [],
    lunch: meta.lunch || {}, classes: meta.classes, source: meta.source, importedAt: meta.importedAt,
    teachers: [], ts: [], cs: {}, duty: {} };
  var byName = {};
  teachers.forEach(function (t) {
    var g = D.groups.indexOf(t.dept);
    byName[t.teacher] = D.teachers.length;
    D.teachers.push({ n: t.teacher, g: g < 0 ? D.groups.length - 1 : g });
    D.ts.push([]);
  });
  readRows_('tt').forEach(function (r) {
    var ti = byName[r.teacher]; if (ti == null) return;
    D.ts[ti].push([+r.day, +r.period, r.code, r.subject, r['class'], r.room]);
  });
  D.classes.forEach(function (c) { D.cs[c] = []; });
  readRows_('cls').forEach(function (r) {
    if (!D.cs[r['class']]) D.cs[r['class']] = [];
    var tis = String(r.teachers || '').split(';').map(function (x) { return byName[x.trim()]; }).filter(function (x) { return x != null; });
    D.cs[r['class']].push([+r.day, +r.period, r.code, r.subject, tis, r.room]);
  });
  readRows_('duty').forEach(function (r) {
    var ti = byName[r.teacher]; if (ti == null) return;
    (D.duty[ti] = D.duty[ti] || []).push([+r.day, +r.period, r.label]);
  });
  return D;
}
function tiOf_(D, name) {
  if (name === '' || name == null) return null;
  var X = SubEngine.index(D);
  if (X.byName[name] == null) {          // ครูที่ไม่อยู่ในตารางปัจจุบันแล้ว (เช่น ย้าย) — คงประวัติไว้
    D.teachers.push({ n: name, g: D.groups.length - 1 }); D.ts.push([]);
    delete D.__idx; X = SubEngine.index(D);
  }
  return X.byName[name];
}
function importTimetable_(D) {
  if (!D || !D.teachers || !D.ts || !D.groups || !D.days || !D.times) throw new Error('รูปแบบข้อมูลตารางสอนไม่ถูกต้อง');
  var tName = function (i) { return D.teachers[i].n; };
  writeRows_('teachers', D.teachers.map(function (t) { return { teacher: t.n, dept: D.groups[t.g] }; }));
  var tt = [];
  D.ts.forEach(function (rows, ti) { rows.forEach(function (r) {
    tt.push({ teacher: tName(ti), day: r[0], period: r[1], code: r[2], subject: r[3], 'class': r[4], room: r[5] }); }); });
  writeRows_('tt', tt);
  var cs = [];
  Object.keys(D.cs || {}).forEach(function (c) { D.cs[c].forEach(function (r) {
    cs.push({ 'class': c, day: r[0], period: r[1], code: r[2], subject: r[3], teachers: r[4].map(tName).join('; '), room: r[5] }); }); });
  writeRows_('cls', cs);
  var du = [];
  Object.keys(D.duty || {}).forEach(function (ti) { D.duty[ti].forEach(function (r) {
    du.push({ teacher: tName(+ti), day: r[0], period: r[1], label: r[2] }); }); });
  writeRows_('duty', du);
  var meta = { days: D.days, times: D.times, groups: D.groups, noCover: D.noCover || ['HR', 'MEET', 'PLC', 'ประชุม'],
    activity: D.activity || ['ชุมนุม', 'ลูกเสือ'], lunch: D.lunch || {}, classes: D.classes || Object.keys(D.cs || {}),
    source: D.source || '', importedAt: now_() };
  saveSettings_({ TT_META: JSON.stringify(meta) });
  return { teachers: D.teachers.length, slots: tt.length, classSlots: cs.length };
}

/* ---------------------------------------------------------------- requests ⇄ sheet */
function loadRequests_(D) {
  var items = {};
  readRows_('items').forEach(function (x) {
    var it = { id: x.item_id, date: x.date, p: +x.period, code: x.code, subj: x.subject, cls: x['class'], room: x.room,
      method: x.method || null, ack: x.ack || null };
    if (it.method === 'sub') it.sub = tiOf_(D, x.sub_teacher);
    if (it.method === 'swapT') it.swap = { t: tiOf_(D, x.swap_teacher), date: x.swap_date, p: +x.swap_period, code: x.swap_code, subj: x.swap_subject };
    if (it.method === 'swapF') it.swap = { date: x.swap_date, p: +x.swap_period };
    if (x.ack_at) it.ackAt = x.ack_at;
    if (x.decline_note) { it.declNote = x.decline_note; it.declAt = x.decline_at; }
    if (x.declined_by) it.declinedBy = x.declined_by.split(';').map(function (s) { return s.trim(); })
      .filter(String).map(function (n) { return tiOf_(D, n); });
    (items[x.request_id] = items[x.request_id] || []).push(it);
  });
  return readRows_('req').map(function (r) {
    var ab = r.arranged_by, abTi = SubEngine.index(D).byName[ab];
    return { id: r.id, type: r.type, teacher: tiOf_(D, r.teacher), arrangedBy: abTi == null ? null : abTi, arrangedByName: ab,
      dates: list_(r.dates), slots: json_(r.slots, null), reason: r.reason,
      file: r.file_name ? { name: r.file_name, url: r.file_url } : null, status: r.status || 'open',
      createdAt: r.created_at, updatedAt: r.updated_at, approvedBy: r.approved_by, approvedAt: r.approved_at,
      returnNote: r.return_note, history: json_(r.history, []), items: items[r.id] || [] };
  });
}
function saveRequests_(c) {
  var D = c.D, E = c.E, n = function (ti) { return ti == null || !D.teachers[ti] ? '' : D.teachers[ti].n; };
  var reqs = c.requests.slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; });
  writeRows_('req', reqs.map(function (r) {
    var st = E.rst(r), need = E.coverItems(r).filter(E.ackNeeded);
    return { id: r.id, type: r.type, type_label: SubEngine.TYPES[r.type].label, teacher: n(r.teacher), dept: D.groups[E.gOf(r.teacher)],
      arranged_by: r.arrangedBy != null ? n(r.arrangedBy) : (r.arrangedByName || ''), dates: r.dates.join(','),
      slots: r.slots ? JSON.stringify(r.slots) : '', reason: r.reason || '', file_name: r.file ? r.file.name : '', file_url: r.file ? r.file.url : '',
      status: r.status, status_label: SubEngine.STATUS[st], periods_total: E.coverItems(r).length,
      ack_progress: need.filter(function (i) { return i.ack === 'ack'; }).length + '/' + need.length,
      created_at: r.createdAt, updated_at: r.updatedAt || '', approved_by: r.approvedBy || '', approved_at: r.approvedAt || '',
      return_note: r.returnNote || '', history: JSON.stringify(r.history || []) };
  }));
  var rows = [];
  reqs.forEach(function (r) {
    var st = SubEngine.STATUS[E.rst(r)];
    r.items.forEach(function (it) {
      rows.push({ request_id: r.id, item_id: it.id, date: it.date, period: it.p, time: D.times[it.p] || '', teacher: n(r.teacher),
        code: it.code, subject: it.subj, 'class': it.cls, room: it.room, method: it.method || '',
        method_label: it.method ? SubEngine.METHODS[it.method].label : '',
        sub_teacher: it.method === 'sub' ? n(it.sub) : '', swap_teacher: it.method === 'swapT' ? n(it.swap.t) : '',
        swap_date: it.swap ? it.swap.date : '', swap_period: it.swap ? it.swap.p : '',
        swap_code: it.swap && it.swap.code || '', swap_subject: it.swap && it.swap.subj || '',
        ack: it.ack || '', ack_at: it.ackAt || '', decline_note: it.declNote || '', decline_at: it.declAt || '',
        declined_by: (it.declinedBy || []).map(n).join('; '), request_type: SubEngine.TYPES[r.type].label, request_status: st });
    });
  });
  writeRows_('items', rows);
}
function log_(me, action, rid, detail) {
  sheet_('log').appendRow([now_(), me ? me.username : '', me ? me.name : 'ระบบ', action, rid || '', detail || '']);
}
function version_() { return +(PropertiesService.getScriptProperties().getProperty('VERSION') || 0); }
function bump_() { var v = version_() + 1; PropertiesService.getScriptProperties().setProperty('VERSION', String(v)); return v; }
function nextId_(S) {
  var p = PropertiesService.getScriptProperties(), n = +(p.getProperty('SEQ') || 0) + 1;
  p.setProperty('SEQ', String(n));
  var yy = (String(S.TERM_NAME).match(/(\d{2})\s*$/) || ['', '00'])[1];
  return 'ST' + yy + '-' + ('000' + n).slice(-4);
}

/* ---------------------------------------------------------------- e-Score users & auth */
var COLS_ = {
  username: ['username', 'user', 'user name', 'user_name', 'userid', 'user_id', 'login', 'ชื่อผู้ใช้', 'ชื่อเข้าใช้', 'รหัสผู้ใช้', 'id', 'email', 'อีเมล'],
  password: ['password', 'pass', 'passwd', 'pwd', 'รหัสผ่าน'],
  name: ['name', 'fullname', 'full name', 'full_name', 'display name', 'ชื่อ-สกุล', 'ชื่อ-นามสกุล', 'ชื่อ - สกุล', 'ชื่อ สกุล', 'ชื่อสกุล', 'ชื่อครู', 'ครู', 'teacher', 'ชื่อ'],
  email: ['email', 'e-mail', 'mail', 'อีเมล', 'อีเมล์']
};
function detectCols_(headers, S) {
  var norm = headers.map(function (h) { return String(h).trim().toLowerCase(); });
  var pick = function (key, override, exclude) {
    if (override) { var i = norm.indexOf(String(override).trim().toLowerCase()); if (i >= 0) return i; }
    var c = COLS_[key];
    for (var a = 0; a < c.length; a++) { var j = norm.indexOf(c[a]); if (j >= 0 && exclude.indexOf(j) < 0) return j; }
    for (var b = 0; b < c.length; b++) for (var k = 0; k < norm.length; k++) if (exclude.indexOf(k) < 0 && c[b].length > 2 && norm[k].indexOf(c[b]) >= 0) return k;
    return -1;
  };
  var pw = pick('password', S.ESCORE_COL_PASSWORD, []);
  var un = pick('username', S.ESCORE_COL_USERNAME, [pw]);
  var nm = pick('name', S.ESCORE_COL_NAME, [pw, un]);
  var em = pick('email', S.ESCORE_COL_EMAIL, [pw]);
  return { username: un, password: pw, name: nm, email: em, headers: headers };
}
function escoreUsers_(S, force) {
  var cache = CacheService.getScriptCache();
  if (!force) { var c = cache.get('ESCORE_USERS'); if (c) return JSON.parse(c); }
  if (!S.ESCORE_SPREADSHEET_ID) throw new Error('ยังไม่ได้ตั้งค่า ESCORE_SPREADSHEET_ID ในชีต Settings');
  var sh = SpreadsheetApp.openById(S.ESCORE_SPREADSHEET_ID).getSheetByName(S.ESCORE_USERS_SHEET || 'Users');
  if (!sh) throw new Error('ไม่พบชีต ' + (S.ESCORE_USERS_SHEET || 'Users') + ' ในไฟล์ e-Score');
  var v = sh.getDataRange().getValues(), col = detectCols_(v[0], S);
  if (col.username < 0 || col.password < 0) throw new Error('หาคอลัมน์ username/password ในชีต Users ไม่พบ — กำหนด ESCORE_COL_USERNAME / ESCORE_COL_PASSWORD');
  var users = v.slice(1).filter(function (r) { return String(r[col.username]).trim(); }).map(function (r) {
    return { u: String(r[col.username]).trim(), p: String(r[col.password]), n: col.name >= 0 ? String(r[col.name]).trim() : String(r[col.username]).trim(),
      e: col.email >= 0 ? String(r[col.email]).trim() : '' };
  });
  var out = { users: users, cols: { username: v[0][col.username], password: v[0][col.password], name: col.name >= 0 ? v[0][col.name] : '', email: col.email >= 0 ? v[0][col.email] : '' } };
  try { cache.put('ESCORE_USERS', JSON.stringify(out), 600); } catch (e) { /* ใหญ่เกิน cache ก็อ่านใหม่ทุกครั้ง */ }
  return out;
}
function hex_(bytes) { return bytes.map(function (b) { var h = ((b + 256) % 256).toString(16); return h.length < 2 ? '0' + h : h; }).join(''); }
function checkPwd_(stored, input, mode) {
  stored = String(stored == null ? '' : stored).trim(); input = String(input == null ? '' : input);
  if (!stored || !input) return false;
  mode = String(mode || 'auto').toLowerCase();
  if ((mode === 'auto' || mode === 'plain') && stored === input) return true;
  var algs = [];
  if (mode === 'auto' || mode === 'sha256') algs.push(Utilities.DigestAlgorithm.SHA_256);
  if (mode === 'auto' || mode === 'md5') algs.push(Utilities.DigestAlgorithm.MD5);
  for (var i = 0; i < algs.length; i++) {
    try {
      var b = Utilities.computeDigest(algs[i], input, Utilities.Charset.UTF_8);
      if (!b || !b.length) continue;
      if (stored.toLowerCase() === hex_(b) || stored === Utilities.base64Encode(b)) return true;
    } catch (e) { /* ignore */ }
  }
  return false;
}
function normName_(s) {
  return String(s || '').replace(/^\s*(ว่าที่\s*ร้อยตรี|ว่าที่\s*ร\.ต\.|ว่าที่ร\.ต\.|สิบเอก|ส\.อ\.|ดร\.|นางสาว|น\.ส\.|นาง|นาย|mr\.?|ms\.?|mrs\.?|miss)\s*/i, '')
    .replace(/[\s.]/g, '').toLowerCase();
}
function matchTeacher_(D, username, displayName, umap) {
  if (umap[username.toLowerCase()]) return umap[username.toLowerCase()];
  var k = normName_(displayName); if (!k) return null;
  for (var i = 0; i < D.teachers.length; i++) if (normName_(D.teachers[i].n) === k) return D.teachers[i].n;
  return null;
}
function userMap_() {
  var m = {}; readRows_('umap').forEach(function (r) { if (r.escore_username) m[String(r.escore_username).toLowerCase()] = r.teacher; });
  return m;
}
function me_(username, S, D, users) {
  users = users || escoreUsers_(S).users;
  var u = null; for (var i = 0; i < users.length; i++) if (users[i].u.toLowerCase() === String(username).toLowerCase()) { u = users[i]; break; }
  if (!u) throw authErr_('ไม่พบบัญชีผู้ใช้');
  var teacher = matchTeacher_(D, u.u, u.n, userMap_());
  var ti = teacher != null ? SubEngine.index(D).byName[teacher] : null;
  var roles = ['teacher'], lc = u.u.toLowerCase();
  var inList = function (key) { return list_(S[key]).map(function (x) { return x.toLowerCase(); }).indexOf(lc) >= 0; };
  if (inList('ACAD_USERS')) roles.push('acad');
  if (inList('ADMIN_USERS')) roles.push('admin');
  var heads = json_(S.DEPT_HEADS, {}), hg = [];
  Object.keys(heads).forEach(function (g) { if (ti != null && heads[g] === D.teachers[ti].n) { var gi = D.groups.indexOf(g); if (gi >= 0) hg.push(gi); } });
  if (hg.length) roles.push('dept');
  return { username: u.u, name: ti != null ? D.teachers[ti].n : u.n, escoreName: u.n, email: u.e, ti: ti == null ? null : ti, roles: roles, headGroups: hg };
}
function authErr_(m) { var e = new Error(m); e.auth = true; return e; }
function session_(token) {
  if (!token) throw authErr_('กรุณาเข้าสู่ระบบ');
  var cache = CacheService.getScriptCache(), u = cache.get('S_' + token);
  if (!u) throw authErr_('หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่');
  cache.put('S_' + token, u, 21600);
  return u;
}
function wrap_(fn) {
  try { return fn(); }
  catch (e) { return { ok: false, error: String(e && e.message || e), auth: !!(e && e.auth) }; }
}

/* ---------------------------------------------------------------- context */
function ctx_(S) {
  S = S || settings_();
  var D = loadTimetable_(S), requests = loadRequests_(D), today = today_();
  return { S: S, D: D, requests: requests, today: today, E: SubEngine.create(D, requests, engineSettings_(S), today) };
}
function isPriv_(me) { return me.roles.indexOf('acad') >= 0 || me.roles.indexOf('admin') >= 0; }
function actor_(me) { return { ti: me.ti, privileged: isPriv_(me), headGroups: me.headGroups }; }
function canArrange_(me, r, E) {
  return isPriv_(me) || (me.ti != null && (r.teacher === me.ti || r.arrangedBy === me.ti)) ||
    (r.type === 'sick' && me.headGroups.indexOf(E.gOf(r.teacher)) >= 0);
}
function find_(c, rid) {
  for (var i = 0; i < c.requests.length; i++) if (c.requests[i].id === rid) return c.requests[i];
  throw new Error('ไม่พบคำขอ ' + rid);
}
function hist_(r, me, act, note) { (r.history = r.history || []).push({ at: now_(), by: me.name, act: act, note: note || '' }); r.updatedAt = now_(); }
function pubSettings_(S, D) {
  var heads = json_(S.DEPT_HEADS, {}), dh = {};
  Object.keys(heads).forEach(function (g) { var gi = D.groups.indexOf(g), ti = SubEngine.index(D).byName[heads[g]]; if (gi >= 0 && ti != null) dh[gi] = ti; });
  var es = engineSettings_(S);
  es.deptHeads = dh; es.school = S.SCHOOL_NAME; es.termName = S.TERM_NAME; es.notify = S.NOTIFY_EMAIL === 'on';
  return es;
}
function state_(c) { return { requests: c.requests, version: version_(), today: c.today }; }

/* อ่านอย่างเดียว */
function read_(token, fn) {
  return wrap_(function () {
    var u = session_(token), S = settings_(), c = ctx_(S), me = me_(u, S, c.D);
    return fn(me, c);
  });
}
/* เขียน: ล็อก → โหลดใหม่ → ตรวจ → บันทึก */
function mutate_(token, fn) {
  return wrap_(function () {
    var u = session_(token), lock = LockService.getScriptLock();
    if (!lock.tryLock(25000)) throw new Error('ระบบกำลังบันทึกข้อมูลของผู้อื่น กรุณาลองใหม่');
    try {
      var S = settings_(), c = ctx_(S), me = me_(u, S, c.D);
      c.mail = [];
      var res = fn(me, c) || {};
      if (res.error) return { ok: false, error: res.error, state: state_(c) };
      saveRequests_(c);
      bump_();
      var out = { ok: true, data: res, state: state_(c) };
      try { sendMail_(c); } catch (e) { /* อีเมลไม่สำเร็จไม่กระทบการบันทึก */ }
      return out;
    } finally { lock.releaseLock(); }
  });
}
function queueMail_(c, tis, subject, body) { (tis || []).forEach(function (ti) { if (ti != null) c.mail.push({ ti: ti, subject: subject, body: body }); }); }
function sendMail_(c) {
  if (c.S.NOTIFY_EMAIL !== 'on' || !c.mail.length) return;
  var users = escoreUsers_(c.S).users, um = userMap_(), byTeacher = {};
  users.forEach(function (u) { var t = matchTeacher_(c.D, u.u, u.n, um); if (t && u.e) byTeacher[t] = u.e; });
  var url = ScriptApp.getService().getUrl();
  c.mail.forEach(function (m) {
    var to = byTeacher[c.D.teachers[m.ti] && c.D.teachers[m.ti].n];
    if (to) MailApp.sendEmail({ to: to, subject: '[ระบบจัดสอนแทน] ' + m.subject, body: m.body + '\n\nเปิดระบบ: ' + url });
  });
}
function acadTis_(c) {
  var users = escoreUsers_(c.S).users, um = userMap_(), acad = list_(c.S.ACAD_USERS).map(function (x) { return x.toLowerCase(); });
  return users.filter(function (u) { return acad.indexOf(u.u.toLowerCase()) >= 0; })
    .map(function (u) { var t = matchTeacher_(c.D, u.u, u.n, um); return t ? SubEngine.index(c.D).byName[t] : null; });
}
function itemText_(it) { return it.date + ' คาบ ' + it.p + ' ' + it.cls; }

/* ================================================================ API */
function apiLogin(username, password) {
  return wrap_(function () {
    username = String(username || '').trim();
    if (!username || !password) throw new Error('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
    var cache = CacheService.getScriptCache(), fk = 'F_' + username.toLowerCase(), fails = +(cache.get(fk) || 0);
    if (fails >= 5) throw new Error('ใส่รหัสผ่านผิดหลายครั้ง กรุณารอ 10 นาที');
    var S = settings_(), es = escoreUsers_(S), u = null;
    for (var i = 0; i < es.users.length; i++) if (es.users[i].u.toLowerCase() === username.toLowerCase()) { u = es.users[i]; break; }
    if (!u || !checkPwd_(u.p, password, S.ESCORE_HASH)) {
      cache.put(fk, String(fails + 1), 600);
      throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }
    cache.remove(fk);
    var token = Utilities.getUuid();
    cache.put('S_' + token, u.u, 21600);
    var D = loadTimetable_(S), me = me_(u.u, S, D, es.users);
    log_(me, 'เข้าสู่ระบบ', '', '');
    return { ok: true, token: token, me: me };
  });
}
function apiLogout(token) {
  return wrap_(function () { CacheService.getScriptCache().remove('S_' + token); return { ok: true }; });
}
function apiBootstrap(token) {
  return read_(token, function (me, c) {
    var admin = isPriv_(me);
    return { ok: true, me: me, D: c.D, settings: pubSettings_(c.S, c.D), state: state_(c),
      sheetUrl: admin ? db_().getUrl() : '' };
  });
}
function apiSync(token, version) {
  return wrap_(function () {
    session_(token);
    if (+version === version_()) return { ok: true, unchanged: true };
    var S = settings_(), c = ctx_(S);
    return { ok: true, state: state_(c), settings: pubSettings_(S, c.D) };
  });
}

/* สร้างคำขอใหม่ / แก้ไขแล้วส่งใหม่ (draft.editId) */
function apiSubmit(token, draft) {
  return mutate_(token, function (me, c) {
    var old = null;
    if (draft.editId) {
      old = find_(c, draft.editId);
      if (!canArrange_(me, old, c.E)) return { error: 'ไม่มีสิทธิ์แก้ไขคำขอนี้' };
      if (old.status === 'approved' || old.status === 'cancelled') return { error: 'คำขอนี้' + SubEngine.STATUS[old.status] + 'แล้ว แก้ไขไม่ได้' };
      draft.id = old.id;
    } else delete draft.id;
    var v = c.E.validateDraft(draft, actor_(me));
    if (v.errors.length) return { error: v.errors.join('\n') };
    var r = v.req;
    r.reason = String(draft.reason || '').slice(0, 1000);
    r.file = draft.file && draft.file.name ? { name: String(draft.file.name), url: String(draft.file.url || '') } : null;
    if (old) {
      r.items.forEach(function (it) {
        var o = old.items.filter(function (x) { return x.id === it.id; })[0];
        if (o && o.ack === 'ack' && o.method === it.method && JSON.stringify([o.sub, o.swap && [o.swap.t, o.swap.date, o.swap.p]]) ===
            JSON.stringify([it.sub, it.swap && [it.swap.t, it.swap.date, it.swap.p]])) { it.ack = 'ack'; it.ackAt = o.ackAt; }
      });
      ['createdAt', 'arrangedBy', 'arrangedByName', 'history'].forEach(function (k) { r[k] = old[k]; });
      r.status = 'open'; r.returnNote = '';
      hist_(r, me, 'แก้ไขและส่งใหม่');
      c.requests[c.requests.indexOf(old)] = r;
      log_(me, 'แก้ไขและส่งใหม่', r.id, '');
    } else {
      r.id = nextId_(c.S);
      r.createdAt = now_(); r.arrangedBy = me.ti; r.arrangedByName = me.name; r.history = [];
      hist_(r, me, 'สร้างคำขอและจัดสอนแทน', SubEngine.TYPES[r.type].label + ' ' + r.dates.length + ' วัน ' + c.E.coverItems(r).length + ' คาบ');
      c.requests.push(r);
      log_(me, 'สร้างคำขอ', r.id, c.D.teachers[r.teacher].n + ' · ' + SubEngine.TYPES[r.type].label + ' · ' + r.dates.join(', '));
    }
    var who = {}; r.items.forEach(function (it) { if (it.ack === 'pending') who[c.E.ackWho(it)] = 1; });
    queueMail_(c, Object.keys(who).map(Number), 'มีคาบสอนแทน/สลับคาบรอท่านรับทราบ (' + r.id + ')',
      c.D.teachers[r.teacher].n + ' ' + SubEngine.TYPES[r.type].label + ' ' + r.dates.join(', ') + ' — กรุณาเข้าระบบเพื่อกดรับทราบ');
    if (c.E.rst(r) === 'review') queueMail_(c, acadTis_(c), 'คำขอ ' + r.id + ' รอเห็นชอบ', 'ไม่มีคาบที่ต้องรับทราบ — รอหัวหน้ากลุ่มบริหารงานวิชาการเห็นชอบ');
    return { id: r.id };
  });
}
function ackItems_(me, c, r, ids) {
  var n = 0;
  r.items.forEach(function (it) {
    if (it.ack === 'pending' && c.E.ackWho(it) === me.ti && (!ids || ids.indexOf(it.id) >= 0)) {
      it.ack = 'ack'; it.ackAt = now_(); n++;
      hist_(r, me, 'รับทราบ', itemText_(it));
      log_(me, 'รับทราบ', r.id, itemText_(it));
    }
  });
  if (n && c.E.rst(r) === 'review') {
    hist_(r, { name: 'ระบบ' }, 'ผู้ถูกจัดรับทราบครบ — ส่งหัวหน้ากลุ่มบริหารงานวิชาการ');
    queueMail_(c, acadTis_(c), 'คำขอ ' + r.id + ' รอเห็นชอบ', 'ผู้ถูกจัดรับทราบครบแล้ว');
  }
  return n;
}
function apiAck(token, rid, itemIds) {
  return mutate_(token, function (me, c) {
    if (me.ti == null) return { error: 'บัญชีนี้ยังไม่ได้จับคู่กับรายชื่อครู' };
    var r = find_(c, rid);
    if (r.status === 'cancelled') return { error: 'คำขอนี้ถูกยกเลิกแล้ว' };
    var n = ackItems_(me, c, r, itemIds || null);
    return n ? { count: n } : { error: 'ไม่มีคาบที่รอท่านรับทราบในคำขอนี้' };
  });
}
function apiAckAll(token) {
  return mutate_(token, function (me, c) {
    var n = 0;
    c.requests.forEach(function (r) { if (r.status !== 'cancelled') n += ackItems_(me, c, r, null); });
    return n ? { count: n } : { error: 'ไม่มีคาบที่รอรับทราบ' };
  });
}
function apiDecline(token, rid, itemId, note) {
  return mutate_(token, function (me, c) {
    note = String(note || '').trim();
    if (!note) return { error: 'กรุณาระบุเหตุผล' };
    var r = find_(c, rid), it = r.items.filter(function (x) { return x.id === itemId; })[0];
    if (!it || it.ack !== 'pending' || c.E.ackWho(it) !== me.ti) return { error: 'ไม่สามารถขอเปลี่ยนคาบนี้ได้' };
    it.ack = 'declined'; it.declNote = note.slice(0, 300); it.declAt = now_();
    hist_(r, me, 'ขอเปลี่ยน', itemText_(it) + ' — ' + note);
    log_(me, 'ขอเปลี่ยน', r.id, itemText_(it) + ' — ' + note);
    queueMail_(c, [r.arrangedBy != null ? r.arrangedBy : r.teacher], 'มีผู้ขอเปลี่ยนคาบสอนแทน (' + r.id + ')', itemText_(it) + '\nเหตุผล: ' + note);
    return { ok: 1 };
  });
}
/* จัดใหม่เฉพาะคาบที่ถูกขอเปลี่ยน */
function apiFix(token, rid, pick) {
  return mutate_(token, function (me, c) {
    var r = find_(c, rid);
    if (!canArrange_(me, r, c.E)) return { error: 'ไม่มีสิทธิ์จัดคำขอนี้' };
    if (r.status !== 'open') return { error: 'คำขอนี้' + SubEngine.STATUS[c.E.rst(r)] + ' — ใช้ “แก้ไขและส่งใหม่”' };
    var it = r.items.filter(function (x) { return x.id === pick.id; })[0];
    if (!it || it.ack !== 'declined') return { error: 'คาบนี้ไม่ได้อยู่ในสถานะขอเปลี่ยน' };
    var prev = c.E.ackWho(it), clone = JSON.parse(JSON.stringify(r));
    var ni = clone.items.filter(function (x) { return x.id === pick.id; })[0];
    ni.declinedBy = (it.declinedBy || []).concat(prev != null ? [prev] : []);
    delete ni.sub; delete ni.swap; delete ni.declNote; delete ni.declAt; delete ni.ackAt;
    ni.method = pick.method;
    if (pick.method === 'sub') ni.sub = +pick.sub;
    if (pick.method === 'swapT') ni.swap = { t: +pick.swap.t, date: pick.swap.date, p: +pick.swap.p, code: pick.swap.code, subj: pick.swap.subj };
    if (pick.method === 'swapF') ni.swap = { date: pick.swap.date, p: +pick.swap.p };
    var e = c.E.checkItem(clone, ni);
    if (e) return { error: e };
    ni.ack = c.E.ackNeeded(ni) ? 'pending' : null;
    r.items[r.items.indexOf(it)] = ni;
    hist_(r, me, 'จัดใหม่', itemText_(ni) + ' → ' + SubEngine.METHODS[ni.method].label);
    log_(me, 'จัดใหม่', r.id, itemText_(ni));
    if (ni.ack === 'pending') queueMail_(c, [c.E.ackWho(ni)], 'มีคาบสอนแทน/สลับคาบรอท่านรับทราบ (' + r.id + ')', itemText_(ni));
    return { ok: 1 };
  });
}
function apiApprove(token, rids) {
  return mutate_(token, function (me, c) {
    if (me.roles.indexOf('acad') < 0) return { error: 'เฉพาะหัวหน้ากลุ่มบริหารงานวิชาการ' };
    var done = [], skipped = [];
    (rids || []).forEach(function (id) {
      var r = find_(c, id);
      if (c.E.rst(r) !== 'review') { skipped.push(id); return; }
      r.status = 'approved'; r.approvedAt = now_(); r.approvedBy = me.name;
      hist_(r, me, 'เห็นชอบ — การจัดสอนแทนสมบูรณ์');
      log_(me, 'เห็นชอบ', r.id, rids.length > 1 ? 'เห็นชอบแบบกลุ่ม' : '');
      queueMail_(c, [r.teacher], 'การจัดสอนแทน ' + r.id + ' สมบูรณ์', 'หัวหน้ากลุ่มบริหารงานวิชาการเห็นชอบแล้ว');
      done.push(id);
    });
    if (!done.length) return { error: 'ไม่มีรายการที่พร้อมเห็นชอบ (ต้องรับทราบครบก่อน)' };
    return { done: done, skipped: skipped };
  });
}
function apiReturn(token, rid, note) {
  return mutate_(token, function (me, c) {
    if (me.roles.indexOf('acad') < 0) return { error: 'เฉพาะหัวหน้ากลุ่มบริหารงานวิชาการ' };
    note = String(note || '').trim(); if (!note) return { error: 'กรุณาระบุสิ่งที่ต้องแก้ไข' };
    var r = find_(c, rid);
    if (r.status !== 'open') return { error: 'คำขอนี้' + SubEngine.STATUS[c.E.rst(r)] + 'แล้ว' };
    r.status = 'returned'; r.returnNote = note;
    hist_(r, me, 'ส่งกลับแก้ไข', note); log_(me, 'ส่งกลับแก้ไข', r.id, note);
    queueMail_(c, [r.arrangedBy != null ? r.arrangedBy : r.teacher], 'คำขอ ' + r.id + ' ถูกส่งกลับแก้ไข', note);
    return { ok: 1 };
  });
}
function apiCancel(token, rid, note) {
  return mutate_(token, function (me, c) {
    var r = find_(c, rid);
    if (!canArrange_(me, r, c.E)) return { error: 'ไม่มีสิทธิ์ยกเลิกคำขอนี้' };
    if (r.status === 'cancelled') return { error: 'ยกเลิกไปแล้ว' };
    if (!isPriv_(me) && r.dates[r.dates.length - 1] < c.today) return { error: 'คำขอนี้ผ่านไปแล้ว ยกเลิกไม่ได้ (ติดต่อหัวหน้าวิชาการ)' };
    var who = {}; r.items.forEach(function (it) { var w = c.E.ackWho(it); if (w != null && it.ack !== 'declined') who[w] = 1; });
    r.status = 'cancelled';
    hist_(r, me, 'ยกเลิกคำขอ', note || ''); log_(me, 'ยกเลิก', r.id, note || '');
    queueMail_(c, Object.keys(who).map(Number), 'ยกเลิกการจัดสอนแทน ' + r.id, 'คาบที่ท่านถูกจัดในคำขอนี้ถูกยกเลิกแล้ว');
    return { ok: 1 };
  });
}
function apiGetLog(token, q) {
  return read_(token, function (me) {
    if (!isPriv_(me)) return { ok: false, error: 'ไม่มีสิทธิ์' };
    q = String(q || '').trim();
    var rows = readRows_('log').reverse();
    if (q) rows = rows.filter(function (r) { return JSON.stringify(r).indexOf(q) >= 0; });
    return { ok: true, rows: rows.slice(0, 500) };
  });
}

/* ---------------------------------------------------------------- admin */
function requireAdmin_(me) { if (!isPriv_(me)) throw new Error('เฉพาะผู้ดูแลระบบ/หัวหน้ากลุ่มบริหารงานวิชาการ'); }
function apiAdmin(token) {
  return read_(token, function (me, c) {
    requireAdmin_(me);
    var raw = {}; EDITABLE.forEach(function (k) { raw[k] = c.S[k]; });
    var info = { ok: false }, users = [];
    try {
      var es = escoreUsers_(c.S, true), um = userMap_();
      info = { ok: true, cols: es.cols, count: es.users.length };
      users = es.users.map(function (u) {
        var mapped = um[u.u.toLowerCase()], t = matchTeacher_(c.D, u.u, u.n, um);
        return { username: u.u, name: u.n, teacher: t || '', via: mapped ? 'map' : (t ? 'name' : '') };
      });
    } catch (e) { info = { ok: false, error: String(e.message || e) }; }
    return { ok: true, settings: raw, escore: info, users: users, timetable: { source: c.D.source, importedAt: c.D.importedAt, teachers: c.D.teachers.length } };
  });
}
function apiSaveSettings(token, patch) {
  return wrap_(function () {
    var u = session_(token), S = settings_(), D = loadTimetable_(S), me = me_(u, S, D);
    requireAdmin_(me);
    var clean = {};
    Object.keys(patch || {}).forEach(function (k) { if (EDITABLE.indexOf(k) >= 0) clean[k] = String(patch[k]); });
    ['TERM_START', 'TERM_END'].forEach(function (k) { if (clean[k] && !/^\d{4}-\d{2}-\d{2}$/.test(clean[k])) throw new Error(k + ' ต้องเป็น YYYY-MM-DD'); });
    if (clean.HOLIDAYS != null) clean.HOLIDAYS = list_(clean.HOLIDAYS).filter(function (x) { return /^\d{4}-\d{2}-\d{2}$/.test(x); }).join(',');
    if (clean.DEPT_HEADS != null) json_(clean.DEPT_HEADS, null) || (function () { throw new Error('DEPT_HEADS ไม่ใช่ JSON'); })();
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try { saveSettings_(clean); bump_(); } finally { lock.releaseLock(); }
    CacheService.getScriptCache().remove('ESCORE_USERS');
    log_(me, 'แก้ไขตั้งค่า', '', Object.keys(clean).join(', '));
    return { ok: true };
  });
}
function apiSetUserMap(token, username, teacher) {
  return wrap_(function () {
    var u = session_(token), S = settings_(), D = loadTimetable_(S), me = me_(u, S, D);
    requireAdmin_(me);
    var rows = readRows_('umap').filter(function (r) { return String(r.escore_username).toLowerCase() !== String(username).toLowerCase(); });
    if (teacher) rows.push({ escore_username: username, teacher: teacher, note: 'กำหนดโดย ' + me.name + ' ' + now_() });
    writeRows_('umap', rows);
    log_(me, 'จับคู่ผู้ใช้', '', username + ' → ' + (teacher || '(ล้าง)'));
    return { ok: true };
  });
}
function apiImportTimetable(token, D) {
  return wrap_(function () {
    var u = session_(token), S = settings_(), D0 = loadTimetable_(S), me = me_(u, S, D0);
    requireAdmin_(me);
    var lock = LockService.getScriptLock(); lock.waitLock(30000);
    try { var res = importTimetable_(D); bump_(); } finally { lock.releaseLock(); }
    log_(me, 'นำเข้าตารางสอน', '', JSON.stringify(res));
    return { ok: true, result: res };
  });
}
function apiUpload(token, file) {
  return wrap_(function () {
    session_(token);
    if (!file || !file.b64) throw new Error('ไม่พบไฟล์');
    if (file.b64.length > 7e6) throw new Error('ไฟล์ใหญ่เกิน 5 MB');
    var S = settings_(), folder;
    if (S.UPLOAD_FOLDER_ID) folder = DriveApp.getFolderById(S.UPLOAD_FOLDER_ID);
    else {
      folder = DriveApp.createFolder('ระบบจัดสอนแทน KJST - ไฟล์แนบ');
      saveSettings_({ UPLOAD_FOLDER_ID: folder.getId() });
    }
    var blob = Utilities.newBlob(Utilities.base64Decode(file.b64), file.mime || 'application/octet-stream', file.name || 'file');
    var f = folder.createFile(blob);
    return { ok: true, file: { name: f.getName(), url: f.getUrl() } };
  });
}

/* ================================================================ รันจาก editor */
/** รันครั้งแรกครั้งเดียว: สร้างชีตทั้งหมด + ค่าเริ่มต้น + นำเข้าตารางสอน 2/2569 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('ต้องสร้างสคริปต์จากเมนู ส่วนขยาย > Apps Script ของ Google Sheet');
  PropertiesService.getScriptProperties().setProperty('DB_ID', ss.getId());
  Object.keys(SH).forEach(function (k) { sheet_(k); });
  saveSettings_({});
  var S = settings_();
  if (!json_(S.TT_META, null)) {
    var res = importTimetable_(JSON.parse(HtmlService.createHtmlOutputFromFile('TimetableData').getContent()));
    Logger.log('นำเข้าตารางสอน: ' + JSON.stringify(res));
  }
  var first = ss.getSheetByName('Sheet1') || ss.getSheetByName('แผ่น1') || ss.getSheetByName('ชีต1');
  if (first && ss.getSheets().length > 1 && first.getLastRow() === 0) ss.deleteSheet(first);
  Logger.log('เสร็จแล้ว — ต่อไป: กรอก ESCORE_SPREADSHEET_ID, ACAD_USERS, ADMIN_USERS ในชีต Settings แล้วรัน testEscore()');
}
/** ตรวจการเชื่อมต่อชีต Users ของ e-Score และการจับคู่ชื่อครู */
function testEscore() {
  var S = settings_(), es = escoreUsers_(S, true), D = loadTimetable_(S), um = userMap_(), ok = 0, miss = [];
  es.users.forEach(function (u) { if (matchTeacher_(D, u.u, u.n, um)) ok++; else miss.push(u.u + ' (' + u.n + ')'); });
  Logger.log('คอลัมน์ที่ใช้: ' + JSON.stringify(es.cols));
  Logger.log('ผู้ใช้ทั้งหมด ' + es.users.length + ' · จับคู่กับรายชื่อครูได้ ' + ok);
  if (miss.length) Logger.log('จับคู่ไม่ได้ (กำหนดเองได้ในหน้าตั้งค่า): ' + miss.join(', '));
  var pw = es.users.length ? es.users[0].p : '';
  Logger.log('ตัวอย่างรูปแบบรหัสผ่าน: ' + (/^[0-9a-f]{64}$/i.test(pw) ? 'SHA-256 hex' : /^[0-9a-f]{32}$/i.test(pw) ? 'MD5 hex' : /^[A-Za-z0-9+/]{43}=$/.test(pw) ? 'SHA-256 base64' : 'ข้อความธรรมดา/อื่น ๆ'));
}
