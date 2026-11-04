/* ทดสอบหน้าเว็บจริงด้วยเบราว์เซอร์ (Playwright) บนไฟล์โหมดทดลอง
   node substitution/test/test_e2e.js [โฟลเดอร์เก็บภาพหน้าจอ] */
const { chromium } = require('playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '..', 'Substitution-Demo-2-2569.html');
const SHOT = process.argv[2] || null;
let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } };

(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1300, height: 900 } });
  const XLSX_JS = process.env.XLSX_JS;      // SheetJS 0.18.5 สำเนาในเครื่อง (แทน cdnjs ที่เข้าไม่ได้ในเครื่องทดสอบ)
  if (XLSX_JS) await pg.route('**/xlsx.full.min.js', r => r.fulfill({ path: XLSX_JS, contentType: 'application/javascript' }));
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errs.push(m.text()); });
  const shot = async n => { if (SHOT) await pg.screenshot({ path: path.join(SHOT, n + '.png'), fullPage: true }); };
  const idle = () => pg.waitForFunction(() => !document.querySelector('.busy'), null, { timeout: 15000 }).then(() => pg.waitForTimeout(150));
  const loginAs = async i => { if (await pg.$('[data-act="logout"]')) { await pg.click('.demo-bar [data-act="logout"]'); await idle(); }
    await pg.click(`.quick button:nth-child(${i})`); await idle(); };
  const text = () => pg.textContent('#app');

  await pg.goto(URL); await idle();
  console.log('1) เข้าสู่ระบบ');
  ok(await pg.$('#lu') && (await pg.$$('.quick button')).length === 4, 'หน้าเข้าสู่ระบบ + บัญชีทดลอง 4 บทบาท');
  const bg = await pg.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bg === 'rgb(250, 249, 245)', 'ธีมพื้นหลังสีครีมอ่อน', bg);
  await shot('01-login');
  await pg.fill('#lu', 'T101'); await pg.fill('#lp', 'ผิด'); await pg.click('#lf button[type=submit]'); await idle();
  ok(/ไม่ถูกต้อง/.test(await pg.textContent('#lerr')), 'รหัสผิดแสดงข้อความ');

  console.log('2) ครูผู้สอน: รับทราบ');
  await loginAs(1);
  ok(/สวัสดี/.test(await text()), 'เข้าหน้าหลัก');
  await shot('02-home-teacher');
  await pg.click('[data-go="inbox"]');
  const nAck = (await pg.$$('[data-act="ack"]')).length;
  ok(nAck >= 1, 'มีคาบรอรับทราบ', nAck);
  await shot('03-inbox');
  await pg.click('[data-act="ack"]'); await idle();
  ok((await pg.$$('main [data-act="ack"]')).length === nAck - 1, 'กดรับทราบแล้วรายการลดลง');
  await pg.reload(); await idle();
  ok(/สวัสดี|รอฉันรับทราบ/.test(await text()), 'รีเฟรชแล้วยังเข้าสู่ระบบอยู่ (จำ token)');

  console.log('3) สร้างคำขอ: ลาบางคาบ + 3 วิธีจัด');
  await pg.click('[data-go="new"]');
  await pg.click('[data-act="wtype"][data-k="official"]');
  const d = await pg.evaluate(() => { for (let k = 5; k < 15; k++) { const d = E.nthSchool(k), w = SubEngine.wd(d);
      const n = E.TAT[ME.ti][w].filter((e, p) => p > 0 && e && !E.NT[e.code] && !E.ACT[e.code]).length;
      if (n >= 3 && !REQ.some(r => r.teacher === ME.ti && r.dates.includes(d))) return d; } return null; });
  ok(!!d, 'หาวันที่ครูมีสอน ≥ 3 คาบ', d);
  await pg.fill('[data-w=start]', d); await pg.dispatchEvent('[data-w=start]', 'change'); await idle();
  const fullItems = await pg.evaluate(() => E.coverItems(W.req).length);
  await pg.click(`[data-act="ppart"][data-d="${d}"]`);
  const teach = await pg.evaluate(d => { const w = SubEngine.wd(d), t = W.req.teacher; const ps = []; for (let p = 1; p <= 9; p++) { const e = E.TAT[t][w][p]; if (e && !E.NT[e.code] && !E.ACT[e.code]) ps.push(p); } return ps; }, d);
  for (const p of teach.slice(0, 3)) await pg.click(`[data-act="pslot"][data-d="${d}"][data-p="${p}"]`);
  const partItems = await pg.evaluate(() => E.coverItems(W.req).length);
  ok(partItems > 0 && partItems === Math.min(3, teach.length) && partItems <= fullItems, `ลาบางคาบ: ${fullItems} → ${partItems} คาบ`);
  await shot('04-new-partial');
  let iid = await pg.evaluate(() => UI.open);
  await pg.click(`[data-act="itab"][data-iid="${iid}"][data-m="swapF"]`);
  const hasF = await pg.$(`[data-act="pickF"][data-iid="${iid}"]`);
  if (hasF) { await hasF.click(); ok(true, 'เลือกสลับคาบว่าง'); }
  iid = await pg.evaluate(() => UI.open);
  if (iid) { await pg.click(`[data-act="itab"][data-iid="${iid}"][data-m="swapT"]`); await shot('05-swapT');
    const t = await pg.$(`[data-act="pickT"][data-iid="${iid}"]`); if (t) { await t.click(); ok(true, 'เลือกสลับคาบกับครูอื่น'); } }
  iid = await pg.evaluate(() => UI.open);
  if (iid) { await pg.click(`[data-act="itab"][data-iid="${iid}"][data-m="sub"]`); await shot('06-sub');
    ok(/กลุ่มสาระเดียวกันก่อน/.test(await text()), 'แสดงรายชื่อเรียงตามกฎ'); await pg.click(`[data-act="pick"][data-iid="${iid}"]`); }
  await pg.click('[data-act="autofill"]').catch(() => {});
  await pg.click('[data-act="wsubmit"]'); await shot('07-confirm');
  await pg.click('[data-act="wsend"]'); await idle();
  const newId = await pg.evaluate(() => UI.detail);
  ok(/^ST69-/.test(newId || ''), 'ส่งคำขอสำเร็จ', newId);
  await shot('08-detail');
  await pg.click('.x');

  console.log('5) ขอเปลี่ยน → จัดใหม่');
  await loginAs(2);
  await pg.click('[data-go="list"]');
  await pg.click('table.t tbody tr.click'); await idle();
  const fx = await pg.$('[data-act="fixitem"]');
  ok(!!fx, 'มีปุ่มจัดใหม่ในคาบที่ถูกขอเปลี่ยน');
  if (fx) {
    await fx.click(); await shot('09-fix');
    const blockedTxt = await pg.textContent('#ov');
    ok(/ขอเปลี่ยนคาบนี้ไปแล้ว/.test(blockedTxt), 'คนที่ขอเปลี่ยนไม่อยู่ในรายชื่อ (แสดงในรายการไม่ว่าง)');
    await pg.click('#ov [data-act="pick"]'); await pg.click('[data-act="fixsave"]'); await idle();
    ok(/รอรับทราบ/.test(await pg.textContent('#ov')), 'จัดใหม่แล้ว → รอรับทราบ');
    await pg.click('.x');
  }

  console.log('6) หัวหน้ากลุ่มสาระฯ: ลาป่วยแทนครูในกลุ่ม');
  await loginAs(3);
  await pg.click('[data-go="new"]');
  const opts = await pg.$$eval('[data-w=teacher] option', o => o.length);
  ok(opts > 1, 'เลือกครูในกลุ่มได้', opts);
  await pg.selectOption('[data-w=teacher]', { index: 1 });
  const disabled = await pg.$$eval('.type', els => els.filter(e => e.disabled).length);
  ok(disabled === 3, 'จัดให้ครูอื่นได้เฉพาะลาป่วย (อีก 3 กรณีถูกปิด)');
  await shot('10-depthead');

  console.log('7) หัวหน้ากลุ่มบริหารงานวิชาการ');
  await loginAs(4);
  console.log('7b) กันจองซ้ำ (ข้อมูลเก่าในหน้าเว็บ)');
  const stale = await pg.evaluate(async () => {
    // จำลองหน้าเว็บที่ยังไม่ได้รีเฟรช: ส่งคำขอใหม่ที่เลือกครูซึ่งถูกจัดไปแล้วในช่องเดียวกัน
    const r = REQ.find(q => q.items.some(i => i.method === 'sub' && i.ack !== 'declined' && i.date > TODAY));
    const it = r.items.find(i => i.method === 'sub' && i.ack !== 'declined' && i.date > TODAY);
    const w = SubEngine.wd(it.date); let t2 = null;
    D.teachers.forEach((t, ti) => { const e = E.TAT[ti][w][it.p]; if (t2 == null && e && !E.NT[e.code] && !E.ACT[e.code] && ti !== r.teacher && !REQ.some(q => q.teacher === ti && q.dates.includes(it.date))) t2 = ti; });
    return { d: it.date, p: it.p, X: it.sub, t2, code: E.TAT[t2][w][it.p].code };
  });
  const res = await pg.evaluate(async s => call('apiSubmit', { type: 'sick', teacher: s.t2, dates: [s.d], slots: { [s.d]: [s.p] }, items: [{ id: s.d + '-' + s.p, method: 'sub', sub: s.X }] }), stale);
  ok(!res.ok && /ไม่ว่างแล้ว/.test(res.error), 'server ปฏิเสธการจองครูที่ถูกจัดไปแล้ว', res.error);
  await pg.click('#ov .x').catch(()=>{});

  await pg.click('[data-go="approve"]'); await shot('11-approve');
  const review = await pg.$$('.apck:not(:disabled)');
  ok(review.length >= 1, 'มีคำขอรอเห็นชอบ', review.length);
  await pg.click('[data-act="checkall"]'); await pg.click('[data-act="bulkapprove"]'); await pg.click('#cmok'); await idle();
  ok((await pg.$$('.apck:not(:disabled)')).length === 0, 'เห็นชอบแบบกลุ่ม');
  await pg.click('[data-act="aptab"][data-k="approved"]');
  ok((await pg.$$('table.t tbody tr.click')).length >= 3, 'ย้ายไปแท็บสมบูรณ์');
  await pg.click('[data-go="board"]'); await shot('12-board');
  ok(/ตารางสอนแทนรายวัน/.test(await text()), 'ตารางสอนแทนรายวัน');
  await pg.click('[data-go="stats"]'); await shot('13-stats');
  ok(/รายบุคคล/.test(await text()), 'สถิติ');
  await pg.click('table.t tr.click[data-act="person"]'); await shot('14-person'); await pg.click('.x');
  await pg.click('[data-go="log"]'); await idle(); await pg.waitForTimeout(300);
  ok((await pg.$$('main table.t tbody tr')).length > 10, 'บันทึกระบบ');
  await shot('15-log');
  await pg.click('[data-go="settings"]'); await idle(); await pg.waitForTimeout(300);
  ok(/เชื่อมต่อแล้ว/.test(await text()), 'หน้าตั้งค่า: เชื่อมต่อ e-Score แล้ว');
  ok(/ตาม e-Score:/.test(await text()), 'หัวหน้ากลุ่มสาระอ่านจาก e-Score');
  ok(await pg.evaluate(() => ME.username === 'T304' && ME.ti != null && ME.roles.includes('acad')), 'T304 = ครูในตาราง + หัวหน้าวิชาการ (บทบาทอัตโนมัติ)');
  await shot('16-settings');
  await pg.fill('[data-cfg="MAX_AHEAD"]', '28'); await pg.click('[data-act="savecfg"]'); await idle(); await pg.waitForTimeout(300);
  ok(await pg.evaluate(() => SET.maxAhead) === 28, 'บันทึกการตั้งค่า');
  await pg.fill('[data-cfg="MAX_AHEAD"]', '30'); await pg.click('[data-act="savecfg"]'); await idle();

  if (XLSX_JS) {
    console.log('7c) นำเข้าไฟล์ Excel ผ่านหน้าตั้งค่า');
    await pg.click('[data-go="settings"]'); await idle(); await pg.waitForTimeout(300);
    await pg.setInputFiles('#ttfile', path.resolve(__dirname, '..', 'data', 'timetable-db-2-2569.xlsx'));
    await pg.click('[data-act="ttimport"]'); await pg.waitForSelector('#cmok', { timeout: 15000 });
    const msg = await pg.textContent('#ov');
    ok(/ครู 77 คน/.test(msg) && /2060/.test(msg) && !/ไม่มีในไฟล์ใหม่/.test(msg), 'อ่าน Excel: ครู 77 คน 2060 คาบ ไม่มีครูหาย', msg.slice(0, 120));
    await shot('16b-import'); await pg.click('#cmok'); await idle(); await pg.waitForTimeout(400);
    ok(/timetable|Excel/.test(await text()) && await pg.evaluate(() => D.teachers.length === 77), 'นำเข้าแล้ว ระบบยังใช้งานได้');
  }

  console.log('8) มือถือ');
  await pg.setViewportSize({ width: 390, height: 844 });
  for (const v of ['home', 'new', 'list', 'approve', 'board', 'stats', 'settings']) {
    await pg.click(`[data-go="${v}"]`); await idle(); await pg.waitForTimeout(200);
    const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= 391, `ไม่ล้นจอ: ${v}`, sw);
  }
  await pg.click('[data-go="home"]'); await shot('17-mobile');

  ok(errs.length === 0, 'ไม่มี JavaScript error', errs.join(' | '));
  console.log(`\nผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
