#!/usr/bin/env python3
"""
สร้างไฟล์ทั้งหมดของระบบจัดสอนแทน (รันจากโฟลเดอร์ราก repo):
    python3 substitution/build.py

อ่าน   Dashboard-2-2569.html             ตารางสอนครู/ตารางเรียนห้อง (แหล่งข้อมูลหลัก)
       KJST_TimeTable_Studio_2-2569.html  ข้อมูลเวร + คาบพักกลางวัน
       substitution/src/*                 โค้ดต้นฉบับ
เขียน  substitution/gas/                  ไฟล์สำหรับวางใน Google Apps Script (Code.gs, Index.html, TimetableData.html, appsscript.json)
       substitution/data/timetable-2-2569.json
       substitution/Substitution-Demo-2-2569.html   โหมดทดลอง (โค้ดชุดเดียวกับของจริง ทำงานในเบราว์เซอร์)
"""
import base64, io, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent
SRC = HERE / "src"

# ไม่ต้องจัดสอนแทน: โฮมรูม, ประชุมระดับ, PLC, ประชุมฝ่าย
NO_COVER = ["HR", "MEET", "PLC", "ประชุม"]
# กิจกรรมพร้อมกันทั้งโรงเรียน — ต้องระบุผู้ดูแล แต่ไม่มีครูว่าง จึงมีตัวเลือก "ฝากครูร่วมกิจกรรมดูแล"
ACTIVITY = ["ชุมนุม", "ลูกเสือ"]


def embedded_json(path):
    m = re.search(r'<script id="data" type="application/json">(.*?)</script>', path.read_text(encoding="utf-8"), re.S)
    if not m:
        raise SystemExit(f"ไม่พบข้อมูล JSON ใน {path.name}")
    return json.loads(m.group(1))


def small_logo(uri, size=96):
    try:
        from PIL import Image
    except ImportError:
        return ""
    img = Image.open(io.BytesIO(base64.b64decode(uri.split(",", 1)[1]))).convert("RGBA")
    img.thumbnail((size, size))
    buf = io.BytesIO(); img.save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def timetable():
    dash = embedded_json(ROOT / "Dashboard-2-2569.html")
    studio = embedded_json(ROOT / "KJST_TimeTable_Studio_2-2569.html")
    days, groups, names, classes = dash["days"], dash["group_order"], dash["sorted_teachers"], dash["sorted_classes"]
    tidx = {n: i for i, n in enumerate(names)}
    ts = [[[di, int(p), c["code"], c["subject"], c["class"], c["room"]]
           for di, day in enumerate(days)
           for p, c in sorted(dash["teachers"][n].get(day, {}).items(), key=lambda x: int(x[0]))] for n in names]
    cs = {cl: [[di, int(p), c["code"], c["subject"], [tidx[t] for t in c["teachers"] if t in tidx], c["room"]]
               for di, day in enumerate(days)
               for p, c in sorted(dash["classes"][cl].get(day, {}).items(), key=lambda x: int(x[0]))] for cl in classes}
    duty = {}
    for n, items in studio.get("duty", {}).items():
        if n in tidx:
            duty[tidx[n]] = [[d, p, it["label"]] for it in items for d, p in it["cells"]]
    D = {"term": "2/2569", "source": "Dashboard-2-2569.html", "days": days, "times": dash["period_times"],
         "groups": groups, "noCover": NO_COVER, "activity": ACTIVITY, "lunch": studio.get("lunch", {}),
         "teachers": [{"n": n, "g": groups.index(dash["teacher_groups"][n])} for n in names],
         "classes": classes, "ts": ts, "cs": cs, "duty": duty}
    return D, small_logo(dash.get("logo", ""))


def js_safe(s):
    return s.replace("</script", "<\\/script")


def main():
    D, logo = timetable()
    tt_json = json.dumps(D, ensure_ascii=False, separators=(",", ":"))
    (HERE / "data").mkdir(exist_ok=True)
    (HERE / "data" / "timetable-2-2569.json").write_text(tt_json, encoding="utf-8")

    engine = (SRC / "engine.js").read_text(encoding="utf-8")
    server = (SRC / "server.js").read_text(encoding="utf-8")
    client = (SRC / "client.html").read_text(encoding="utf-8")
    fake = (SRC / "fakegas.js").read_text(encoding="utf-8")
    demo = (SRC / "demo_boot.js").read_text(encoding="utf-8")
    client = client.replace("'/*__LOGO__*/'", json.dumps(logo))

    gas = HERE / "gas"; gas.mkdir(exist_ok=True)
    banner = "/* สร้างอัตโนมัติจาก substitution/src — อย่าแก้ไฟล์นี้โดยตรง (แก้ที่ src แล้วรัน build.py) */\n"
    (gas / "Code.gs").write_text(banner + engine + "\n\n" + server, encoding="utf-8")
    (gas / "Index.html").write_text(client.replace("<script>/*__ENGINE__*/</script>", "<script>\n" + js_safe(engine) + "\n</script>"), encoding="utf-8")
    (gas / "TimetableData.html").write_text(tt_json, encoding="utf-8")
    (gas / "appsscript.json").write_text(json.dumps({
        "timeZone": "Asia/Bangkok", "dependencies": {}, "exceptionLogging": "STACKDRIVER", "runtimeVersion": "V8",
        "webapp": {"executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS"}}, indent=2), encoding="utf-8")

    scripts = "".join(f"<script>\n{js_safe(x)}\n</script>\n" for x in [
        engine, fake, server, "window.__TT__ = " + tt_json + ";", demo])
    html = client.replace("<script>/*__ENGINE__*/</script>", scripts).replace(
        "<title>ระบบจัดสอนแทน KJST</title>", "<title>ระบบจัดสอนแทน KJST (ทดลอง)</title>")
    (HERE / "Substitution-Demo-2-2569.html").write_text(html, encoding="utf-8")
    print(f"teachers={len(D['teachers'])} classes={len(D['classes'])} · gas/Code.gs {len(engine+server)//1024} KB · "
          f"gas/Index.html · demo {len(html)//1024} KB")


if __name__ == "__main__":
    main()
