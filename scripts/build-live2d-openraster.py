"""Package the reconstructed transparent layers as an OpenRaster document.

Photopea and other raster editors can open OpenRaster and save a native PSD.
This gives Cubism a PSD written by a real editor instead of relying on the
hand-written PSD serializer used for the earlier scaffold.
"""

from __future__ import annotations

import html
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LAYER_DIR = ROOT / ".live2d" / "reconstructed"
SOURCE = ROOT / ".live2d" / "source" / "eri_call_bust_guide.png"
OUTPUT = LAYER_DIR / "eri_call_bust_reconstructed.ora"


LAYER_NAMES = [
    ("00_REFERENCE_GUIDE", True),
    ("01_BODY_BASE", False),
    ("02_BACK_HAIR", False),
    ("03_FACE_BASE", False),
    ("04_FRONT_HAIR", False),
    ("05_EYE_LEFT", False),
    ("05_EYE_RIGHT", False),
    ("06_MOUTH", False),
    ("07_BOW_LEFT", False),
    ("07_BOW_RIGHT", False),
    ("08_SLEEVES", False),
]


def main() -> None:
    LAYER_DIR.mkdir(parents=True, exist_ok=True)
    stack = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<image version="0.0.1" w="846" h="580" name="Erii_Call_Bust">',
        '  <stack name="Erii_Call_Bust" opacity="1.0">',
    ]
    for index, (name, hidden) in enumerate(LAYER_NAMES):
        file_name = f"data/{index:02d}_{name}.png"
        visibility = " hidden=\"true\"" if hidden else ""
        stack.append(
            f'    <layer name="{html.escape(name)}" src="{file_name}" x="0" y="0" opacity="1.0"{visibility}/>'
        )
    stack.extend(["  </stack>", "</image>"])

    with zipfile.ZipFile(OUTPUT, "w") as archive:
        archive.writestr("mimetype", "image/openraster", compress_type=zipfile.ZIP_STORED)
        archive.writestr("stack.xml", "\n".join(stack))
        archive.writestr("mergedimage.png", SOURCE.read_bytes())
        for index, (name, _hidden) in enumerate(LAYER_NAMES):
            source = SOURCE if index == 0 else LAYER_DIR / f"{name}.png"
            archive.writestr(f"data/{index:02d}_{name}.png", source.read_bytes())
    print(f"wrote {OUTPUT} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
