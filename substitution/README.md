# ระบบจัดสอนแทน (Substitution) — ภาคเรียน 2/2569

เว็บแอปบน **Google Apps Script + Google Sheet** (แบบเดียวกับ e-Score) ล็อกอินด้วยบัญชี e-Score

| ไฟล์ | คำอธิบาย |
|---|---|
| [`INSTALL.md`](INSTALL.md) | **วิธีติดตั้ง** ทีละขั้น |
| [`DESIGN.md`](DESIGN.md) | เอกสารออกแบบระบบ (กฎ, อัลกอริทึม, ขั้นตอน, โครงสร้างข้อมูล) |
| `gas/` | ไฟล์ที่ต้องวางใน Apps Script: `Code.gs`, `Index.html`, `TimetableData.html`, `appsscript.json` |
| [`Substitution-Demo-2-2569.html`](Substitution-Demo-2-2569.html) | **โหมดทดลอง** เปิดในเบราว์เซอร์ได้ทันที — โค้ดชุดเดียวกับของจริง ใช้ Google Sheet จำลองในเบราว์เซอร์ |
| `src/` | โค้ดต้นฉบับ: `engine.js` (กฎ/การคำนวณ ใช้ร่วมทั้ง server และหน้าเว็บ), `server.js`, `client.html`, `fakegas.js`, `demo_boot.js` |
| `test/` | ทดสอบอัตโนมัติ: `test_server.js` (58 กรณี), `test_e2e.js` (34 กรณี ผ่านเบราว์เซอร์) |
| `build.py` | สร้าง `gas/`, demo และ `data/timetable-2-2569.json` จากไฟล์ตารางสอนใน repo |

## ทดลองใช้
เปิด `Substitution-Demo-2-2569.html` → เลือกบัญชีทดลอง (รหัสผ่าน `1234`): ครูผู้สอน / ครูที่ต้องจัดใหม่ / หัวหน้ากลุ่มสาระฯ / หัวหน้ากลุ่มบริหารงานวิชาการ

## พัฒนาต่อ
```bash
python3 substitution/build.py            # สร้างไฟล์ใหม่หลังแก้ src/ หรือตารางสอน
node substitution/test/test_server.js    # ทดสอบ server
node substitution/test/test_e2e.js       # ทดสอบหน้าเว็บ (ต้องมี Playwright)
```
