"""Build a first-pass reconstructed PSD from the flattened bust PNG.

This is a derived model source, not recovery of the original ChatGPT artwork
layers.  It keeps the original composite as a hidden guide and creates rough
full-canvas layers for the parts needed by Cubism.  The face and eye masks are
deliberately conservative so the PSD is useful as a starting point while
leaving the final cleanup visible to the artist.
"""

from __future__ import annotations

import importlib.util
import struct
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / ".live2d" / "source" / "eri_call_bust_guide.png"
OUT_DIR = ROOT / ".live2d" / "reconstructed"
OUT_PSD = OUT_DIR / "eri_call_bust_reconstructed.psd"


def load_png_helpers():
    path = Path(__file__).with_name("create-live2d-psd.py")
    spec = importlib.util.spec_from_file_location("live2d_psd_helpers", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("unable to load PSD helpers")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def write_rgba_png(path: Path, width: int, height: int, rgba: bytes) -> None:
    rows = bytearray()
    stride = width * 4
    for y in range(height):
        rows.append(0)
        rows.extend(rgba[y * stride : (y + 1) * stride])
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", zlib.compress(bytes(rows), 9))
        + png_chunk(b"IEND", b"")
    )


def clear_outside(data: bytes, width: int, height: int, keep) -> bytes:
    out = bytearray(data)
    for y in range(height):
        for x in range(width):
            if not keep(x, y):
                out[(y * width + x) * 4 + 3] = 0
    return bytes(out)


def ellipse(cx: float, cy: float, rx: float, ry: float):
    return lambda x, y: ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0


def rectangle(left: int, top: int, right: int, bottom: int):
    return lambda x, y: left <= x < right and top <= y < bottom


def union(*predicates):
    return lambda x, y: any(p(x, y) for p in predicates)


def subtract(base, *holes):
    return lambda x, y: base(x, y) and not any(h(x, y) for h in holes)


def fill_face_holes(data: bytes, width: int, height: int) -> bytes:
    """Paint a soft skin-color placeholder under eye/mouth openings."""
    out = bytearray(data)
    holes = union(
        ellipse(386, 176, 30, 20),
        ellipse(461, 176, 30, 20),
        ellipse(423, 221, 22, 11),
    )
    # Sample a light skin color from opaque pixels around the center of the face.
    samples = []
    for y in range(185, 214):
        for x in range(400, 447):
            i = (y * width + x) * 4
            r, g, b, a = data[i : i + 4]
            if a > 160 and r > g + 10 and g > b + 5 and r > 150:
                samples.append((r, g, b))
    if samples:
        color = tuple(sum(c[i] for c in samples) // len(samples) for i in range(3))
    else:
        color = (239, 190, 180)
    for y in range(height):
        for x in range(width):
            if holes(x, y):
                i = (y * width + x) * 4
                # Preserve the face layer's alpha while replacing the original
                # eye/mouth pixels with a paint-over color.
                if out[i + 3] > 0:
                    out[i : i + 4] = bytes((*color, 255))
    return bytes(out)


def build_layers(helper, width: int, height: int, rgba: bytes):
    face_area = ellipse(423, 175, 92, 110)
    left_eye = ellipse(386, 176, 30, 20)
    right_eye = ellipse(461, 176, 30, 20)
    mouth = ellipse(423, 221, 22, 11)
    layers = []
    layers.append(("00_REFERENCE_GUIDE", rgba, True))

    body = clear_outside(rgba, width, height, lambda x, y: y >= 245)
    layers.append(("01_BODY_BASE", body, False))

    back_hair = clear_outside(
        rgba,
        width,
        height,
        union(
            rectangle(0, 70, 350, height),
            rectangle(500, 70, width, height),
            rectangle(300, 20, 548, 110),
        ),
    )
    layers.append(("02_BACK_HAIR", back_hair, False))

    face = clear_outside(rgba, width, height, face_area)
    face = fill_face_holes(face, width, height)
    layers.append(("03_FACE_BASE", face, False))

    front_hair = clear_outside(
        rgba,
        width,
        height,
        union(
            rectangle(315, 25, 535, 145),
            rectangle(255, 95, 355, 290),
            rectangle(490, 95, 590, 290),
        ),
    )
    layers.append(("04_FRONT_HAIR", front_hair, False))

    layers.append(("05_EYE_LEFT", clear_outside(rgba, width, height, left_eye), False))
    layers.append(("05_EYE_RIGHT", clear_outside(rgba, width, height, right_eye), False))
    layers.append(("06_MOUTH", clear_outside(rgba, width, height, mouth), False))

    left_bow = clear_outside(rgba, width, height, rectangle(245, 80, 345, 240))
    right_bow = clear_outside(rgba, width, height, rectangle(500, 80, 600, 240))
    layers.append(("07_BOW_LEFT", left_bow, False))
    layers.append(("07_BOW_RIGHT", right_bow, False))

    sleeves = clear_outside(rgba, width, height, union(rectangle(205, 270, 395, height), rectangle(450, 270, 645, height)))
    layers.append(("08_SLEEVES", sleeves, False))
    return layers


def build_psd(helper, width: int, height: int, layers):
    records = b"".join(
        helper.make_layer_record(name, width, height, rgba, hidden, 255, True)
        for name, rgba, hidden in layers
    )
    pixels = b"".join(helper.layer_pixels(rgba, width, height, hidden, True) for _, rgba, hidden in layers)
    layer_info = struct.pack(">h", -len(layers)) + records + pixels
    layer_info += b"\0" * ((4 - len(layer_info) % 4) % 4)
    layer_mask = struct.pack(">I", len(layer_info)) + layer_info + struct.pack(">I", 0)

    header = b"8BPS" + struct.pack(">H", 1) + b"\0" * 6
    header += struct.pack(">HIIHH", 4, height, width, 8, 3)
    color_mode = struct.pack(">I", 0)
    resources = struct.pack(">I", 0)
    # Keep the original composite as the merged image, regardless of the
    # rough reconstruction layers above it.
    guide = layers[0][1]
    channels = (0, 1, 2, -1)
    encoded = [helper.rle_channel(helper.channel_bytes(guide, channel), width, height) for channel in channels]
    composite = struct.pack(">H", 1)
    composite += b"".join(item[: 2 * height] for item in encoded)
    composite += b"".join(item[2 * height :] for item in encoded)
    return header + color_mode + resources + struct.pack(">I", len(layer_mask)) + layer_mask + composite


def build_psd_raw(helper, width: int, height: int, layers):
    """Write an uncompressed PSD variant for readers with strict PackBits support."""
    channels = (0, 1, 2, -1)
    records = bytearray()
    pixel_data = bytearray()
    for name, rgba, hidden in layers:
        records.extend(struct.pack(">iiiiH", 0, 0, height, width, len(channels)))
        for channel in channels:
            data = bytes(len(rgba)) if hidden else helper.channel_bytes(rgba, channel)
            records.extend(struct.pack(">hI", channel, 2 + len(data)))
        records.extend(b"8BIMnorm")
        # PSD layer flags: bit 1 means visible; bit 3 identifies the
        # Photoshop 5.0+ flag layout. Keep hidden guide layers hidden while
        # leaving the artwork layers visible to strict readers.
        records.extend(bytes([255, 0, (0x08 if hidden else 0x0A), 0]))
        name_bytes = helper.pascal_name(name)
        records.extend(struct.pack(">I", 8 + len(name_bytes)))
        records.extend(struct.pack(">I", 0))
        records.extend(struct.pack(">I", 0))
        records.extend(name_bytes)
        for channel in channels:
            data = bytes(len(rgba)) if hidden else helper.channel_bytes(rgba, channel)
            pixel_data.extend(struct.pack(">H", 0))
            pixel_data.extend(data)
    info = struct.pack(">h", len(layers)) + bytes(records) + bytes(pixel_data)
    info += b"\0" * ((4 - len(info) % 4) % 4)
    layer_mask = struct.pack(">I", len(info)) + info + struct.pack(">I", 0)

    header = b"8BPS" + struct.pack(">H", 1) + b"\0" * 6
    header += struct.pack(">HIIHH", 4, height, width, 8, 3)
    color_mode = struct.pack(">I", 0)
    resources = struct.pack(">I", 0)
    guide = layers[0][1]
    composite = struct.pack(">H", 0) + b"".join(helper.channel_bytes(guide, c) for c in channels)
    return header + color_mode + resources + struct.pack(">I", len(layer_mask)) + layer_mask + composite


def main() -> None:
    helper = load_png_helpers()
    width, height, rgba = helper.read_rgba_png(SOURCE)
    layers = build_layers(helper, width, height, rgba)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, layer, _hidden in layers:
        helper_path = OUT_DIR / f"{name}.png"
        write_rgba_png(helper_path, width, height, layer)
    OUT_PSD.write_bytes(build_psd(helper, width, height, layers))
    raw_path = OUT_DIR / "eri_call_bust_reconstructed_raw.psd"
    raw_path.write_bytes(build_psd_raw(helper, width, height, layers))
    print(f"wrote reconstructed PSDs: {OUT_PSD} and {raw_path} ({width}x{height}, {len(layers)} layers)")


if __name__ == "__main__":
    main()
