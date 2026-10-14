"""Build a self-hosted subset of the Material Symbols Outlined variable font.

Only the icons listed in ``apps/web/src/components/Icon/iconNames.ts`` are kept, so the
browser downloads a few kilobytes instead of the ~4 MB full font. Every name must be in the
*current canonical* Material Symbols set (``material-symbols/index.d.ts``) and must resolve to
a ligature in the font; legacy aliases (e.g. ``terrain``) are rejected so the UI only uses
names that exist in the current set.

Run: ``uv run python -m scripts.build_icon_font`` (after ``npm install``).
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / "node_modules" / "material-symbols"
SOURCE_FONT = PKG / "material-symbols-outlined.woff2"
CANONICAL_LIST = PKG / "index.d.ts"
NAMES_FILE = ROOT / "apps/web/src/components/Icon/iconNames.ts"
OUT_FONT = ROOT / "apps/web/src/assets/fonts/material-symbols-outlined-subset.woff2"
LOCK_FILE = ROOT / "apps/web/src/components/Icon/icon-subset.lock.json"


def canonical_names() -> set[str]:
    return set(re.findall(r'^\s+"([^"]+)",?$', CANONICAL_LIST.read_text(), re.MULTILINE))


def font_ligatures(font: TTFont) -> set[str]:
    reverse_cmap = {glyph: chr(code) for code, glyph in font.getBestCmap().items()}
    names: set[str] = set()
    for lookup in font["GSUB"].table.LookupList.Lookup:
        for sub in lookup.SubTable:
            table = getattr(sub, "ExtSubTable", sub)
            for first, ligatures in getattr(table, "ligatures", {}).items():
                for lig in ligatures:
                    chars = [reverse_cmap.get(first, "")]
                    chars += [reverse_cmap.get(c, "") for c in lig.Component]
                    names.add("".join(chars))
    return names


def read_icon_names() -> list[str]:
    source = NAMES_FILE.read_text()
    block = re.search(r"ICON_NAMES = \[(.*?)\] as const", source, re.DOTALL)
    if block is None:
        raise SystemExit(f"Could not find ICON_NAMES in {NAMES_FILE}")
    return re.findall(r"'([a-z0-9_]+)'", block.group(1))


def main() -> int:
    names = read_icon_names()
    if names != sorted(set(names)):
        print(f"{NAMES_FILE.name} must be sorted and free of duplicates.", file=sys.stderr)
        return 1

    font = TTFont(SOURCE_FONT, lazy=False, recalcTimestamp=False)
    canonical = canonical_names()
    ligatures = font_ligatures(font)
    invalid = [n for n in names if n not in canonical or n not in ligatures]
    if invalid:
        print(f"Not in the current Material Symbols set: {', '.join(invalid)}", file=sys.stderr)
        return 1

    # Drop every ligature that spells a name we did not ask for; otherwise the glyph closure
    # would keep all ~4,300 icons reachable from the same letters.
    keep = set(names)
    reverse_cmap = {glyph: chr(code) for code, glyph in font.getBestCmap().items()}
    for lookup in font["GSUB"].table.LookupList.Lookup:
        for sub in lookup.SubTable:
            table = getattr(sub, "ExtSubTable", sub)
            if not hasattr(table, "ligatures"):
                continue
            for first in list(table.ligatures):
                prefix = reverse_cmap.get(first, "")
                kept = [
                    lig
                    for lig in table.ligatures[first]
                    if prefix + "".join(reverse_cmap.get(c, "") for c in lig.Component) in keep
                ]
                if kept:
                    table.ligatures[first] = kept
                else:
                    del table.ligatures[first]

    options = subset.Options()
    options.layout_features = ["liga", "rlig", "calt"]
    options.flavor = "woff2"
    subsetter = subset.Subsetter(options)
    # Ligatures are formed from lowercase letters, digits and the underscore.
    subsetter.populate(text="".join(sorted(set("".join(names)))) + " ")
    subsetter.subset(font)

    # Pin the (unused) grade axis; keep FILL, wght and opsz for states and sizes.
    font = instancer.instantiateVariableFont(font, {"GRAD": 0})

    OUT_FONT.parent.mkdir(parents=True, exist_ok=True)
    font.flavor = "woff2"
    font.save(OUT_FONT)

    missing = [n for n in names if n not in font_ligatures(TTFont(OUT_FONT))]
    if missing:
        print(f"Subset lost ligatures: {', '.join(missing)}", file=sys.stderr)
        return 1

    lock = {
        "names": names,
        "source": f"material-symbols@{json.loads((PKG / 'package.json').read_text())['version']}",
        "sha256": hashlib.sha256(OUT_FONT.read_bytes()).hexdigest(),
    }
    LOCK_FILE.write_text(json.dumps(lock, indent=2) + "\n")
    print(
        f"Wrote {OUT_FONT.relative_to(ROOT)} ({OUT_FONT.stat().st_size / 1024:.1f} KiB, "
        f"{len(names)} icons)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
