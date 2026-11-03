#!/usr/bin/env python3
"""
สร้างไฟล์ mockup ระบบจัดสอนแทน จากข้อมูลตารางสอนที่ฝังอยู่ใน Dashboard-2-2569.html

ใช้งาน (รันจากโฟลเดอร์ราก repo):
    python3 substitution/build_data.py

อ่าน:   Dashboard-2-2569.html            (แหล่งข้อมูลหลัก — ตารางสอนครู/ตารางเรียนห้อง ฉบับล่าสุด)
        KJST_TimeTable_Studio_2-2569.html (ใช้เฉพาะข้อมูลเวร duty)
เขียน:  substitution/data/timetable-2-2569.json
        substitution/Substitution-Mockup-2-2569.html  (template + ข้อมูล)
"""
import base64
import io
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent

# กิจกรรมที่ "ไม่ใช่คาบสอน" — ไม่ต้องจัดสอนแทน (แต่ถือว่าครูไม่ว่างในคาบนั้น)
# ชุมนุม/ลูกเสือ เป็นกิจกรรมพร้อมกันทั้งโรงเรียน/ทั้งระดับ ครูทุกคนติดกิจกรรม จึงหาผู้สอนแทนไม่ได้
# → ให้ครูร่วมกิจกรรม/หัวหน้ากิจกรรมดูแลแทน
NO_COVER = {"HR", "MEET", "PLC", "ประชุม", "ชุมนุม", "ลูกเสือ"}


def embedded_json(path: Path):
    text = path.read_text(encoding="utf-8")
    m = re.search(r'<script id="data" type="application/json">(.*?)</script>', text, re.S)
    if not m:
        raise SystemExit(f"ไม่พบข้อมูล JSON ใน {path.name}")
    return json.loads(m.group(1))


def small_logo(data_uri: str, size: int = 96) -> str:
    try:
        from PIL import Image
    except ImportError:
        return ""
    raw = base64.b64decode(data_uri.split(",", 1)[1])
    img = Image.open(io.BytesIO(raw)).convert("RGBA")
    img.thumbnail((size, size))
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def main():
    dash = embedded_json(ROOT / "Dashboard-2-2569.html")
    studio = embedded_json(ROOT / "KJST_TimeTable_Studio_2-2569.html")

    days = dash["days"]
    groups = dash["group_order"]
    names = dash["sorted_teachers"]
    tidx = {n: i for i, n in enumerate(names)}
    classes = dash["sorted_classes"]

    teachers = [{"n": n, "g": groups.index(dash["teacher_groups"][n])} for n in names]

    # ตารางสอนครู: ts[ti] = [[day, period, code, subject, class, room], ...]
    ts = []
    for n in names:
        rows = []
        for di, day in enumerate(days):
            for p, c in sorted(dash["teachers"][n].get(day, {}).items(), key=lambda x: int(x[0])):
                rows.append([di, int(p), c["code"], c["subject"], c["class"], c["room"]])
        ts.append(rows)

    # ตารางเรียนห้อง: cs[class] = [[day, period, code, subject, [ti...], room], ...]
    cs = {}
    for cl in classes:
        rows = []
        for di, day in enumerate(days):
            for p, c in sorted(dash["classes"][cl].get(day, {}).items(), key=lambda x: int(x[0])):
                rows.append([di, int(p), c["code"], c["subject"],
                             [tidx[t] for t in c["teachers"] if t in tidx], c["room"]])
        cs[cl] = rows

    # เวร (จาก Studio) — ใช้เป็น "คำเตือน" ไม่ตัดสิทธิ์
    duty = {}
    for n, items in studio.get("duty", {}).items():
        if n not in tidx:
            continue
        duty[tidx[n]] = [[d, p, it["label"]] for it in items for d, p in it["cells"]]

    data = {
        "term": "2/2569",
        "school": "โรงเรียนกาญจนาภิเษกวิทยาลัย สุราษฎร์ธานี",
        "source": "Dashboard-2-2569.html",
        "days": days,
        "times": dash["period_times"],
        "groups": groups,
        "noCover": sorted(NO_COVER),
        "lunch": studio.get("lunch", {}),
        "teachers": teachers,
        "classes": classes,
        "ts": ts,
        "cs": cs,
        "duty": duty,
    }

    out_dir = HERE / "data"
    out_dir.mkdir(exist_ok=True)
    (out_dir / "timetable-2-2569.json").write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    data["logo"] = small_logo(dash.get("logo", ""))
    tpl = (HERE / "src" / "app.template.html").read_text(encoding="utf-8")
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    html = tpl.replace("/*__DATA__*/null", payload)
    (HERE / "Substitution-Mockup-2-2569.html").write_text(html, encoding="utf-8")
    print(f"teachers={len(teachers)} classes={len(classes)} "
          f"slots={sum(len(r) for r in ts)} -> Substitution-Mockup-2-2569.html "
          f"({len(html)//1024} KB)")


if __name__ == "__main__":
    main()
