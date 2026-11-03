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
  for (const f of ['engine.js', 'server.js', 'demo_boot.js']) vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
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
ok(r.ok && !c.E.busy(Z, d2, pair.p, c.E.occupancy(null)), 'ยกเลิก → ครูที่ถูกจัดว่างทันที');
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
    const bad = { type: 'official', teacher: t, dates: [d1], slots: { [d1]: [it0.p] }, items: [{ id: it0.id, method: 'swapT', swap: { t: sT.t, date: d1, p: sT.p } }] };   // สลับไปวันที่ตัวเองลา = ผิด
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

console.log(`\nผ่าน ${pass} · ไม่ผ่าน ${fail}`);
process.exit(fail ? 1 : 0);
