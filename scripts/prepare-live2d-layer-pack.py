"""Prepare transparent reference crops for the Erii Live2D bust model.

The source is still a flattened PNG.  This script creates *reference crops*
with stable coordinates and alpha, so a proper layered PSD can be assembled
without guessing the canvas positions again.  It does not claim to separate
occluded pixels or produce final Cubism ArtMeshes.
"""

from __future__ import annotations

import json
import struct
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / ".live2d" / "source" / "eri_call_bust_guide.png"
OUT = ROOT / ".live2d" / "layers"


def paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def read_rgba_png(path: Path) -> tuple[int, int, bytes]:
    raw = path.read_bytes()
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"not a PNG: {path}")
    pos = 8
    width = height = bit_depth = color_type = None
    chunks: list[bytes] = []
    while pos < len(raw):
        length = struct.unpack(">I", raw[pos : pos + 4])[0]
        kind = raw[pos + 4 : pos + 8]
        data = raw[pos + 8 : pos + 8 + length]
        pos += length + 12
        if kind == b"IHDR":
            width, height, bit_depth, color_type, _comp, _filt, interlace = struct.unpack(
                ">IIBBBBB", data
            )
            if bit_depth != 8 or color_type != 6 or interlace != 0:
                raise ValueError("expected a non-interlaced 8-bit RGBA PNG")
        elif kind == b"IDAT":
            chunks.append(data)
        elif kind == b"IEND":
            break
    if width is None or height is None:
        raise ValueError("PNG header missing")
    decoded = zlib.decompress(b"".join(chunks))
    row_bytes = width * 4
    stride = row_bytes + 1
    if len(decoded) != stride * height:
        raise ValueError("unexpected PNG payload size")
    rows: list[bytearray] = []
    for y in range(height):
        filt = decoded[y * stride]
        row = bytearray(decoded[y * stride + 1 : (y + 1) * stride])
        prev = rows[y - 1] if y else bytearray(row_bytes)
        for x in range(row_bytes):
            left = row[x - 4] if x >= 4 else 0
            up = prev[x]
            up_left = prev[x - 4] if x >= 4 else 0
            if filt == 1:
                row[x] = (row[x] + left) & 255
            elif filt == 2:
                row[x] = (row[x] + up) & 255
            elif filt == 3:
                row[x] = (row[x] + ((left + up) // 2)) & 255
            elif filt == 4:
                row[x] = (row[x] + paeth(left, up, up_left)) & 255
            elif filt != 0:
                raise ValueError(f"unsupported PNG filter {filt}")
        rows.append(row)
    return width, height, b"".join(rows)


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def write_rgba_png(path: Path, width: int, height: int, rgba: bytes) -> None:
    rows = bytearray()
    stride = width * 4
    for y in range(height):
        rows.append(0)
        rows.extend(rgba[y * stride : (y + 1) * stride])
    payload = zlib.compress(bytes(rows), 9)
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", payload)
        + png_chunk(b"IEND", b"")
    )


def crop_rgba(rgba: bytes, width: int, height: int, box: tuple[int, int, int, int]) -> tuple[int, int, bytes]:
    left, top, right, bottom = box
    left, top = max(0, left), max(0, top)
    right, bottom = min(width, right), min(height, bottom)
    if right <= left or bottom <= top:
        raise ValueError(f"invalid crop {box}")
    out = bytearray()
    for y in range(top, bottom):
        start = (y * width + left) * 4
        out.extend(rgba[start : start + (right - left) * 4])
    return right - left, bottom - top, bytes(out)


def draw_rect(rgba: bytearray, width: int, height: int, box: tuple[int, int, int, int], color: tuple[int, int, int, int]) -> None:
    left, top, right, bottom = box
    left, top = max(0, left), max(0, top)
    right, bottom = min(width - 1, right - 1), min(height - 1, bottom - 1)
    for x in range(left, right + 1):
        for y in (top, bottom):
            i = (y * width + x) * 4
            rgba[i : i + 4] = bytes(color)
    for y in range(top, bottom + 1):
        for x in (left, right):
            i = (y * width + x) * 4
            rgba[i : i + 4] = bytes(color)


def main() -> None:
    width, height, rgba = read_rgba_png(SOURCE)
    OUT.mkdir(parents=True, exist_ok=True)

    # Coordinates are in the original 846x580 bust canvas.  They intentionally
    # overlap: the pack is a visual guide, not a final occlusion mask.
    layers = {
        "00_reference_flat": (0, 0, width, height, "guide"),
        "01_body": (210, 230, 635, height, "body"),
        "02_back_hair": (0, 0, width, 580, "back_hair"),
        "03_face": (320, 75, 530, 270, "face"),
        "04_front_hair": (245, 25, 605, 285, "front_hair"),
        "05_eye_left": (355, 145, 415, 205, "eye"),
        "05_eye_right": (430, 145, 490, 205, "eye"),
        "06_mouth": (395, 198, 452, 238, "mouth"),
        "07_bow_left": (245, 80, 340, 235, "accessory"),
        "07_bow_right": (505, 80, 600, 235, "accessory"),
        "08_left_sleeve": (205, 275, 390, height, "body"),
        "08_right_sleeve": (455, 275, 640, height, "body"),
        "09_hand_gesture_area": (250, 420, 596, height, "gesture_guide"),
    }

    manifest = {
        "source": str(SOURCE.relative_to(ROOT)).replace("\\", "/"),
        "canvas": {"width": width, "height": height},
        "status": "reference_crops_only",
        "warning": "Flattened source; crops contain overlapping pixels and require cleanup/reconstruction before Cubism rigging.",
        "layers": [],
    }
    alignment = bytearray(rgba)
    palette = {
        "body": (255, 160, 60, 255),
        "back_hair": (120, 170, 255, 255),
        "face": (255, 90, 150, 255),
        "front_hair": (190, 100, 255, 255),
        "eye": (60, 235, 180, 255),
        "mouth": (255, 230, 70, 255),
        "accessory": (255, 120, 80, 255),
        "gesture_guide": (150, 150, 150, 255),
        "guide": (255, 255, 255, 255),
    }
    for name, (left, top, right, bottom, role) in layers.items():
        cw, ch, data = crop_rgba(rgba, width, height, (left, top, right, bottom))
        filename = f"{name}.png"
        write_rgba_png(OUT / filename, cw, ch, data)
        manifest["layers"].append(
            {
                "name": name,
                "file": filename,
                "role": role,
                "canvas_box": [left, top, right, bottom],
                "size": [cw, ch],
                "needs_cleanup": role not in {"guide", "gesture_guide"},
            }
        )
        if role != "guide":
            draw_rect(alignment, width, height, (left, top, right, bottom), palette[role])

    write_rgba_png(OUT / "layer-alignment-guide.png", width, height, bytes(alignment))
    manifest["alignmentGuide"] = "layer-alignment-guide.png"

    (OUT / "layer-pack.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"prepared {len(layers)} reference crops in {OUT}")


if __name__ == "__main__":
    main()
