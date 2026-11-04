/* =====================================================================
   TTImport — แปลงไฟล์ Excel "ฐานข้อมูลตารางเรียนตารางสอน" เป็นข้อมูลตารางสอนของระบบ
   ใช้ทั้งหน้าเว็บ (นำเข้าในหน้าตั้งค่า) และ build.py (ผ่าน node)
   ต้องมี 2 ชีต:
     ฐานข้อมูลตารางสอน : ชื่อ-สกุล | กลุ่มสาระ | วัน | คาบ | เวลา | รหัสวิชา | ชื่อวิชา | ชั้นที่สอน | ห้อง | ประเภทคาบ
     ฐานข้อมูลตารางเรียน: ชั้นเรียน | วัน | คาบ | เวลา | รหัสวิชา | ชื่อวิชา | ครูผู้สอน | ห้อง | สถานะ | กลุ่มสาระ
   ===================================================================== */
var TTImport = (function () {
  'use strict';
  var GROUP_ORDER = ['ภาษาไทย', 'คณิตศาสตร์', 'วิทยาศาสตร์และเทคโนโลยี', 'สังคมศึกษา ศาสนา และวัฒนธรรม',
    'สุขศึกษาและพลศึกษา', 'ศิลปะ', 'การงานอาชีพ', 'ภาษาต่างประเทศ', 'กิจกรรมพัฒนาผู้เรียน'];
  var ALIAS = { 'วิทยาศาสตร์ฯ': 2, 'วิทยาศาสตร์': 2, 'สังคมศึกษาฯ': 3, 'สังคมศึกษา': 3, 'สุขศึกษาฯ': 4, 'สุขศึกษา': 4,
    'การงานฯ': 6, 'กิจกรรมแนะแนว': 8, 'แนะแนว': 8, 'กิจกรรมฯ': 8 };
  var DAYS = ['วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์'];
  var squash = function (s) { return String(s || '').replace(/\s+/g, ''); };

  function groupIndex(name) {
    var s = squash(name); if (!s) return -1;
    for (var i = 0; i < GROUP_ORDER.length; i++) if (squash(GROUP_ORDER[i]) === s) return i;
    if (ALIAS[String(name).trim()] != null) return ALIAS[String(name).trim()];
    for (i = 0; i < GROUP_ORDER.length; i++) if (squash(GROUP_ORDER[i]).indexOf(s.replace('ฯ', '')) === 0) return i;
    return -1;
  }
  function dayIndex(v) {
    var s = String(v || '').trim(); if (s.indexOf('วัน') !== 0) s = 'วัน' + s;
    return DAYS.indexOf(s);
  }
  function periodIndex(v) {
    var s = String(v == null ? '' : v).trim();
    if (/^HR$/i.test(s) || s === '0') return 0;
    var m = s.match(/(\d+)/); return m ? +m[1] : -1;
  }
  function cols(header, want) {
    var h = header.map(function (x) { return squash(x); }), out = {};
    Object.keys(want).forEach(function (k) {
      var i = -1;
      want[k].some(function (n) { i = h.indexOf(squash(n)); return i >= 0; });
      out[k] = i;
    });
    return out;
  }
  var str = function (v) { return v == null ? '' : String(v).trim(); };

  /* teach, cls: array of rows (แถวแรกเป็นหัวตาราง) · prev: ข้อมูลเดิม (คงเวร/คาบไม่ต้องจัด) */
  function fromRows(teach, cls, prev) {
    prev = prev || {};
    var warn = [];
    var ct = cols(teach[0], { name: ['ชื่อ-สกุล', 'ชื่อสกุล', 'ครู'], group: ['กลุ่มสาระ'], day: ['วัน'], period: ['คาบ'], time: ['เวลา'],
      code: ['รหัสวิชา'], subj: ['ชื่อวิชา'], cls: ['ชั้นที่สอน', 'ชั้นเรียน', 'ห้องเรียน'], room: ['ห้อง'], kind: ['ประเภทคาบ', 'สถานะ'] });
    ['name', 'day', 'period', 'code'].forEach(function (k) { if (ct[k] < 0) throw new Error('ชีตตารางสอนไม่มีคอลัมน์ ' + k); });
    var cc = cols(cls[0], { cls: ['ชั้นเรียน', 'ห้องเรียน', 'ชั้น'], day: ['วัน'], period: ['คาบ'], time: ['เวลา'], code: ['รหัสวิชา'],
      subj: ['ชื่อวิชา'], teachers: ['ครูผู้สอน', 'ครู'], room: ['ห้อง'], status: ['สถานะ'] });
    ['cls', 'day', 'period'].forEach(function (k) { if (cc[k] < 0) throw new Error('ชีตตารางเรียนไม่มีคอลัมน์ ' + k); });

    var times = (prev.times || []).slice(), teachers = [], tIdx = {}, ts = [];
    teach.slice(1).forEach(function (r) {
      var n = str(r[ct.name]); if (!n) return;
      if (tIdx[n] == null) {
        var g = groupIndex(r[ct.group]);
        if (g < 0) { warn.push('ไม่รู้จักกลุ่มสาระ "' + str(r[ct.group]) + '" ของ ' + n + ' (จัดเป็นกิจกรรมพัฒนาผู้เรียน)'); g = 8; }
        tIdx[n] = teachers.length; teachers.push({ n: n, g: g }); ts.push([]);
      }
      var d = dayIndex(r[ct.day]), p = periodIndex(r[ct.period]);
      if (d < 0 || p < 0 || p > 9) return;
      if (ct.time >= 0 && str(r[ct.time])) times[p] = str(r[ct.time]);
      var code = str(r[ct.code]);
      if (!code) return;                                    // ว่าง
      ts[tIdx[n]].push([d, p, code, str(r[ct.subj]), str(r[ct.cls]), str(r[ct.room])]);
    });
    var cs = {}, classes = [], lunch = {};
    cls.slice(1).forEach(function (r) {
      var c = str(r[cc.cls]); if (!c) return;
      if (!cs[c]) { cs[c] = []; classes.push(c); }
      var d = dayIndex(r[cc.day]), p = periodIndex(r[cc.period]);
      if (d < 0 || p < 0 || p > 9) return;
      if (cc.time >= 0 && str(r[cc.time]) && !times[p]) times[p] = str(r[cc.time]);
      var status = cc.status >= 0 ? str(r[cc.status]) : '', code = str(r[cc.code]);
      if (status === 'ว่าง' || (!code && !status)) return;
      if (status === 'พักกลางวัน' || code === 'พักกลางวัน') {
        var lv = (c.match(/^ม\.\d/) || [''])[0]; if (lv) lunch[lv] = p;
        code = 'พักกลางวัน';
      }
      var tis = str(r[cc.teachers]).split(/\s*,\s*/).filter(String).map(function (n) {
        if (tIdx[n] == null) { warn.push('ตารางเรียน ' + c + ': ไม่พบครู "' + n + '" ในชีตตารางสอน'); return null; }
        return tIdx[n];
      }).filter(function (x) { return x != null; });
      cs[c].push([d, p, code || status, str(r[cc.subj]) || status, tis, str(r[cc.room])]);
    });
    // ห้องที่ครูสอนแต่ไม่อยู่ในตารางสอนของครู (ตรวจความสอดคล้อง)
    var seen = {};
    ts.forEach(function (rows, ti) { rows.forEach(function (x) {
      if (cs[x[4]] && x[0] != null) {
        var ok = cs[x[4]].some(function (y) { return y[0] === x[0] && y[1] === x[1]; });
        var k = x[4] + x[0] + '-' + x[1];
        if (!ok && !seen[k]) { seen[k] = 1; warn.push('ไม่สอดคล้อง: ' + teachers[ti].n + ' สอน ' + x[4] + ' ' + DAYS[x[0]] + ' คาบ ' + x[1] + ' แต่ตารางเรียนห้องนั้นว่าง'); }
      }
    }); });
    // เวร: คงของเดิมตามชื่อครู
    var duty = {};
    if (prev.duty && prev.teachers) Object.keys(prev.duty).forEach(function (ti) {
      var t = prev.teachers[ti]; if (t && tIdx[t.n] != null) duty[tIdx[t.n]] = prev.duty[ti];
    });
    for (var p = 0; p <= 9; p++) if (!times[p]) times[p] = '';
    return {
      D: { term: prev.term || '', source: 'Excel ฐานข้อมูลตารางเรียนตารางสอน', days: DAYS.slice(), times: times, groups: GROUP_ORDER.slice(),
        noCover: prev.noCover || ['HR', 'MEET', 'PLC', 'ประชุม'], activity: prev.activity || ['ชุมนุม', 'ลูกเสือ'],
        lunch: Object.keys(lunch).length ? lunch : (prev.lunch || {}), teachers: teachers, classes: classes, ts: ts, cs: cs, duty: duty },
      warnings: warn,
      summary: { teachers: teachers.length, classes: classes.length, slots: ts.reduce(function (s, x) { return s + x.length; }, 0) }
    };
  }

  /* หน้าเว็บ: workbook จาก SheetJS */
  function fromWorkbook(XLSX, wb, prev) {
    var find = function (re) { var n = wb.SheetNames.filter(function (s) { return re.test(s.replace(/\s/g, '')); })[0]; return n && wb.Sheets[n]; };
    var t = find(/ตารางสอน/), c = find(/ตารางเรียน/);
    if (!t || !c) throw new Error('ไม่พบชีต “ฐานข้อมูลตารางสอน” และ “ฐานข้อมูลตารางเรียน” ในไฟล์');
    var aoa = function (s) { return XLSX.utils.sheet_to_json(s, { header: 1, raw: false, defval: null }); };
    return fromRows(aoa(t), aoa(c), prev);
  }
  return { fromRows: fromRows, fromWorkbook: fromWorkbook, groupIndex: groupIndex, GROUP_ORDER: GROUP_ORDER };
})();
if (typeof module !== 'undefined') module.exports = TTImport;
