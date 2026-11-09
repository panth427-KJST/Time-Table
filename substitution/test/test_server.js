/* ทดสอบ server (Code.gs) ด้วย Google services จำลอง:  node substitution/test/test_server.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
const TT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'timetable-2-2569.json'), 'utf8'));
const FakeGAS = require(path.join(SRC, 'fakegas.js'));

let pass = 0, fail = 0;
function ok(cond, name, extra) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); } }

function boot() {
  const F = FakeGAS.create({ files: { TimetableData: JSON.stringify(TT) } });
  const ctx = vm.createContext(Object.assign({ console }, F.globals));
  for (const f of ['engine.js', 'importer.js', 'server.js', 'demo_boot.js']) vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  ctx.F = F;
  return ctx;
}

/* ---------------------------------------------------------------- 1. ติดตั้ง + ข้อมูลตัวอย่าง */
console.log('1) setup + ข้อมูลตัวอย่างผ่าน API จริง');
const G = boot();
G.DemoSeed.seed(G.F, TT);
let c = G.ctx_();
ok(c.D.teachers.length === 77, 'นำเข้าครู 77 คน');
ok(c.D.ts.reduce((s, x) => s + x.length, 0) === 2060, 'นำเข้าคาบสอน 2060 ช่อง');
ok(c.requests.length === 7, 'สร้างคำขอตัวอย่าง 7 รายการ', c.requests.length);
const sts = c.requests.map(r => c.E.rst(r));
ok(sts.includes('approved') && sts.includes('review') && sts.includes('ack') && sts.includes('fix'), 'มีครบทุกสถานะ', sts.join(','));
ok(c.requests.some(r => r.slots), 'มีคำขอลาบางคาบ');
const items = G.readRows_('items');
ok(items.length === c.requests.reduce((s, r) => s + r.items.length, 0), 'ชีต Items บันทึกครบทุกคาบ');
ok(G.readRows_('log').length > 10, 'บันทึก Log');

/* ---------------------------------------------------------------- 2. เข้าสู่ระบบ */
console.log('2) เข้าสู่ระบบด้วยชีต Users ของ e-Score');
const H = boot();
H.F.addBook('DB', {});
const users = [['ชื่อผู้ใช้', 'รหัสผ่าน', 'ชื่อ-สกุล', 'อีเมล']];
TT.teachers.forEach((t, i) => users.push(['u' + i, i === 1 ? H.F.sha256hex('secret') : 'pw' + i, t.n.replace(/^นางสาว/, 'น.ส. '), 'u' + i + '@kjst.ac.th']));
users.push(['boss', 'pw', 'ผู้อำนวยการ ทดสอบ', '']);
H.F.addBook('ESC', { Users: users });
H.setup();
H.saveSettings_({ ESCORE_SPREADSHEET_ID: 'ESC', ACAD_USERS: 'boss', ADMIN_USERS: 'boss' });
let r = H.apiLogin('u0', 'wrong');
ok(!r.ok && /ไม่ถูกต้อง/.test(r.error), 'รหัสผิด → ปฏิเสธ');
r = H.apiLogin('U0', 'pw0');
ok(r.ok && r.me.ti === 0, 'ชื่อผู้ใช้ไม่สนตัวพิมพ์ + จับคู่ชื่อครูได้', JSON.stringify(r.me));
r = H.apiLogin('u1', 'secret');
ok(r.ok, 'รหัสผ่านแบบ SHA-256 hex ใช้ได้');
const nsIdx = TT.teachers.findIndex(t => t.n.startsWith('นางสาว'));
r = H.apiLogin('u' + nsIdx, 'pw' + nsIdx);
ok(r.ok && r.me.ti === nsIdx, 'จับคู่ชื่อได้แม้คำนำหน้าต่าง (น.ส./นางสาว)');
for (let i = 0; i < 5; i++) H.apiLogin('u5', 'bad');
r = H.apiLogin('u5', 'pw5');
ok(!r.ok && /10 นาที/.test(r.error), 'ผิด 5 ครั้ง → ล็อก 10 นาที');
r = H.apiLogin('boss', 'pw');
ok(r.ok && r.me.ti === null && r.me.roles.includes('acad'), 'บัญชีหัวหน้าวิชาการที่ไม่ใช่ครู');
ok(!H.apiBootstrap('bad-token').ok && H.apiBootstrap('bad-token').auth, 'token ไม่ถูกต้อง → ให้เข้าสู่ระบบใหม่');
const bossTok = r.token;
r = H.apiBootstrap(bossTok);
ok(r.ok && r.D.teachers.length === 77 && r.settings.termStart === '2026-10-28' && r.settings.termEnd === '2027-02-26', 'bootstrap + วันเปิด/ปิดภาค 28 ต.ค. 69 – 26 ก.พ. 70');

/* ---------------------------------------------------------------- 3. กฎและการตรวจซ้ำที่ server */
console.log('3) กฎการจัด + กันจองซ้ำ');
const tok = i => H.apiLogin('u' + i, i === 1 ? 'secret' : 'pw' + i).token;
c = H.ctx_(); let E = c.E;
const d0 = E.nthSchool(0), d1 = E.nthSchool(1), d2 = E.nthSchool(2);
function teachersOn(d, min) { const w = H.SubEngine.wd(d); return TT.teachers.map((t, i) => i).filter(i => E.TAT[i][w].filter((e, p) => p > 0 && e && !E.NT[e.code] && !E.ACT[e.code]).length >= (min || 3)); }
function mk(E, teacher, type, dates, slots, pickFn) {
  const req = { id: '(t)', type, teacher, dates, slots: slots || null, status: 'open', items: E.buildItems(teacher, dates, slots || null) };
  req.items.forEach(it => {
    if (E.NT[it.code]) return; if (E.ACT[it.code]) { it.method = 'none'; return; }
    const cands = E.candSub(req, it).avail; const s = pickFn ? pickFn(it, cands) : cands[0];
    if (s != null) { it.method = 'sub'; it.sub = typeof s === 'number' ? s : s.ti; }
  });
  return { type, teacher, dates, slots: slots || null, reason: 'test', items: req.items.map(i => ({ id: i.id, method: i.method, sub: i.sub, swap: i.swap })) };
}
const A = teachersOn(d2)[0], B = teachersOn(d2)[1];
r = H.apiSubmit(tok(A), mk(E, A, 'personal', [d0]));
ok(!r.ok && /ล่วงหน้า/.test(r.error), 'ลากิจวันนี้ → ต้องจัดล่วงหน้า', r.error);
r = H.apiSubmit(tok(A), mk(E, A, 'personal', [H.SubEngine.addD(H.today_(), 40)]));
ok(!r.ok, 'เกิน 30 วัน → ปฏิเสธ', r.error);
r = H.apiSubmit(tok(A), mk(E, B, 'personal', [d2]));
ok(!r.ok && /สิทธิ์/.test(r.error), 'จัดให้ครูอื่น (ไม่ใช่หัวหน้า) → ปฏิเสธ', r.error);
r = H.apiSubmit(tok(A), mk(E, A, 'personal', ['2026-12-10']));
ok(!r.ok, 'วันหยุด → ปฏิเสธ');
// หัวหน้ากลุ่มสาระ
const gB = TT.teachers[B].g, headB = TT.teachers.findIndex((t, i) => t.g === gB && i !== B && TT.ts[i].length);
H.saveSettings_({ DEPT_HEADS: JSON.stringify({ [TT.groups[gB]]: TT.teachers[headB].n }) });
const isSchoolToday = E.isSchool(H.today_());
if (isSchoolToday && teachersOn(d0).includes(B)) {
  r = H.apiSubmit(tok(headB), mk(H.ctx_().E, B, 'sick', [d0]));
  ok(r.ok, 'หัวหน้ากลุ่มสาระจัดลาป่วยวันนี้ให้ครูในกลุ่มได้', r.error);
  if (r.ok) H.apiCancel(tok(headB), r.data.id, 'test');
}
r = H.apiSubmit(tok(headB), mk(H.ctx_().E, B, 'personal', [d2]));
ok(!r.ok && /เฉพาะกรณีลาป่วย/.test(r.error), 'หัวหน้ากลุ่มสาระจัดลากิจให้ผู้อื่นไม่ได้', r.error);

// กันจองซ้ำ: A และ B ลาคาบเดียวกัน แล้วเลือกครู X คนเดียวกันพร้อมกัน
c = H.ctx_(); E = c.E;
const wd2 = H.SubEngine.wd(d2);
let pair = null;
const T = teachersOn(d2);
outer: for (const a of T) for (const b of T) if (a < b) for (let p = 1; p <= 9; p++) {
  const ea = E.TAT[a][wd2][p], eb = E.TAT[b][wd2][p];
  if (ea && eb && !E.NT[ea.code] && !E.NT[eb.code] && !E.ACT[ea.code] && !E.ACT[eb.code]) { pair = { a, b, p }; break outer; }
}
ok(!!pair, 'หาครู 2 คนที่สอนคาบเดียวกันได้');
const sl = { [d2]: [pair.p] };
const draftA = mk(E, pair.a, 'official', [d2], sl), X = draftA.items[0].sub;
const draftB = mk(E, pair.b, 'official', [d2], sl, (it, cands) => X);   // B เห็นข้อมูลชุดเดิม (ก่อน A บันทึก) จึงเลือก X เหมือนกัน
r = H.apiSubmit(tok(pair.a), draftA);
ok(r.ok, 'A บันทึก (เลือกครู X)', r.error);
const idA = r.data && r.data.id;
r = H.apiSubmit(tok(pair.b), draftB);
ok(!r.ok && /ไม่ว่างแล้ว/.test(r.error), 'B เลือก X ช่องเดียวกัน → server ปฏิเสธ (กันจองซ้ำ)', r.error);
ok(r.state && r.state.requests.some(q => q.id === idA), 'ส่งข้อมูลล่าสุดกลับให้หน้าเว็บ');
// ลาซ้อนของตัวเอง
r = H.apiSubmit(tok(pair.a), mk(H.ctx_().E, pair.a, 'mission', [d2], sl));
ok(!r.ok && /อยู่แล้ว/.test(r.error), 'ลาซ้อนวันเดียวกัน → ปฏิเสธ', r.error);

// ลาบางคาบ: คาบอื่นของวันเดียวกัน A ยังสอนแทนคนอื่นได้
c = H.ctx_(); E = c.E;
const rA = c.requests.find(q => q.id === idA);
ok(rA.items.length === 1 && rA.items[0].p === pair.p, 'ลาบางคาบ → สร้างรายการเฉพาะคาบที่เลือก');
let freeP = null; for (let p = 1; p <= 9; p++) if (p !== pair.p && !E.TAT[pair.a][wd2][p]) { freeP = p; break; }
if (freeP) ok(!E.busy(pair.a, d2, freeP, E.occupancy(null)), 'A ลาคาบ ' + pair.p + ' แต่ยังว่างคาบ ' + freeP + ' วันเดียวกัน');
ok(!!E.busy(pair.a, d2, pair.p, E.occupancy(null)), 'A ไม่ว่างในคาบที่ลา');

/* ---------------------------------------------------------------- 3b. ครูติดประชุม/PLC */
console.log('3b) จัดครูที่ติดประชุม/PLC ได้ พร้อมคำเตือน');
c = H.ctx_(); E = c.E;
let mcase = null;
for (let k = 2; k < 10 && !mcase; k++) {
  const d = E.nthSchool(k), w = H.SubEngine.wd(d);
  for (const t of teachersOn(d)) {
    if (c.requests.some(q => q.teacher === t && q.dates.includes(d))) continue;
    for (const it of E.buildItems(t, [d])) {
      if (E.NT[it.code] || E.ACT[it.code]) continue;
      const req = { id: '(m)', type: 'official', teacher: t, dates: [d], slots: { [d]: [it.p] }, status: 'open', items: [it] };
      const cs = E.candSub(req, it).avail, m = cs.find(a => a.meet);
      if (m && cs.some(a => !a.meet && a.same === m.same)) { mcase = { t, d, it, m, cs, req }; break; }
    }
    if (mcase) break;
  }
}
ok(!!mcase, 'พบกรณีที่มีครูติดประชุม/PLC ในคาบที่ต้องหาคนแทน');
if (mcase) {
  const { t, d, it, m, cs } = mcase;
  ok(/PLC|ประชุม/.test(m.meet), 'ครูที่ติดประชุมอยู่ในรายชื่อที่จัดได้ พร้อมชื่อการประชุม', m.meet);
  const grp = cs.filter(a => a.same === m.same), lastFree = grp.map(a => !a.meet).lastIndexOf(true), firstMeet = grp.findIndex(a => a.meet);
  ok(lastFree < firstMeet, 'ในกลุ่มเดียวกัน ครูที่ว่างจริงขึ้นก่อนครูที่ติดประชุม');
  ok(E.meetingAt(m.ti, d, it.p) === m.meet, 'meetingAt() คืนชื่อการประชุม');
  r = H.apiSubmit(tok(t), { type: 'official', teacher: t, dates: [d], slots: { [d]: [it.p] }, reason: 'test', items: [{ id: it.id, method: 'sub', sub: m.ti }] });
  ok(r.ok, 'server ยอมรับการจัดครูที่ติดประชุม', r.error);
  c = H.ctx_();
  ok(c.E.busy(m.ti, d, it.p, c.E.occupancy(null)).kind === 'sub', 'หลังจัดแล้ว ครูคนนั้นไม่ว่างในคาบนั้น (กันจองซ้ำ)');
  ok(c.E.dayLoad(m.ti, d, c.E.occupancy(null)).extra >= 1, 'นับเป็นภาระสอนแทนของวันนั้น');
  if (r.ok) H.apiCancel(tok(t), r.data.id, 'test');
  // สลับคาบยังถือว่าคาบประชุมไม่ว่าง
  c = H.ctx_(); E = c.E;
  const sw = E.candSwapT(mcase.req, it).list.concat([]);
  ok(sw.every(o => !E.meetingAt(o.t, d, it.p) && !E.meetingAt(t, o.date, o.p)), 'สลับคาบ: ไม่เลือกคาบที่ติดประชุม (คงเดิม)');
}

/* ---------------------------------------------------------------- 4. รับทราบ / ขอเปลี่ยน / จัดใหม่ / เห็นชอบ */
console.log('4) ขั้นตอนรับทราบ → เห็นชอบ');
const itA = rA.items[0];
r = H.apiAck(tok(pair.b === X ? pair.a : pair.b), idA, [itA.id]);
ok(!r.ok, 'คนอื่นกดรับทราบแทนไม่ได้');
r = H.apiApprove(bossTok, [idA]);
ok(!r.ok, 'ยังไม่รับทราบครบ → เห็นชอบไม่ได้');
r = H.apiDecline(tok(X), idA, itA.id, '');
ok(!r.ok, 'ขอเปลี่ยนต้องระบุเหตุผล');
r = H.apiDecline(tok(X), idA, itA.id, 'ติดประชุม');
ok(r.ok && H.ctx_().E.rst(H.ctx_().requests.find(q => q.id === idA)) === 'fix', 'ขอเปลี่ยน → สถานะต้องจัดใหม่');
r = H.apiFix(tok(pair.a), idA, { id: itA.id, method: 'sub', sub: X });
ok(!r.ok, 'จัดคนเดิมที่ขอเปลี่ยนแล้ว → ปฏิเสธ', r.error);
c = H.ctx_(); E = c.E;
const cl = JSON.parse(JSON.stringify(c.requests.find(q => q.id === idA))), ci = cl.items[0];
ci.declinedBy = [X]; ci.method = null; ci.ack = null;
const Y = E.candSub(cl, ci).avail[0].ti;
r = H.apiFix(tok(pair.a), idA, { id: itA.id, method: 'sub', sub: Y });
ok(r.ok, 'จัดใหม่เป็นครูอีกคน', r.error);
r = H.apiAck(tok(Y), idA, [itA.id]);
c = H.ctx_();
ok(r.ok && c.E.rst(c.requests.find(q => q.id === idA)) === 'review', 'รับทราบครบ → รอเห็นชอบ');
r = H.apiApprove(tok(Y), [idA]);
ok(!r.ok, 'ครูทั่วไปเห็นชอบไม่ได้');
r = H.apiApprove(bossTok, [idA]);
c = H.ctx_();
ok(r.ok && c.E.rst(c.requests.find(q => q.id === idA)) === 'approved', 'หัวหน้าวิชาการเห็นชอบ → สมบูรณ์');
const row = H.readRows_('items').find(x => x.request_id === idA);
ok(row && row.sub_teacher === TT.teachers[Y].n && row.declined_by === TT.teachers[X].n && row.request_status === 'สมบูรณ์', 'ชีต Items เก็บชื่อผู้สอนแทน/ผู้ขอเปลี่ยน/สถานะ');

/* ---------------------------------------------------------------- 5. ยกเลิกคืนเวลาว่าง, ส่งกลับ-แก้ไข */
console.log('5) ยกเลิก / ส่งกลับแก้ไข');
const draftB2 = mk(H.ctx_().E, pair.b, 'official', [d2], sl);
r = H.apiSubmit(tok(pair.b), draftB2); const idB = r.data && r.data.id;
ok(r.ok, 'B ส่งคำขอ');
const Z = draftB2.items[0].sub;
r = H.apiCancel(tok(pair.b), idB, 'เปลี่ยนแผน');
c = H.ctx_();
ok(r.ok && [undefined, null, 'meet'].includes((c.E.busy(Z, d2, pair.p, c.E.occupancy(null)) || {}).kind), 'ยกเลิก → ครูที่ถูกจัดว่างทันที');
r = H.apiSubmit(tok(pair.b), mk(c.E, pair.b, 'official', [d2], sl)); const idB2 = r.data.id;
r = H.apiReturn(tok(pair.b), idB2, 'x');
ok(!r.ok, 'ครูทั่วไปส่งกลับไม่ได้');
r = H.apiReturn(bossTok, idB2, 'แนบคำสั่งไปราชการ');
ok(r.ok, 'หัวหน้าวิชาการส่งกลับแก้ไข');
c = H.ctx_();
const rb = c.requests.find(q => q.id === idB2);
const sub0 = rb.items[0].sub;
H.apiAck(tok(sub0), idB2, [rb.items[0].id]);   // รับทราบไม่ได้แล้วเพราะส่งกลับ? (ยังรับทราบได้ — สถานะคาบยัง pending)
const ed = { editId: idB2, type: 'official', teacher: pair.b, dates: [d2], slots: sl, reason: 'แนบแล้ว', file: { name: 'คำสั่ง.pdf', url: '#' },
  items: rb.items.map(i => ({ id: i.id, method: i.method, sub: i.sub })) };
r = H.apiSubmit(tok(pair.b), ed);
c = H.ctx_();
const rb2 = c.requests.find(q => q.id === idB2);
ok(r.ok && rb2.status === 'open' && rb2.file && rb2.reason === 'แนบแล้ว', 'แก้ไขและส่งใหม่', r.error);
ok(rb2.items[0].ack === 'ack', 'คาบที่ไม่เปลี่ยน คงการรับทราบเดิม');

/* ---------------------------------------------------------------- 6. สลับคาบ */
console.log('6) สลับคาบกับครูอื่น / สลับคาบว่าง');
c = H.ctx_(); E = c.E;
let done6 = false;
for (const t of teachersOn(d1)) {
  if (t === pair.a || t === pair.b) continue;
  const its = E.buildItems(t, [d1]).filter(i => !E.NT[i.code] && !E.ACT[i.code] && E.CAT[i.cls]);
  for (const it0 of its) {
    const req = { id: '(t)', type: 'official', teacher: t, dates: [d1], slots: { [d1]: [it0.p] }, status: 'open', items: [it0] };
    const sT = E.candSwapT(req, it0).list[0], sF = E.candSwapF(req, it0).list[0];
    if (!sT || !sF) continue;
    const bad = { type: 'official', teacher: t, dates: [d1], slots: { [d1]: [it0.p] }, items: [{ id: it0.id, method: 'swapT', swap: { t: sT.t, date: d1, p: it0.p } }] };   // สลับไปคาบที่ตัวเองลา = ผิด
    const rb = H.apiSubmit(tok(t), bad);
    const good = { type: 'official', teacher: t, dates: [d1], slots: { [d1]: [it0.p] }, items: [{ id: it0.id, method: 'swapT', swap: sT }] };
    const rg = H.apiSubmit(tok(t), good);
    ok(!rb.ok && /สลับ/.test(rb.error), 'สลับคาบที่ไม่ถูกต้อง → ปฏิเสธ', rb.error);
    ok(rg.ok, 'สลับคาบกับครูอื่น (ครูที่สอนห้องเดียวกัน)', rg.error);
    c = H.ctx_(); E = c.E;
    const O = E.occupancy(null);
    ok(!!O.occ[sT.t + '|' + d1 + '|' + it0.p] && !!O.freed[sT.t + '|' + sT.date + '|' + sT.p], 'คู่สลับ: ไม่ว่างคาบนี้ / ว่างคาบเดิมของตน');
    if (rg.ok) H.apiCancel(tok(t), rg.data.id, 'x');
    c = H.ctx_(); E = c.E;
    const reqF = { type: 'official', teacher: t, dates: [d1], slots: { [d1]: [it0.p] }, items: [{ id: it0.id, method: 'swapF', swap: { date: sF.date, p: sF.p } }] };
    const rf = H.apiSubmit(tok(t), reqF);
    c = H.ctx_();
    ok(rf.ok && c.E.rst(c.requests.find(q => q.id === rf.data.id)) === 'review', 'สลับคาบว่าง → ไม่ต้องรับทราบ ไปรอเห็นชอบเลย', rf.error);
    done6 = true; break;
  }
  if (done6) break;
}
ok(done6, 'พบกรณีทดสอบการสลับคาบ');

/* ---------------------------------------------------------------- 7. ผู้ดูแล */
console.log('7) ผู้ดูแลระบบ');
r = H.apiAdmin(tok(3));
ok(!r.ok, 'ครูทั่วไปเปิดหน้าตั้งค่าไม่ได้');
r = H.apiAdmin(bossTok);
ok(r.ok && r.escore.ok && r.escore.cols.username === 'ชื่อผู้ใช้' && r.escore.cols.password === 'รหัสผ่าน', 'ตรวจหาคอลัมน์ภาษาไทยอัตโนมัติ', JSON.stringify(r.escore));
ok(r.users.filter(u => u.teacher).length === 77, 'จับคู่ผู้ใช้กับครูได้ครบ 77', r.users.filter(u => !u.teacher).map(u => u.name).join(','));
r = H.apiSetUserMap(bossTok, 'boss', TT.teachers[10].n);
ok(r.ok && H.apiBootstrap(bossTok).me.ti === 10, 'จับคู่บัญชีด้วยตนเอง (หัวหน้าวิชาการที่เป็นครูด้วย)');
r = H.apiSaveSettings(bossTok, { TERM_END: '2027-02-26', HOLIDAYS: '2026-12-07\n2026-12-10, bad' });
ok(r.ok && H.settings_().HOLIDAYS === '2026-12-07,2026-12-10', 'บันทึกตั้งค่า + กรองวันหยุดรูปแบบผิด');
const TT2 = JSON.parse(JSON.stringify(TT)); TT2.ts[0] = TT2.ts[0].slice(1);
r = H.apiImportTimetable(bossTok, TT2);
ok(r.ok && r.result.slots === 2059, 'นำเข้าตารางสอนใหม่ผ่าน API');
ok(H.ctx_().requests.length > 0, 'ข้อมูลการจัดสอนแทนเดิมยังอยู่หลังนำเข้าตาราง');
r = H.apiGetLog(bossTok, 'เห็นชอบ');
ok(r.ok && r.rows.length >= 1, 'ค้นหาบันทึกระบบ');

/* ---------------------------------------------------------------- 7b. ห้องเรียนไปราชการ */
console.log('7b) ห้องเรียนไปราชการ (นักเรียนไม่อยู่ทั้งห้อง)');
{
  let c7 = H.ctx_(), E7 = c7.E, found = null;
  for (let k = 3; k < 12 && !found; k++) {
    const d = E7.nthSchool(k), w = H.SubEngine.wd(d);
    for (const cls of ['ม.5/1', 'ม.5/2', 'ม.4/1', 'ม.3/1']) {
      for (let p = 1; p <= 9 && !found; p++) {
        const ce = E7.CAT[cls][w][p];
        if (!ce || E7.NT[ce.code] || E7.ACT[ce.code] || ce.tis.length !== 1) continue;
        const T = ce.tis[0];
        if (c7.requests.some(q => q.teacher === T && q.dates.includes(d))) continue;
        // ครู U อีกคนที่สอนห้องอื่นในคาบเดียวกัน (เพื่อดูว่า T รับคาบแทนได้)
        const U = TT.teachers.map((t, i) => i).find(i => i !== T && E7.TAT[i][w][p] && !E7.NT[E7.TAT[i][w][p].code] && !E7.ACT[E7.TAT[i][w][p].code]
          && E7.TAT[i][w][p].cls !== cls && !c7.requests.some(q => q.teacher === i && q.dates.includes(d)));
        if (U != null) found = { d, cls, p, T, U };
      }
      if (found) break;
    }
  }
  ok(!!found, 'พบกรณีทดสอบ', JSON.stringify(found));
  const { d, cls, p, T, U } = found;
  // 1) ก่อนกำหนด: T ลาคาบนั้น → ต้องจัดสอนแทน, เลือกครู S
  const sl = { [d]: [p] };
  let dr = mk(E7, T, 'official', [d], sl);
  const S = dr.items[0].sub;
  r = H.apiSubmit(tok(T), dr); const idT = r.data && r.data.id;
  ok(r.ok && S != null, 'ก่อนกำหนด: ครูที่ลาต้องจัดสอนแทนคาบห้อง ' + cls, r.error);
  // 2) สิทธิ์ + ตรวจข้อมูล
  r = H.apiSaveClassAway(tok(T), { date: d, classes: [cls], reason: 'x' });
  ok(!r.ok && /เฉพาะ/.test(r.error), 'ครูทั่วไปกำหนดห้องไปราชการไม่ได้');
  r = H.apiSaveClassAway(bossTok, { date: '2026-12-10', classes: [cls], reason: 'x' });
  ok(!r.ok, 'วันหยุด → ปฏิเสธ');
  r = H.apiSaveClassAway(bossTok, { date: d, classes: [cls], reason: '' });
  ok(!r.ok, 'ต้องระบุรายการ/เหตุผล');
  // 3) แอดมินกำหนด: ห้อง cls ไปราชการทั้งวัน
  r = H.apiSaveClassAway(bossTok, { date: d, classes: [cls, 'ไม่มีห้องนี้'], reason: 'นำนักเรียนแข่งขันทักษะวิชาการ' });
  const awId = r.data && r.data.id;
  ok(r.ok && /^CA-/.test(awId) && r.data.moot.some(x => x.startsWith(idT)), 'บันทึกห้องไปราชการ + แจ้งรายการที่กลายเป็นไม่ต้องสอน', JSON.stringify(r.data || r.error));
  ok(H.readRows_('away').length === 1 && H.readRows_('away')[0].classes === cls, 'บันทึกในชีต ClassAway (กรองห้องที่ไม่มีจริงออก)');
  c7 = H.ctx_(); E7 = c7.E;
  const rT = c7.requests.find(q => q.id === idT);
  ok(E7.itemAway(rT.items[0]) && E7.coverItems(rT).length === 0, 'คำขอเดิม: คาบห้อง ' + cls + ' ไม่ต้องสอนแล้ว');
  ok(E7.rst(rT) === 'review', 'ไม่ต้องรอผู้สอนแทนรับทราบคาบนั้นแล้ว', E7.rst(rT));
  ok(!E7.busy(S, d, p, E7.occupancy(null)) || E7.busy(S, d, p, E7.occupancy(null)).kind !== 'sub', 'คืนเวลาว่างให้ผู้สอนแทนเดิม');
  ok(H.readRows_('items').find(x => x.request_id === idT).request_status === 'รอเห็นชอบ', 'ชีต Items อัปเดตสถานะ');
  H.apiCancel(tok(T), idT, 'test');
  // 4) ครู T ที่สอนห้องนั้น อยู่ปฏิบัติหน้าที่ → ว่าง รับคาบแทนได้
  c7 = H.ctx_(); E7 = c7.E;
  ok(E7.busy(T, d, p, E7.occupancy(null)) === null, 'ครูที่สอนห้องนั้นว่างในคาบนั้น');
  const itU = E7.buildItems(U, [d], { [d]: [p] })[0];
  const candU = E7.candSub({ id: '(u)', type: 'official', teacher: U, dates: [d], slots: { [d]: [p] }, status: 'open', items: [itU] }, itU).avail;
  const tRow = candU.find(a => a.ti === T);
  ok(tRow && tRow.freedBy === cls, 'ครูที่สอนห้องนั้นอยู่ในรายชื่อรับคาบแทน พร้อมเหตุผล “' + cls + ' ไม่อยู่”');
  r = H.apiSubmit(tok(U), { type: 'official', teacher: U, dates: [d], slots: { [d]: [p] }, reason: 't', items: [{ id: itU.id, method: 'sub', sub: T }] });
  ok(r.ok, 'จัดครูคนนั้นสอนแทนได้จริง (server ยอมรับ)', r.error);
  const idU = r.data && r.data.id;
  // 5) ครู T ลาทั้งวัน → คาบห้องที่ไม่อยู่ไม่ต้องจัด
  c7 = H.ctx_(); E7 = c7.E;
  const itsT = E7.buildItems(T, [d]);
  const awayIt = itsT.find(i => i.p === p);
  ok(awayIt.method === 'none' && E7.itemAway(awayIt), 'ครูที่ลา: คาบห้องไปราชการไม่ต้องจัดสอนแทน');
  const dT = mk(E7, T, 'personal', [d], { [d]: [p] });
  r = H.apiSubmit(tok(T), dT);
  ok(r.ok || /ล่วงหน้า|ไม่ว่าง/.test(r.error), 'ส่งคำขอได้โดยไม่ต้องเลือกผู้สอนแทนคาบนั้น', r.error);
  c7 = H.ctx_();
  if (r.ok) { const q = c7.requests.find(x => x.id === r.data.id); ok(c7.E.rst(q) === 'review' && c7.E.coverItems(q).length === 0, 'คำขอนั้นไปรอเห็นชอบทันที'); H.apiCancel(tok(T), r.data.id, 't'); }
  // 7) ยกเลิก → กลับมาต้องสอน + แจ้งการจัดซ้อน (T มีสอนห้องนั้น แต่ถูกจัดสอนแทน U แล้ว)
  r = H.apiCancelClassAway(tok(T), awId);
  ok(!r.ok, 'ครูทั่วไปยกเลิกไม่ได้');
  r = H.apiCancelClassAway(bossTok, awId);
  ok(r.ok && r.data.conflicts.some(x => x.indexOf(TT.teachers[T].n) >= 0), 'ยกเลิกแล้ว แจ้งครูที่ถูกจัดซ้อน', JSON.stringify(r.data || r.error));
  ok(H.readRows_('away')[0].status === 'cancelled', 'สถานะในชีตเป็น cancelled (เก็บประวัติ)');
  if (idU) H.apiCancel(tok(U), idU, 't');
}

/* ---------------------------------------------------------------- 8. ชีต Users รูปแบบ e-Score จริง */
console.log('8) e-Score จริง: PBKDF2, รหัสครู/อีเมล, บทบาทอัตโนมัติ');
const K = boot();
K.F.addBook('DB', {});
const hdr = ['teacher_id', 'email', 'prefix', 'first_name', 'last_name', 'display_name', 'roles', 'subject_group', 'department', 'position',
  'seniority', 'password_hash', 'salt', 'must_change_password', 'is_active', 'last_login', 'created_at'];
const salt = 'a3f1c2d4e5b6978812aa34bc56de78f0';
const hp = pw => K.pbkdf2_(pw, salt, 500, 32);
const urow = (id, email, pre, f, l, roles, sg, dept, pos, pw, mc, act) => [id, email, pre, f, l, 'ครู' + f + ' ' + l, roles, sg, dept, pos, '', hp(pw), salt, mc || 'FALSE', act || 'TRUE', '', ''];
K.F.addBook('ESC2', { Users: [hdr,
  urow('T999', 'panth427@kjst.ac.th', 'นาย', 'ธนพันธ์', 'เพ็งสวัสดิ์', 'admin', '', '', 'ผู้ดูแลระบบ', 'adminpw'),
  urow('T304', 'panth427@kjst.ac.th', 'นาย', 'ธนพันธ์', 'เพ็งสวัสดิ์', 'teacher,measurement', 'วิทยาศาสตร์และเทคโนโลยี', 'วิชาการ', 'หัวหน้ากลุ่ม', 'teachpw'),
  urow('T339', 'n66@kjst.ac.th', 'นางสาว', 'นฤมล', 'มุจจลินทร์', 'teacher', 'วิทยาศาสตร์และเทคโนโลยี', '', 'หัวหน้ากลุ่มสาระ', 'x12345'),
  urow('T423', 'p@kjst.ac.th', 'นาย', 'ภัทรภูมิ', 'บุญเพียง', 'teacher', 'สังคมศึกษา ศาสนาและวัฒนธรรม', 'วิชาการ', 'หัวหน้ากลุ่มสาระ', 'x12345'),
  urow('T839', '', 'นางสาว', 'สิริกานต์', 'สุขศรีเมือง', 'teacher', 'ภาษาต่างประเทศ', '', '', 'x12345'),
  urow('T519', '', 'สิบเอก', 'โรจน์ศักดิ์', 'แก้้วส่งแสง', 'teacher', 'สุขศึกษาและพลศึกษา', '', '', 'KJST_T519', 'TRUE'),
  urow('T302', 'aree@kjst.ac.th', 'นาง', 'อารี', 'อนันต์ศรี', 'teacher', 'วิทยาศาสตร์และเทคโนโลยี', 'งบประมาณและสินทรัพย์', 'หัวหน้ากลุ่ม', 'x12345'),
  urow('T777', 'old@kjst.ac.th', 'นาย', 'ปิยวัฒน์', 'สาลี', 'teacher', 'วิทยาศาสตร์และเทคโนโลยี', '', '', 'x12345', 'FALSE', 'FALSE')] });
K.setup();
K.saveSettings_({ ESCORE_SPREADSHEET_ID: 'ESC2' });
ok(K.settings_().ESCORE_PBKDF2_ITER === '500' && K.settings_().ESCORE_SPREADSHEET_ID === 'ESC2', 'ค่าเริ่มต้น PBKDF2 500 รอบ');
ok(K.pbkdf2_('password', 'salt', 4096, 32) === 'c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a', 'PBKDF2 ตรง test vector RFC');
r = K.apiLogin('T304', 'wrong');
ok(!r.ok, 'รหัสผิด → ปฏิเสธ');
r = K.apiLogin('t304', 'teachpw');
ok(r.ok && r.me.name === 'นายธนพันธ์ เพ็งสวัสดิ์' && r.me.roles.includes('acad') && !r.me.roles.includes('admin'), 'รหัสครู T304 → ครูในตาราง + หัวหน้าวิชาการ (จากตำแหน่ง)', JSON.stringify(r.me));
r = K.apiLogin('panth427@kjst.ac.th', 'adminpw');
ok(r.ok && r.me.username === 'T999' && r.me.roles.includes('admin'), 'อีเมลซ้ำ 2 บัญชี → เลือกบัญชีที่รหัสตรง (T999 admin)');
r = K.apiLogin('PANTH427@kjst.ac.th', 'teachpw');
ok(r.ok && r.me.username === 'T304', 'อีเมลซ้ำ → รหัสของ T304 เข้าบัญชี T304');
r = K.apiLogin('T302', 'x12345');
ok(r.ok && !r.me.roles.includes('acad'), 'หัวหน้ากลุ่มงบประมาณ ไม่ได้สิทธิ์หัวหน้าวิชาการ');
r = K.apiLogin('T339', 'x12345');
ok(r.ok && r.me.roles.includes('dept') && r.me.headGroups.includes(2), 'หัวหน้ากลุ่มสาระวิทย์ฯ จากตำแหน่งใน e-Score');
r = K.apiLogin('T423', 'x12345');
ok(r.ok && r.me.ti === null && r.me.headGroups.includes(3), 'หัวหน้ากลุ่มสาระสังคมฯ (ไม่อยู่ในตารางสอน, ชื่อกลุ่มเว้นวรรคต่าง) ยังได้สิทธิ์', JSON.stringify(r.me));
r = K.apiLogin('T839', 'x12345');
ok(r.ok && r.me.name === 'นางสาวศิริกานต์ สุขศรีเมือง', 'ชื่อสะกดต่าง (สิริกานต์/ศิริกานต์) จับคู่ได้', r.me && r.me.name);
r = K.apiLogin('T519', 'KJST_T519');
ok(r.ok && r.me.name === 'สิบเอกโรจน์ศักดิ์ แก้วส่งแสง' && r.me.mustChange, 'วรรณยุกต์ซ้ำ (แก้้ว) จับคู่ได้ + เตือนยังใช้รหัสเริ่มต้น');
r = K.apiLogin('T777', 'x12345');
ok(!r.ok && /ระงับ/.test(r.error), 'is_active = FALSE → เข้าไม่ได้');
const acadTok = K.apiLogin('T304', 'teachpw').token;
r = K.apiAdmin(acadTok);
ok(r.ok && r.escore.cols.username === 'teacher_id' && r.escore.cols.password === 'password_hash' && r.escore.cols.salt === 'salt', 'ตรวจคอลัมน์ e-Score อัตโนมัติ', JSON.stringify(r.escore.cols));
ok(r.escore.heads['วิทยาศาสตร์และเทคโนโลยี'].name === 'นางสาวนฤมล มุจจลินทร์', 'หัวหน้ากลุ่มสาระที่อ่านจาก e-Score');
ok(r.users.find(u => u.username === 'T839').via === 'fuzzy', 'แสดงว่าเป็นการจับคู่ชื่อใกล้เคียง');
r = K.apiBootstrap(acadTok);
ok(r.ok && r.settings.deptHeads[2] === K.ctx_().D.teachers.findIndex(t => t.n === 'นางสาวนฤมล มุจจลินทร์'), 'หน้าเว็บรู้จักหัวหน้ากลุ่มสาระจาก e-Score');
K.saveSettings_({ DEPT_HEADS: JSON.stringify({ 'วิทยาศาสตร์และเทคโนโลยี': 'นางปราถนา อินทวิเศษ' }) });
ok(!K.apiLogin('T339', 'x12345').me.roles.includes('dept'), 'กำหนดหัวหน้ากลุ่มในระบบ → แทนค่าจาก e-Score');

/* ---------------------------------------------------------------- 9. นำเข้า Excel */
console.log('9) นำเข้าไฟล์ Excel');
const AOA = process.env.AOA ? JSON.parse(fs.readFileSync(process.env.AOA, 'utf8')) : null;
if (AOA) {
  const TTImport = require(path.join(SRC, 'importer.js'));
  const res = TTImport.fromRows(AOA.t, AOA.c, TT);
  ok(res.warnings.length === 0 && res.summary.teachers === 77 && res.summary.slots === 2060, 'อ่าน Excel: ครู 77 คน 2060 คาบ ไม่มีคำเตือน', JSON.stringify(res.summary));
  r = K.apiImportTimetable(acadTok, res.D);
  ok(r.ok && r.result.slots === 2060, 'นำเข้า Excel ผ่าน API');
} else console.log('  (ข้าม — ตั้ง AOA=ไฟล์ json เพื่อทดสอบ)');

console.log(`\nผ่าน ${pass} · ไม่ผ่าน ${fail}`);
process.exit(fail ? 1 : 0);
