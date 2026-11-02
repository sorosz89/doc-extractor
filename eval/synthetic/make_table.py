"""Synthetic nutrient table: one source of truth -> .xlsx, .html (for the screenshot), .truth.json.

Values are random, not real nutrition data, on purpose: the model cannot "fix"
a cell from what it knows about butter, so it has to read it. Because the
truth file is written from the same data that is rendered, the ground truth is
exact by construction — no hand-typed cells.

This is the clean, easy case (an upper bound). The real skewed photo is the
hard one; milestone 5 can add skew and noise to these renders.

Usage (needs `pip install openpyxl` and Google Chrome):

    python eval/synthetic/make_table.py <name> eval/dataset <html-dir> [seed]
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
      --hide-scrollbars --force-device-scale-factor=1.5 --window-size=1000,1330 \
      --screenshot=eval/dataset/<name>.png "file://<html-dir>/<name>.html"
"""
import html
import json
import random
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, Side

name = sys.argv[1]
out_dir = Path(sys.argv[2])
html_dir = Path(sys.argv[3])
seed = int(sys.argv[4]) if len(sys.argv) > 4 else 1
rng = random.Random(seed)

DOCUMENT_TITLE = "Tápanyagtáblázat"
TABLE_TITLE = "Az élelmiszerek tápanyagtartalma 100 g ehető részben"
COLUMNS = [
    ("Élelmiszer", None),
    ("Energia", "kJ"),
    ("Energia", "kcal"),
    ("Fehérje", "g"),
    ("Zsír", "g"),
    ("Szénhidrát", "g"),
    ("Rost", "g"),
    ("Nátrium", "mg"),
    ("Kalcium", "mg"),
    ("Magnézium", "mg"),
    ("Retinol ekv.", "µg"),
    ("E-vitamin", "mg"),
]
FOOTNOTES = ["- = nincs adat; <0,1 = nyomokban"]
SOURCE = "Forrás: szintetikus adatok, kizárólag tesztelési célra."

SECTIONS = [
    ("Gabonafélék, kenyerek, pékáruk", [
        "Búzakenyér, fehér", "Rozskenyér", "Graham kenyér", "Kifli", "Zsemle",
        "Kalács", "Zabpehely", "Rizs, hántolt", "Tészta, száraz",
    ]),
    ("Tej és tejtermékek", [
        "Tej, 2,8%", "Tejföl, 20%", "Joghurt, natúr", "Trappista sajt",
        "Túró, félzsíros", "Vaj",
    ]),
    ("Húsok, halak, tojás", [
        "Csirkemell", "Sertéskaraj", "Marhahús, sovány", "Pulykacomb",
        "Ponty", "Tojás, egész", "Sonka, főtt",
    ]),
    ("Zöldségek, gyümölcsök", [
        "Burgonya", "Sárgarépa", "Paradicsom", "Paprika, zöld", "Káposzta",
        "Alma", "Banán", "Narancs", "Szilva", "Dió",
    ]),
]


def dec(value: float, places: int = 1) -> str:
    """Hungarian decimal comma, as printed."""
    return f"{value:.{places}f}".replace(".", ",")


def sparse(chance: float, low: float, high: float, places: int = 1) -> str:
    """Mostly '-' (no data), sometimes trace, sometimes a value: the drift-prone columns."""
    roll = rng.random()
    if roll < chance:
        return "-"
    if roll < chance + 0.08:
        return "<0,1"
    return dec(rng.uniform(low, high), places)


def food_row(food: str) -> list[str]:
    kj = rng.randint(80, 3000)
    return [
        food,
        str(kj),
        str(round(kj / 4.184)),
        dec(rng.uniform(0.2, 26)),
        dec(rng.uniform(0.1, 30)),
        dec(rng.uniform(0, 75)),
        sparse(0.25, 0.2, 9),
        str(rng.randint(1, 900)),
        sparse(0.35, 2, 700, 0),
        sparse(0.55, 5, 120),
        sparse(0.65, 1, 900, 0),
        sparse(0.6, 0.1, 6),
    ]


# One list of display rows, in page order: ("divider", text) or ("food", cells).
display: list[tuple[str, object]] = []
rows: list[list[str]] = []
for divider, foods in SECTIONS:
    display.append(("divider", divider))
    for food in foods:
        cells = food_row(food)
        display.append(("food", cells))
        rows.append(cells)

assert len(rows) == 32, len(rows)

# --- truth -----------------------------------------------------------------
truth = {
    "image": f"{name}.png",
    "type": "table",
    "expected": {
        "documentTitle": DOCUMENT_TITLE,
        "tables": [{
            "title": TABLE_TITLE,
            "columns": [{"header": h, "unit": u} for h, u in COLUMNS],
            "rows": rows,
            "footnotes": FOOTNOTES,
        }],
        # Section dividers are not data rows; the schema sends their text to notes.
        "notes": [d for d, _ in SECTIONS] + [SOURCE],
    },
}
(out_dir / f"{name}.truth.json").write_text(json.dumps(truth, ensure_ascii=False, indent=2) + "\n")

# --- xlsx ------------------------------------------------------------------
wb = Workbook()
ws = wb.active
ws.title = "Tápanyagtáblázat"
font = Font(name="Arial", size=10)
bold = Font(name="Arial", size=10, bold=True)
thin = Side(style="thin", color="999999")
grid = Border(left=thin, right=thin, top=thin, bottom=thin)
width = len(COLUMNS)

ws["A1"] = DOCUMENT_TITLE
ws["A1"].font = Font(name="Arial", size=16, bold=True)
ws["A2"] = TABLE_TITLE
ws["A2"].font = Font(name="Arial", size=11, italic=True)

r = 4
for c, (header, _) in enumerate(COLUMNS, start=1):
    cell = ws.cell(row=r, column=c, value=header)
    cell.font, cell.border = bold, grid
    cell.alignment = Alignment(horizontal="center", wrap_text=True)
r += 1
for c, (_, unit) in enumerate(COLUMNS, start=1):
    cell = ws.cell(row=r, column=c, value=unit)
    cell.font, cell.border = font, grid
    cell.alignment = Alignment(horizontal="center")
r += 1
for kind, payload in display:
    if kind == "divider":
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=width)
        cell = ws.cell(row=r, column=1, value=payload)
        cell.font = bold
    else:
        for c, value in enumerate(payload, start=1):
            # Stored as text: the sheet must show exactly what the truth says.
            cell = ws.cell(row=r, column=c, value=value)
            cell.number_format = "@"
            cell.font, cell.border = font, grid
            cell.alignment = Alignment(horizontal="left" if c == 1 else "right")
    r += 1
r += 1
for note in FOOTNOTES:
    ws.cell(row=r, column=1, value=note).font = Font(name="Arial", size=9)
    r += 1
ws.cell(row=r, column=1, value=SOURCE).font = Font(name="Arial", size=9, italic=True)
ws.column_dimensions["A"].width = 26
for c in range(2, width + 1):
    ws.column_dimensions[ws.cell(row=1, column=c).column_letter].width = 10
wb.save(out_dir / f"{name}.xlsx")

# --- html (what gets screenshotted) ----------------------------------------
e = html.escape
parts = [
    "<!DOCTYPE html><html lang='hu'><meta charset='utf-8'><style>",
    "body{font-family:Arial,sans-serif;margin:28px;color:#111;background:#fff}",
    "h1{font-size:24px;margin:0 0 4px} .sub{font-style:italic;margin:0 0 14px}",
    "table{border-collapse:collapse;font-size:13px}",
    "th,td{border:1px solid #999;padding:3px 6px} th{background:#f2f2f2}",
    "td.n{text-align:right} tr.div td{border:none;font-weight:bold;padding-top:9px}",
    ".foot{font-size:12px;margin-top:10px} .src{font-size:12px;font-style:italic}",
    "</style><body>",
    f"<h1>{e(DOCUMENT_TITLE)}</h1><p class='sub'>{e(TABLE_TITLE)}</p><table>",
    "<tr>" + "".join(f"<th>{e(h)}</th>" for h, _ in COLUMNS) + "</tr>",
    "<tr>" + "".join(f"<th>{e(u or '')}</th>" for _, u in COLUMNS) + "</tr>",
]
for kind, payload in display:
    if kind == "divider":
        parts.append(f"<tr class='div'><td colspan='{width}'>{e(payload)}</td></tr>")
    else:
        parts.append("<tr>" + "".join(
            f"<td{'' if i == 0 else ' class=n'}>{e(v)}</td>" for i, v in enumerate(payload)) + "</tr>")
parts.append("</table>")
parts += [f"<p class='foot'>{e(n)}</p>" for n in FOOTNOTES]
parts.append(f"<p class='src'>{e(SOURCE)}</p></body></html>")
(html_dir / f"{name}.html").write_text("".join(parts))
print("ok", len(rows), "rows")
