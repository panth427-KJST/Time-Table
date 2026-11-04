#!/usr/bin/env node
/* =====================================================================
   ตัวช่วย clasp ของระบบจัดสอนแทน — รันจากโฟลเดอร์ substitution/ ผ่าน npm run <คำสั่ง>
     npm run create            สร้างโปรเจ็กต์ Apps Script ผูกกับไฟล์ฐานข้อมูล (ครั้งแรก ถ้ายังไม่มีโปรเจ็กต์)
     npm run link -- <ScriptID> ผูกกับโปรเจ็กต์ที่มีอยู่แล้ว (เช่น เคยวางโค้ดเองใน editor)
     npm run push              อัปโหลดไฟล์ใน gas/ (ตรวจ manifest ก่อน)
     npm run deploy            push + เผยแพร่เว็บแอป (ครั้งต่อไปอัปเดต deployment เดิม → URL เดิม)
     npm run status            แสดงสถานะการผูกโปรเจ็กต์/deployment
     npm run build             สร้าง gas/ ใหม่จาก src/ + Excel (ต้องมี Python + openpyxl + pillow)
   ===================================================================== */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const HERE = path.resolve(__dirname, '..');
const CLASP_JSON = path.join(HERE, '.clasp.json');
const DEPLOY_JSON = path.join(HERE, '.deployment.json');
const MANIFEST = path.join(HERE, 'gas', 'appsscript.json');
const DB_SHEET_ID = '1CrMI5NlO-rygxZDTtCSENSiW2BZww0DcPFHXRUEdP0U';   // KJST Substitute Teaching
const CLASP = process.env.CLASP_BIN || 'clasp';                         // ทดสอบได้ด้วย CLASP_BIN

const die = m => { console.error('\n✗ ' + m + '\n'); process.exit(1); };
const ok = m => console.log('✓ ' + m);
function clasp(args, capture) {
  const shell = process.platform === 'win32' || !!process.env.CLASP_BIN;     // Windows ต้องใช้ shell เพื่อหา clasp.cmd
  if (shell) args = args.map(a => /[\s"]/.test(a) ? '"' + a.replace(/"/g, '\\"') + '"' : a);
  const r = spawnSync(CLASP, args, { cwd: HERE, shell, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (r.error) die('เรียก clasp ไม่ได้ (' + r.error.message + ') — รัน npm install ในโฟลเดอร์ substitution ก่อน');
  if (capture) { process.stdout.write(r.stdout || ''); process.stderr.write(r.stderr || ''); }
  if (r.status !== 0) die('clasp ' + args[0] + ' ไม่สำเร็จ' + (/API/.test((r.stderr || '') + (r.stdout || '')) ? ' — เปิดใช้ Apps Script API ที่ https://script.google.com/home/usersettings' : ''));
  return (r.stdout || '') + (r.stderr || '');
}
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };

function checkManifest() {
  const m = readJson(MANIFEST);
  if (!m || m.timeZone !== 'Asia/Bangkok' || !m.webapp)
    die('gas/appsscript.json ถูกเขียนทับ (clasp create สร้างไฟล์ค่าเริ่มต้น) — แก้ด้วย: git checkout -- gas/appsscript.json');
  ok('manifest: เขตเวลา ' + m.timeZone + ' · เว็บแอปรันในนาม ' + m.webapp.executeAs + ' · เข้าถึง ' + m.webapp.access);
}
function requireLinked() {
  const c = readJson(CLASP_JSON);
  if (!c || !c.scriptId) die('ยังไม่ได้ผูกโปรเจ็กต์ — รัน npm run create (ครั้งแรก) หรือ npm run link -- <Script ID>');
  if (path.resolve(HERE, c.rootDir || '.') !== path.join(HERE, 'gas')) die('.clasp.json ต้องมี "rootDir": "gas"');
  return c;
}

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
  case 'create': {
    if (readJson(CLASP_JSON)) die('มี .clasp.json อยู่แล้ว (ผูกโปรเจ็กต์แล้ว) — ใช้ npm run push');
    const keep = fs.readFileSync(MANIFEST, 'utf8');
    clasp(['create-script', '--title', 'KJST ระบบจัดสอนแทน', '--parentId', DB_SHEET_ID, '--rootDir', 'gas']);
    fs.writeFileSync(MANIFEST, keep);                                     // คืน manifest ของระบบ
    ok('สร้างโปรเจ็กต์ผูกกับไฟล์ KJST Substitute Teaching แล้ว → ต่อไป: npm run push');
    break;
  }
  case 'link': {
    if (!arg || !/^[\w-]{20,}$/.test(arg)) die('ใส่ Script ID: npm run link -- <Script ID>  (ดูที่ Apps Script → ⚙️ การตั้งค่าโปรเจ็กต์ → รหัสสคริปต์)');
    fs.writeFileSync(CLASP_JSON, JSON.stringify({ scriptId: arg, rootDir: 'gas' }, null, 2) + '\n');
    ok('ผูกกับโปรเจ็กต์ ' + arg + ' แล้ว (.clasp.json) → ต่อไป: npm run push');
    break;
  }
  case 'push': {
    requireLinked(); checkManifest();
    clasp(['push', '--force']);
    ok('อัปโหลดแล้ว — ครั้งแรกให้ npm run open แล้วรัน setup, testPbkdf2, testEscore ใน editor');
    break;
  }
  case 'deploy': {
    requireLinked(); checkManifest();
    clasp(['push', '--force']);
    const d = readJson(DEPLOY_JSON);
    const desc = 'ระบบจัดสอนแทน ' + new Date().toISOString().slice(0, 16).replace('T', ' ');
    const out = clasp(['create-deployment', '--description', desc].concat(d && d.deploymentId ? ['--deploymentId', d.deploymentId] : []), true);
    const id = d && d.deploymentId || (out.match(/AKfyc[\w-]+/) || [])[0];
    if (!id) die('ไม่พบ deployment ID ในผลลัพธ์ — รัน npx clasp list-deployments แล้วบันทึกใน .deployment.json: {"deploymentId":"AKfyc..."}');
    if (!d) fs.writeFileSync(DEPLOY_JSON, JSON.stringify({ deploymentId: id }, null, 2) + '\n');
    ok((d ? 'อัปเดตเว็บแอปเดิม' : 'เผยแพร่เว็บแอปครั้งแรก') + ' — URL: https://script.google.com/macros/s/' + id + '/exec');
    break;
  }
  case 'status': {
    const c = readJson(CLASP_JSON), d = readJson(DEPLOY_JSON);
    console.log('โปรเจ็กต์ :', c ? c.scriptId + ' (rootDir ' + c.rootDir + ')' : 'ยังไม่ได้ผูก');
    console.log('เว็บแอป   :', d ? 'https://script.google.com/macros/s/' + d.deploymentId + '/exec' : 'ยังไม่ได้เผยแพร่');
    if (fs.existsSync(MANIFEST)) checkManifest();
    break;
  }
  case 'build': {
    const tries = process.platform === 'win32' ? [['py', ['-3']], ['python', []]] : [['python3', []], ['python', []]];
    for (const [bin, pre] of tries) {
      const r = spawnSync(bin, pre.concat([path.join(HERE, 'build.py')]), { stdio: 'inherit' });
      if (!r.error) process.exit(r.status);
    }
    die('ไม่พบ Python — ติดตั้ง Python 3 แล้ว pip install openpyxl pillow (ถ้าแค่ push โค้ดในโฟลเดอร์ gas/ ไม่ต้อง build)');
    break;
  }
  default:
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 11).join('\n'));
}
