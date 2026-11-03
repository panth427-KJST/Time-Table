/* =====================================================================
   โหมดทดลอง: รันโค้ด server (Code.gs) ตัวจริงในเบราว์เซอร์ บน Google Sheet จำลอง
   และสร้างข้อมูลตัวอย่างผ่าน API จริง (ผ่านการตรวจสอบเหมือนระบบจริงทุกขั้น)
   ===================================================================== */
var DemoSeed = (function () {
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var uname = function (ti) { return 't' + ('00' + (ti + 1)).slice(-3); };

  /* สร้างไฟล์ e-Score จำลอง + ฐานข้อมูล + ข้อมูลตัวอย่าง */
  function seed(F, TT) {
    F.addBook('DB', {}); F.state.active = 'DB';
    var users = [['username', 'password', 'name', 'email']];
    TT.teachers.forEach(function (t, i) { users.push([uname(i), '1234', t.n, '']); });
    users.push(['acad', '1234', 'หัวหน้ากลุ่มบริหารงานวิชาการ (บัญชีทดลอง)', '']);
    F.addBook('ESCORE', { Users: users });
    setup();
    var heads = {}, headTi = {};
    TT.groups.forEach(function (g, gi) {
      var m = TT.teachers.map(function (t, ti) { return { n: t.n, ti: ti, g: t.g }; })
        .filter(function (t) { return t.g === gi && TT.ts[t.ti].length; })
        .sort(function (a, b) { return a.n.localeCompare(b.n, 'th'); });
      if (m.length) { heads[g] = m[0].n; headTi[gi] = m[0].ti; }
    });
    saveSettings_({ ESCORE_SPREADSHEET_ID: 'ESCORE', ACAD_USERS: 'acad', ADMIN_USERS: 'acad', DEPT_HEADS: JSON.stringify(heads) });

    var tok = {}, login = function (u) { if (!tok[u]) { var r = apiLogin(u, '1234'); if (!r.ok) throw new Error(r.error); tok[u] = r.token; } return tok[u]; };
    var rnd = mulberry(2569), used = {};
    var c0 = ctx_(), E0 = c0.E, D = c0.D;
    function pickTeacher(d, min) {
      var w = SubEngine.wd(d);
      var list = D.teachers.map(function (t, ti) { return ti; }).filter(function (ti) {
        return !used[ti] && E0.TAT[ti][w].filter(function (e, p) { return p > 0 && e && !E0.NT[e.code] && !E0.ACT[e.code]; }).length >= (min || 4);
      });
      var ti = list[Math.floor(rnd() * list.length)]; used[ti] = 1; return ti;
    }
    function draft(type, teacher, dates, opt) {
      opt = opt || {};
      var E = ctx_().E, req = { id: '(seed)', type: type, teacher: teacher, dates: dates, slots: opt.slots || null, status: 'open', items: E.buildItems(teacher, dates, opt.slots || null) };
      var k = 0;
      req.items.forEach(function (it) {
        if (E.NT[it.code]) return;
        if (E.ACT[it.code]) { it.method = 'none'; return; }
        var want = (opt.methods || [])[k++] || 'sub', c;
        if (want === 'swapT') { c = E.candSwapT(req, it); if (c.list.length) { it.method = 'swapT'; it.swap = c.list[0]; return; } }
        if (want === 'swapF') { c = E.candSwapF(req, it); if (c.list.length) { it.method = 'swapF'; it.swap = c.list[0]; return; } }
        c = E.candSub(req, it);
        if (c.avail.length) { it.method = 'sub'; it.sub = c.avail[Math.min(c.avail.length - 1, opt.skip || 0)].ti; return; }
        c = E.candSwapF(req, it);
        if (c.list.length) { it.method = 'swapF'; it.swap = c.list[0]; return; }
        it.method = 'none';
      });
      return { type: type, teacher: teacher, dates: dates, slots: opt.slots || null, reason: opt.reason || '', file: opt.file || null,
        items: req.items.map(function (i) { return { id: i.id, method: i.method, sub: i.sub, swap: i.swap }; }) };
    }
    function submit(asTi, d) {
      var r = apiSubmit(login(asTi == null ? 'acad' : uname(asTi)), d);
      if (!r.ok) throw new Error('seed submit: ' + r.error);
      return r.data.id;
    }
    function req(id) { return ctx_().requests.filter(function (r) { return r.id === id; })[0]; }
    function ackAll(id, except) {
      var E = ctx_().E;
      req(id).items.forEach(function (it) { var w = E.ackWho(it); if (it.ack === 'pending' && w !== except) apiAck(login(uname(w)), id, [it.id]); });
    }
    var acad = function () { return login('acad'); };
    var n = function (k) { return E0.nthSchool(k); };
    var demo = {};

    // 1) ลาป่วยวันนี้ — หัวหน้ากลุ่มสาระฯ จัดให้ → รับทราบครบ → เห็นชอบ
    var t1 = pickTeacher(n(0)), h1 = headTi[D.teachers[t1].g];
    if (h1 == null || h1 === t1) h1 = null;
    var id1 = submit(h1 != null ? h1 : t1, draft('sick', t1, [n(0)], { reason: 'ไข้หวัด มีใบรับรองแพทย์' }));
    ackAll(id1); apiApprove(acad(), [id1]);
    demo.head = h1 != null ? h1 : headTi[0];
    // 2) ติดภารกิจพรุ่งนี้ — มีผู้ขอเปลี่ยน 1 คาบ (ต้องจัดใหม่)
    var t2 = pickTeacher(n(1)), id2 = submit(t2, draft('mission', t2, [n(1)], { reason: 'นำนักเรียนแข่งขันทักษะวิชาการ' }));
    var r2 = req(id2), E = ctx_().E, dec = r2.items.filter(function (i) { return i.ack === 'pending'; })[0];
    if (dec) { apiDecline(login(uname(E.ackWho(dec))), id2, dec.id, 'ติดคุมสอบกลางภาค ม.6 คาบนี้'); ackAll(id2, E.ackWho(dec)); }
    demo.fixOwner = t2;
    // 3) ไปราชการ — ใช้ทั้ง 3 วิธี รับทราบครบ รอเห็นชอบ
    var t3 = pickTeacher(n(2)), id3 = submit(t3, draft('official', t3, [n(2)], { methods: ['swapF', 'swapT', 'sub'], reason: 'อบรมเชิงปฏิบัติการ สพม.สุราษฎร์ธานี ชุมพร', file: { name: 'หนังสือขอความอนุเคราะห์.pdf', url: '#' } }));
    ackAll(id3);
    // 4) ลากิจ — รอรับทราบ (ครูตัวอย่างอยู่ในนี้)
    var t4 = pickTeacher(n(3)), id4 = submit(t4, draft('personal', t4, [n(3)], { reason: 'งานบวชบุตรชาย' }));
    E = ctx_().E;
    var first = req(id4).items.filter(function (i) { return i.ack === 'pending'; })[0];
    demo.teacher = first ? E.ackWho(first) : 0;
    req(id4).items.filter(function (i) { return i.ack === 'pending' && E.ackWho(i) !== demo.teacher; }).slice(0, 1)
      .forEach(function (i) { apiAck(login(uname(E.ackWho(i))), id4, [i.id]); });
    // 5) ไปราชการ 2 วัน — สมบูรณ์
    var t5 = pickTeacher(n(5)), id5 = submit(t5, draft('official', t5, [n(5), n(6)], { methods: ['sub', 'swapT'], reason: 'ประชุมสัมมนาครูฟิสิกส์ระดับภูมิภาค', file: { name: 'คำสั่งไปราชการ.pdf', url: '#' } }));
    ackAll(id5); apiApprove(acad(), [id5]);
    // 6) ลากิจครึ่งวัน (บางคาบ) — รอเห็นชอบ
    var d6 = n(8), t6 = pickTeacher(d6, 5), w6 = SubEngine.wd(d6);
    var ps = []; for (var p = 1; p <= 4; p++) if (E0.TAT[t6][w6][p]) ps.push(p);
    if (!ps.length) ps = [1, 2, 3, 4];
    var sl = {}; sl[d6] = ps;
    var id6 = submit(t6, draft('personal', t6, [d6], { slots: sl, reason: 'ลาครึ่งวันเช้า พาบิดาไปพบแพทย์ตามนัด', skip: 1 }));
    ackAll(id6);
    // 7) ติดภารกิจ — สมบูรณ์
    var t7 = pickTeacher(n(4)), id7 = submit(t7, draft('mission', t7, [n(4)], { reason: 'กรรมการตัดสินการแข่งขันศิลปหัตถกรรม' }));
    ackAll(id7); apiApprove(acad(), [id7]);

    Object.keys(tok).forEach(function (u) { apiLogout(tok[u]); });
    F.state.demo = {
      accounts: [
        { u: uname(demo.teacher), label: 'ครูผู้สอน', note: D.teachers[demo.teacher].n + ' · มีคาบรอรับทราบ' },
        { u: uname(demo.fixOwner), label: 'ครูที่ต้องจัดสอนแทนใหม่', note: D.teachers[demo.fixOwner].n + ' · มีผู้ขอเปลี่ยน' },
        { u: uname(demo.head), label: 'หัวหน้ากลุ่มสาระฯ', note: D.teachers[demo.head].n + ' · จัดกรณีลาป่วยให้ครูในกลุ่ม' },
        { u: 'acad', label: 'หัวหน้ากลุ่มบริหารงานวิชาการ', note: 'เห็นชอบ · สถิติ · ตั้งค่า' }
      ]
    };
    F.persist();
  }
  return { seed: seed, uname: uname };
})();

/* ---------- เริ่มโหมดทดลองในเบราว์เซอร์ ---------- */
if (typeof window !== 'undefined' && window.__TT__) {
  (function () {
    var KEY = 'kjst-sub-demo-v2';
    var F = FakeGAS.create({
      load: function () { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } },
      save: function (s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* storage เต็ม/ถูกปิด — ใช้ในหน่วยความจำ */ } },
      files: { TimetableData: JSON.stringify(window.__TT__) }
    });
    Object.keys(F.globals).forEach(function (k) { window[k] = F.globals[k]; });
    if (!F.hasBook('DB')) DemoSeed.seed(F, window.__TT__);
    window.DEMO = true;
    window.DEMO_ACCOUNTS = (F.state.demo || {}).accounts || [];
    window.google = { script: { run: FakeGAS.makeRun(window, F.persist, 60) } };
    window.demoReset = function () { try { localStorage.removeItem(KEY); localStorage.removeItem('kjst-sub-token'); } catch (e) {} location.reload(); };
  })();
}
if (typeof module !== 'undefined') module.exports = DemoSeed;
