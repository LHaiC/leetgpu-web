"""Generate web/icons.js from the lucide-static SVG set.

We use 30 icons; shipping the whole 350 KB lucide UMD bundle for that is wasteful
and adds a third-party request. This bakes just the icons we use into a plain JS
map, which ``refreshIcons()`` splices into the DOM.
"""
import json
import re
import urllib.request
from pathlib import Path

NAMES = """activity braces chart-no-axes-column check chevron-right circle-check
copy file-code-2 file-input file-text flask-conical github keyboard languages
log-out panel-left redo-2 rotate-ccw search send shield terminal terminal-square
trash-2 trophy undo-2 user-round users wrench x
circle-check-big circle-x loader-circle file-down user-check user-x""".split()

BASE = "https://unpkg.com/lucide-static@0.468.0/icons/{}.svg"

# Names the old lucide bundle resolved as aliases.
ALIASES = {"terminal-square": "square-terminal"}

icons = {}
for name in NAMES:
    source = ALIASES.get(name, name)
    with urllib.request.urlopen(BASE.format(source), timeout=20) as response:
        svg = response.read().decode("utf-8")
    svg = re.sub(r"<!--.*?-->", "", svg, flags=re.S)
    inner = svg[svg.index(">", svg.index("<svg")) + 1 : svg.rindex("</svg>")]
    inner = re.sub(r">\s+<", "><", inner.strip())
    inner = re.sub(r"\s+", " ", inner)
    icons[name] = inner

out = Path("/nvme/hcliu/projects/leetgpu/leetgpu-local/web/icons.js")
lines = [
    "/* Lucide icons (ISC) baked to path data for the 30 glyphs this UI uses.",
    " * Regenerate with scripts/build_icons.py — do not edit by hand. */",
    "window.LEET_ICONS = {",
]
for name, inner in icons.items():
    lines.append(f'  "{name}": {json.dumps(inner)},')
lines.append("};")
out.write_text("\n".join(lines) + "\n", encoding="utf-8")
print(f"wrote {out} with {len(icons)} icons, {out.stat().st_size} bytes")
print("missing:", [n for n in NAMES if n not in icons])
