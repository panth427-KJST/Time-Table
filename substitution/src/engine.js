/* =====================================================================
   SubEngine — แกนคำนวณระบบจัดสอนแทน (ใช้ร่วมกันทั้ง server/Code.gs และ client/Index.html)
   ฟังก์ชันล้วน ไม่มี DOM ไม่มี Google API — เพื่อให้หน้าเว็บและ server ตรวจสอบด้วยกฎเดียวกัน

   รูปแบบข้อมูล
   D        ตารางสอน: {days, times, groups, teachers:[{n,g}], classes, ts:[[d,p,code,subj,cls,room]...],
                       cs:{cls:[[d,p,code,subj,[ti],room]]}, duty:{ti:[[d,p,label]]}, noCover:[], activity:[], lunch:{}}
   request  {id,type,teacher,arrangedBy,dates:[iso],slots:{iso:[p]}|null,reason,file,status,items:[item],history,...}
   item     {id,date,p,code,subj,cls,room,method,sub,swap:{t,date,p,code,subj},ack,ackAt,declNote,declinedBy:[]}
   settings {termStart,termEnd,maxAhead,leadDays,holidays:[iso]}
   ===================================================================== */
var SubEngine = (function () {
  'use strict';
  var TYPES = {
    personal: { label: 'ลากิจ', sick: false },
    official: { label: 'ไปราชการ', sick: false },
    mission:  { label: 'ติดภารกิจอื่น', sick: false },
    sick:     { label: 'ลาป่วย', sick: true }
  };
  var METHODS = {
    sub:   { label: 'ครูสอนแทน', short: 'สอนแทน' },
    swapT: { label: 'สลับคาบกับครูอื่น', short: 'สลับกับครู' },
    swapF: { label: 'สลับคาบว่าง', short: 'สลับคาบว่าง' },
    none:  { label: 'ไม่ต้องจัด/ครูร่วมดูแล', short: 'ครูร่วมดูแล' }
  };
  var STATUS = {
    ack: 'รอรับทราบ', fix: 'ต้องจัดใหม่', review: 'รอเห็นชอบ',
    approved: 'สมบูรณ์', returned: 'ส่งกลับแก้ไข', cancelled: 'ยกเลิก'
  };

  /* ---------- วันที่ (ใช้ UTC ล้วน เพื่อไม่ขึ้นกับ timezone ของเครื่อง) ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function pd(s) { var a = String(s).split('-'); return new Date(Date.UTC(+a[0], +a[1] - 1, +a[2])); }
  function isoOf(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function addD(s, n) { var d = pd(s); d.setUTCDate(d.getUTCDate() + n); return isoOf(d); }
  function wd(s) { var g = pd(s).getUTCDay(); return g >= 1 && g <= 5 ? g - 1 : -1; }
  function diffDays(a, b) { return Math.round((pd(b) - pd(a)) / 864e5); }
  function minStr(a, b) { return a < b ? a : b; }
  function maxStr(a, b) { return a > b ? a : b; }

  /* ---------- index ตารางสอน (สร้างครั้งเดียวต่อ D) ---------- */
  function index(D) {
    if (D.__idx) return D.__idx;
    var grid = function () { var a = []; for (var i = 0; i < 5; i++) { a.push([null, null, null, null, null, null, null, null, null, null]); } return a; };
    var TAT = D.ts.map(function (rows) {
      var a = grid();
      rows.forEach(function (r) { a[r[0]][r[1]] = { code: r[2], subj: r[3], cls: r[4], room: r[5] }; });
      return a;
    });
    var CAT = {};
    Object.keys(D.cs || {}).forEach(function (cls) {
      var a = grid();
      D.cs[cls].forEach(function (r) { a[r[0]][r[1]] = { code: r[2], subj: r[3], tis: r[4], room: r[5] }; });
      CAT[cls] = a;
    });
    var DUTY = {};
    Object.keys(D.duty || {}).forEach(function (ti) {
      DUTY[ti] = {};
      D.duty[ti].forEach(function (x) { (DUTY[ti][x[0]] = DUTY[ti][x[0]] || {})[x[1]] = x[2]; });
    });
    var byName = {};
    D.teachers.forEach(function (t, i) { byName[t.n] = i; });
    var idx = { TAT: TAT, CAT: CAT, DUTY: DUTY, byName: byName };
    Object.defineProperty(D, '__idx', { value: idx, enumerable: false, configurable: true });
    return idx;
  }

  function create(D, requests, settings, today) {
    var X = index(D), TAT = X.TAT, CAT = X.CAT, DUTY = X.DUTY;
    var NT = {}; (D.noCover || []).forEach(function (c) { NT[c] = 1; });
    var ACT = {}; (D.activity || []).forEach(function (c) { ACT[c] = 1; });
    var st = settings;
    var K = function (t, d, p) { return t + '|' + d + '|' + p; };
    var gOf = function (ti) { return D.teachers[ti] ? D.teachers[ti].g : -1; };
    var levelOf = function (cls) { var m = String(cls).match(/^ม\.\d/); return m ? m[0] : ''; };

    function isSchool(s) { return wd(s) >= 0 && st.holidays.indexOf(s) < 0 && s >= st.termStart && s <= st.termEnd; }
    function schoolDays(a, b) { var r = []; for (var s = a, n = 0; s <= b && n < 400; s = addD(s, 1), n++) if (isSchool(s)) r.push(s); return r; }
    function maxDate() { return minStr(addD(today, st.maxAhead), st.termEnd); }
    function minStart(type, privileged) { return (type === 'sick' || privileged) ? maxStr(today, st.termStart) : maxStr(addD(today, st.leadDays), st.termStart); }
    function nthSchool(k) {
      var s = maxStr(today, st.termStart), n = 0, g = 0;
      if (k >= 0) { while (!isSchool(s) && g++ < 400) s = addD(s, 1); while (n < k && g++ < 400) { s = addD(s, 1); if (isSchool(s)) n++; } return g >= 400 ? today : s; }
      while (n > k && g++ < 400) { s = addD(s, -1); if (s < st.termStart) return null; if (isSchool(s)) n--; }
      return s;
    }

    function leaveCovers(r, d, p) {
      if (r.dates.indexOf(d) < 0) return false;
      var s = r.slots && r.slots[d];
      return !s || p == null || s.indexOf(p) >= 0;
    }
    function active(r) { return r.status !== 'cancelled'; }

    /* occupancy: ใครไม่อยู่/ถูกจัด/ถูกสลับออก ณ ช่องใด (รวมคำขอที่รอรับทราบ เพื่อกันจองซ้ำ) */
    function occupancy(extra, skipItem) {
      var O = { leave: {}, occ: {}, freed: {}, classIn: {} };
      var reqs = requests.filter(function (r) { return !(extra && r.id === extra.id); });
      if (extra) reqs = reqs.concat([extra]);
      reqs.forEach(function (r) {
        if (!active(r)) return;
        r.dates.forEach(function (d) { (O.leave[r.teacher + '|' + d] = O.leave[r.teacher + '|' + d] || []).push(r); });
        r.items.forEach(function (it) {
          if (it === skipItem || (skipItem && r === extra && it.id === skipItem.id)) return;
          if (it.ack === 'declined' || !it.method || it.method === 'none') return;
          var s = it.swap;
          if (it.method === 'sub') O.occ[K(it.sub, it.date, it.p)] = { t: 'สอนแทน', cls: it.cls, r: r, it: it };
          else if (it.method === 'swapT') {
            O.occ[K(s.t, it.date, it.p)] = { t: 'สลับคาบ', cls: it.cls, r: r, it: it };
            O.freed[K(s.t, s.date, s.p)] = r;
            O.occ[K(r.teacher, s.date, s.p)] = { t: 'สลับคาบ', cls: it.cls, r: r, it: it };
          } else if (it.method === 'swapF') {
            O.occ[K(r.teacher, s.date, s.p)] = { t: 'สอนชดเชย', cls: it.cls, r: r, it: it };
            O.classIn[it.cls + '|' + s.date + '|' + s.p] = r;
          }
        });
      });
      return O;
    }
    function leaveAt(O, ti, d, p) {
      var L = O.leave[ti + '|' + d]; if (!L) return null;
      for (var i = 0; i < L.length; i++) if (leaveCovers(L[i], d, p)) return L[i];
      return null;
    }
    function busy(ti, d, p, O) {
      var L = leaveAt(O, ti, d, p);
      if (L) return { kind: 'leave', why: TYPES[L.type].label + (L.slots && L.slots[d] ? ' (บางคาบ)' : '') + 'ในวันนี้' };
      var o = O.occ[K(ti, d, p)];
      if (o) return { kind: 'sub', why: 'ถูกจัด' + o.t + ' ' + o.cls + ' ให้ ' + shortName(o.r.teacher) + ' แล้ว' };
      var w = wd(d), e = w >= 0 && TAT[ti] && TAT[ti][w][p];
      if (e && !O.freed[K(ti, d, p)]) {
        if (NT[e.code]) return { kind: 'meet', why: 'ติด ' + e.subj, meet: e.subj };   // ประชุม/PLC: จัดสอนแทนได้ แต่ต้องเตือน
        return { kind: 'base', why: 'มีสอน ' + e.code + ' ' + e.cls };
      }
      return null;
    }
    /* คาบประชุม/PLC ของครู ณ ช่องนั้น (ถ้ามี) — ใช้แสดงคำเตือน */
    function meetingAt(ti, d, p) {
      var w = wd(d), e = w >= 0 && TAT[ti] && TAT[ti][w][p];
      return e && NT[e.code] ? e.subj : null;
    }
    function shortName(ti) {
      var t = D.teachers[ti]; if (!t) return '?';
      return t.n.replace(/^(ว่าที่ร้อยตรี|ว่าที่ ร\.ต\.|สิบเอก|นางสาว|นาง|นาย|Mr\.\s?|Ms\.\s?|Mrs\.\s?)/, '');
    }
    function dayLoad(ti, d, O) {
      var w = wd(d), base = 0, extra = 0;
      for (var p = 1; p <= 9; p++) {
        var e = TAT[ti] && TAT[ti][w][p];
        if (O.occ[K(ti, d, p)]) extra++;
        else if (e && !NT[e.code] && !O.freed[K(ti, d, p)]) base++;
      }
      return { base: base, extra: extra, total: base + extra };
    }
    function cumSubs() {
      var c = {};
      requests.forEach(function (r) {
        if (!active(r)) return;
        r.items.forEach(function (it) {
          if (it.ack === 'declined') return;
          if (it.method === 'sub') c[it.sub] = (c[it.sub] || 0) + 1;
          if (it.method === 'swapT') c[it.swap.t] = (c[it.swap.t] || 0) + 1;
        });
      });
      return c;
    }

    /* ---------- ตัวเลือก: ครูสอนแทน ---------- */
    function candSub(req, item) {
      var O = occupancy(req, item), C = cumSubs(), g = gOf(req.teacher), w = wd(item.date);
      var avail = [], blocked = [], dec = item.declinedBy || [];
      D.teachers.forEach(function (t, ti) {
        if (ti === req.teacher) return;
        if (dec.indexOf(ti) >= 0) { blocked.push({ ti: ti, same: t.g === g, why: 'ขอเปลี่ยนคาบนี้ไปแล้ว' }); return; }
        var b = busy(ti, item.date, item.p, O);
        if (!b || b.kind === 'meet') avail.push({ ti: ti, same: t.g === g, load: dayLoad(ti, item.date, O), cum: C[ti] || 0,
          duty: DUTY[ti] && DUTY[ti][w] && DUTY[ti][w][item.p], meet: b ? b.meet : null });
        else if (b.kind !== 'base') blocked.push({ ti: ti, same: t.g === g, why: b.why });
      });
      // กลุ่มสาระเดียวกันก่อน → ครูที่ว่างจริงก่อนครูที่ติดประชุม → คาบสอนวันนั้นน้อย→มาก → สอนแทนสะสม
      avail.sort(function (a, b) {
        return (b.same - a.same) || ((a.meet ? 1 : 0) - (b.meet ? 1 : 0)) || (a.load.total - b.load.total) || (a.cum - b.cum) ||
          D.teachers[a.ti].n.localeCompare(D.teachers[b.ti].n, 'th');
      });
      blocked.sort(function (a, b) { return b.same - a.same; });
      return { avail: avail, blocked: blocked };
    }
    function swapWindow(item) {
      var from = maxStr(addD(today, 1), addD(item.date, -7));
      var to = minStr(maxDate(), addD(item.date, 14));
      return from <= to ? schoolDays(from, to) : [];
    }
    /* ---------- ตัวเลือก: สลับคาบกับครูอื่น (ครูที่สอนห้องเดียวกัน) ---------- */
    function candSwapT(req, item) {
      if (!CAT[item.cls]) return { err: 'คาบนี้เป็นกลุ่มเรียนรวม/กิจกรรม (ไม่ใช่ห้องเรียนปกติ) จึงสลับคาบกับครูอื่นไม่ได้', list: [] };
      var O = occupancy(req, item), g = gOf(req.teacher), list = [];
      swapWindow(item).forEach(function (d) {
        var w = wd(d);
        for (var p = 1; p <= 9; p++) {
          var ce = CAT[item.cls][w][p];
          if (!ce || NT[ce.code] || ACT[ce.code] || ce.tis.length !== 1 || ce.tis[0] === req.teacher) continue;
          var B = ce.tis[0];
          if (O.freed[K(B, d, p)] || leaveAt(O, B, d, p)) continue;
          if ((item.declinedBy || []).indexOf(B) >= 0) continue;
          if (busy(B, item.date, item.p, O)) continue;
          if (busy(req.teacher, d, p, O)) continue;
          list.push({ t: B, date: d, p: p, code: ce.code, subj: ce.subj, same: gOf(B) === g });
        }
      });
      list.sort(function (a, b) {
        return Math.abs(diffDays(item.date, a.date)) - Math.abs(diffDays(item.date, b.date)) || (b.same - a.same) || a.p - b.p;
      });
      return { list: list };
    }
    /* ---------- ตัวเลือก: สลับคาบว่าง (ย้ายไปคาบที่ห้องว่าง + ครูว่าง) ---------- */
    function candSwapF(req, item) {
      if (!CAT[item.cls]) return { err: 'คาบนี้เป็นกลุ่มเรียนรวม/กิจกรรม จึงย้ายไปคาบว่างไม่ได้', list: [] };
      var O = occupancy(req, item), lunch = (D.lunch || {})[levelOf(item.cls)], list = [];
      swapWindow(item).forEach(function (d) {
        var w = wd(d);
        for (var p = 1; p <= 9; p++) {
          if (CAT[item.cls][w][p] || p === lunch) continue;
          if (O.classIn[item.cls + '|' + d + '|' + p]) continue;
          if (busy(req.teacher, d, p, O)) continue;
          list.push({ date: d, p: p });
        }
      });
      list.sort(function (a, b) { return Math.abs(diffDays(item.date, a.date)) - Math.abs(diffDays(item.date, b.date)) || a.p - b.p; });
      return { list: list };
    }
    /* ครูร่วมสอน/ร่วมกิจกรรมในคาบเดียวกัน ที่ไม่ได้ลา */
    function coTeachers(req, item) {
      var w = wd(item.date), O = occupancy(req, item), out = [];
      if (ACT[item.code]) {
        D.teachers.forEach(function (t, ti) {
          var e = TAT[ti] && TAT[ti][w][item.p];
          if (ti !== req.teacher && e && e.code === item.code && !leaveAt(O, ti, item.date, item.p)) out.push(ti);
        });
        return out;
      }
      var ce = CAT[item.cls] && CAT[item.cls][w][item.p];
      if (!ce || ce.code !== item.code) return [];
      return ce.tis.filter(function (t) { return t !== req.teacher && !leaveAt(O, t, item.date, item.p); });
    }
    function allowNone(req, item) { return !!NT[item.code] || !!ACT[item.code] || coTeachers(req, item).length > 0; }

    function buildItems(teacher, dates, slots) {
      var items = [];
      dates.forEach(function (d) {
        var w = wd(d); if (w < 0) return;
        for (var p = 1; p <= 9; p++) {
          var e = TAT[teacher] && TAT[teacher][w][p];
          if (!e) continue;
          if (slots && slots[d] && slots[d].indexOf(p) < 0) continue;
          items.push({ id: d + '-' + p, date: d, p: p, code: e.code, subj: e.subj, cls: e.cls, room: e.room,
            method: NT[e.code] ? 'none' : null, ack: null });
        }
      });
      return items;
    }

    /* ---------- สถานะ ---------- */
    function ackNeeded(it) { return it.method === 'sub' || it.method === 'swapT'; }
    function ackWho(it) { return it.method === 'sub' ? it.sub : it.method === 'swapT' ? it.swap.t : null; }
    function coverItems(r) { return r.items.filter(function (i) { return !NT[i.code]; }); }
    function rst(r) {
      if (r.status === 'cancelled' || r.status === 'approved' || r.status === 'returned') return r.status;
      if (r.items.some(function (i) { return i.ack === 'declined'; })) return 'fix';
      if (r.items.some(function (i) { return i.ack === 'pending'; })) return 'ack';
      return 'review';
    }

    /* ---------- ตรวจความถูกต้องของตัวเลือกรายคาบ (server ใช้ก่อนบันทึก) ---------- */
    function checkItem(req, it) {
      var ok;
      if (!it.method) return 'ยังไม่ได้เลือกวิธีจัด';
      if (it.method === 'none') return allowNone(req, it) ? null : 'คาบนี้ไม่มีครูร่วมสอน ต้องเลือกวิธีจัด';
      if (it.method === 'sub') {
        ok = candSub(req, it).avail.some(function (a) { return a.ti === it.sub; });
        return ok ? null : (D.teachers[it.sub] ? D.teachers[it.sub].n : 'ครูที่เลือก') + ' ไม่ว่างแล้วในคาบนี้ (อาจถูกจัดโดยผู้อื่นเมื่อสักครู่)';
      }
      if (it.method === 'swapT') {
        ok = it.swap && candSwapT(req, it).list.some(function (o) { return o.t === it.swap.t && o.date === it.swap.date && o.p === it.swap.p; });
        return ok ? null : 'ตัวเลือกสลับคาบนี้ใช้ไม่ได้แล้ว โปรดเลือกใหม่';
      }
      if (it.method === 'swapF') {
        ok = it.swap && candSwapF(req, it).list.some(function (o) { return o.date === it.swap.date && o.p === it.swap.p; });
        return ok ? null : 'คาบว่างที่เลือกใช้ไม่ได้แล้ว โปรดเลือกใหม่';
      }
      return 'วิธีจัดไม่ถูกต้อง';
    }

    /* actor: {ti, privileged, headGroups:[g]} · draft: {id?, type, teacher, dates, slots, items:[{id,method,sub,swap}]}
       คืน {errors:[], req} — req คือคำขอที่สร้างใหม่จากตารางจริง (ไม่เชื่อข้อมูลวิชา/ห้องจากหน้าเว็บ) */
    function validateDraft(draft, actor) {
      var errors = [];
      if (!TYPES[draft.type]) errors.push('ไม่ได้เลือกกรณีการลา');
      if (!D.teachers[draft.teacher]) errors.push('ไม่พบชื่อครูผู้ลา');
      if (errors.length) return { errors: errors };
      var own = actor.ti === draft.teacher;
      var head = (actor.headGroups || []).indexOf(gOf(draft.teacher)) >= 0;
      if (!actor.privileged && !own && !(draft.type === 'sick' && head))
        errors.push(head ? 'หัวหน้ากลุ่มสาระฯ จัดสอนแทนให้ครูในกลุ่มได้เฉพาะกรณีลาป่วย' : 'ไม่มีสิทธิ์จัดสอนแทนให้ครูท่านนี้');
      var dates = (draft.dates || []).slice().sort().filter(function (d, i, a) { return a.indexOf(d) === i; });
      if (!dates.length) errors.push('ไม่ได้เลือกวันที่');
      var ms = minStart(draft.type, actor.privileged), mx = maxDate();
      dates.forEach(function (d) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) errors.push('รูปแบบวันที่ไม่ถูกต้อง: ' + d);
        else if (!isSchool(d)) errors.push(d + ' ไม่ใช่วันเรียน');
        else if (d < ms) errors.push(TYPES[draft.type].label + ' ต้องจัดล่วงหน้า (เริ่มได้ ' + ms + ')');
        else if (d > mx) errors.push('จัดล่วงหน้าได้ไม่เกิน ' + st.maxAhead + ' วัน และไม่เกินวันปิดภาคเรียน (' + mx + ')');
      });
      var slots = null;
      if (draft.slots) {
        slots = {};
        Object.keys(draft.slots).forEach(function (d) {
          if (dates.indexOf(d) < 0) return;
          var ps = (draft.slots[d] || []).map(Number).filter(function (p) { return p >= 1 && p <= 9; });
          if (!ps.length) errors.push('ลาบางคาบ ' + d + ' ต้องเลือกอย่างน้อย 1 คาบ');
          slots[d] = ps.sort(function (a, b) { return a - b; });
        });
        if (!Object.keys(slots).length) slots = null;
      }
      if (errors.length) return { errors: unique(errors) };

      // ห้ามลาซ้อนกับคำขอเดิมของตัวเอง
      requests.forEach(function (r) {
        if (!active(r) || r.teacher !== draft.teacher || r.id === draft.id) return;
        dates.forEach(function (d) {
          if (r.dates.indexOf(d) < 0) return;
          var mine = slots && slots[d], theirs = r.slots && r.slots[d];
          var overlap = !mine || !theirs || mine.some(function (p) { return theirs.indexOf(p) >= 0; });
          if (overlap) errors.push('มีคำขอ ' + r.id + ' ในวันที่ ' + d + ' อยู่แล้ว');
        });
      });
      if (errors.length) return { errors: unique(errors) };

      var req = { id: draft.id || '(new)', type: draft.type, teacher: draft.teacher, dates: dates, slots: slots,
        status: 'open', items: buildItems(draft.teacher, dates, slots) };
      var chosen = {};
      (draft.items || []).forEach(function (i) { chosen[i.id] = i; });
      req.items.forEach(function (it) {
        if (NT[it.code]) return;
        var c = chosen[it.id] || {};
        it.method = c.method || null;
        if (it.method === 'sub') it.sub = +c.sub;
        if (it.method === 'swapT' && c.swap) it.swap = { t: +c.swap.t, date: c.swap.date, p: +c.swap.p, code: c.swap.code, subj: c.swap.subj };
        if (it.method === 'swapF' && c.swap) it.swap = { date: c.swap.date, p: +c.swap.p };
        if (c.declinedBy) it.declinedBy = c.declinedBy.slice();
        it.ack = ackNeeded(it) ? 'pending' : null;
      });
      // ใช้ข้อมูลจริงของคาบสลับจากตาราง
      req.items.forEach(function (it) {
        if (it.method === 'swapT' && it.swap && CAT[it.cls]) {
          var ce = CAT[it.cls][wd(it.swap.date)] && CAT[it.cls][wd(it.swap.date)][it.swap.p];
          if (ce) { it.swap.code = ce.code; it.swap.subj = ce.subj; }
        }
      });
      req.items.forEach(function (it) {
        if (NT[it.code]) return;
        var e = checkItem(req, it);
        if (e) errors.push(it.date + ' คาบ ' + it.p + ' (' + it.cls + '): ' + e);
      });
      return { errors: unique(errors), req: req };
    }
    function unique(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

    /* ภาระสอนแทนของผู้ลาเองที่ตกอยู่ในช่วงลา (เพื่อเตือน) */
    function ownDutyConflicts(r) {
      var out = [];
      requests.forEach(function (q) {
        if (!active(q) || q.id === r.id) return;
        q.items.forEach(function (it) {
          if (it.ack === 'declined') return;
          if (ackWho(it) === r.teacher && leaveCovers(r, it.date, it.p)) out.push({ r: q, it: it, date: it.date, p: it.p });
          if ((it.method === 'swapT' || it.method === 'swapF') && q.teacher === r.teacher && leaveCovers(r, it.swap.date, it.swap.p))
            out.push({ r: q, it: it, date: it.swap.date, p: it.swap.p });
        });
      });
      return out;
    }

    return {
      D: D, TAT: TAT, CAT: CAT, DUTY: DUTY, NT: NT, ACT: ACT, today: today, settings: st,
      gOf: gOf, levelOf: levelOf, shortName: shortName,
      isSchool: isSchool, schoolDays: schoolDays, maxDate: maxDate, minStart: minStart, nthSchool: nthSchool,
      occupancy: occupancy, busy: busy, meetingAt: meetingAt, leaveAt: leaveAt, leaveCovers: leaveCovers, dayLoad: dayLoad, cumSubs: cumSubs,
      candSub: candSub, candSwapT: candSwapT, candSwapF: candSwapF, coTeachers: coTeachers, allowNone: allowNone,
      buildItems: buildItems, ackNeeded: ackNeeded, ackWho: ackWho, coverItems: coverItems, rst: rst,
      checkItem: checkItem, validateDraft: validateDraft, ownDutyConflicts: ownDutyConflicts
    };
  }

  return { create: create, index: index, TYPES: TYPES, METHODS: METHODS, STATUS: STATUS,
    pd: pd, isoOf: isoOf, addD: addD, wd: wd, diffDays: diffDays, pad: pad };
})();
if (typeof module !== 'undefined') module.exports = SubEngine;
