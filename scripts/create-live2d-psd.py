"""Build a Cubism-importable PSD scaffold from the bust reference PNG.

The source artwork is a flattened PNG, so this file deliberately keeps the
reference visible on one layer and adds named hidden placeholder layers.  The
placeholders make the intended Cubism layer structure explicit without
pretending that the artwork has already been separated cleanly.
"""

from __future__ import annotations

import struct
import sys
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / ".live2d" / "source" / "eri_call_bust_guide.png"
OUTPUT = ROOT / ".live2d" / "source" / "eri_call_bust_template.psd"


def paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)
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
        pos += 12 + length
        if kind == b"IHDR":
            width, height, bit_depth, color_type, comp, filt, interlace = struct.unpack(
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
        src = decoded[y * stride + 1 : (y + 1) * stride]
        row = bytearray(src)
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


def channel_bytes(rgba: bytes, channel: int) -> bytes:
    """Return a PSD channel in top-to-bottom row order."""
    if channel == 0:
        return rgba[0::4]
    if channel == 1:
        return rgba[1::4]
    if channel == 2:
        return rgba[2::4]
    if channel == -1:
        return rgba[3::4]
    raise ValueError(channel)


def packbits_row(row: bytes) -> bytes:
    """Encode one row with the PackBits variant used by PSD RLE."""
    out = bytearray()
    i = 0
    while i < len(row):
        run = 1
        while i + run < len(row) and row[i + run] == row[i] and run < 128:
            run += 1
        if run >= 3:
            out.append(257 - run)
            out.append(row[i])
            i += run
            continue
        start = i
        i += run
        while i < len(row) and i - start < 128:
            look = 1
            while i + look < len(row) and row[i + look] == row[i] and look < 3:
                look += 1
            if look >= 3:
                break
            i += look
        literal = row[start:i]
        out.append(len(literal) - 1)
        out.extend(literal)
    return bytes(out)


def rle_channel(data: bytes, width: int, height: int) -> bytes:
    counts = bytearray()
    body = bytearray()
    for y in range(height):
        encoded = packbits_row(data[y * width : (y + 1) * width])
        counts += struct.pack(">H", len(encoded))
        body += encoded
    return bytes(counts + body)


def pascal_name(name: str) -> bytes:
    data = name.encode("ascii", "replace")[:255]
    out = bytes([len(data)]) + data
    return out + b"\0" * ((4 - len(out) % 4) % 4)


def make_layer_record(name: str, width: int, height: int, rgba: bytes, hidden: bool, opacity: int, include_alpha: bool) -> bytes:
    channels = (0, 1, 2, -1) if include_alpha else (0, 1, 2)
    out = bytearray()
    out += struct.pack(">iiiiH", 0, 0, height, width, len(channels))
    for channel in channels:
        data = bytes(len(rgba)) if hidden else channel_bytes(rgba, channel)
        out += struct.pack(">hI", channel, 2 + len(rle_channel(data, width, height)))
    out += b"8BIMnorm"
    # Adobe's PSD specification defines bit 1 as the visibility bit: set means
    # visible. Bit 3 marks the Photoshop 5.0+ flag layout. The previous
    # scaffold accidentally inverted visibility, which could make Cubism show
    # an empty document even though the layer records were present.
    flags = (0x08 if hidden else 0x0A)
    out += bytes([opacity, 0, flags, 0])
    extra = pascal_name(name)
    out += struct.pack(">I", 4 + 4 + len(extra))
    out += struct.pack(">I", 0)  # layer mask data
    out += struct.pack(">I", 0)  # blending ranges data
    out += extra
    return bytes(out)


def layer_pixels(rgba: bytes, width: int, height: int, hidden: bool, include_alpha: bool) -> bytes:
    channels = (0, 1, 2, -1) if include_alpha else (0, 1, 2)
    if hidden:
        rgba = bytes(len(rgba))
    out = bytearray()
    for channel in channels:
        data = channel_bytes(rgba, channel)
        out += struct.pack(">H", 1)  # PackBits RLE compression
        out += rle_channel(data, width, height)
    return bytes(out)


def build_psd(width: int, height: int, rgba: bytes, scaffold: bool = True, include_alpha: bool = True) -> bytes:
    # One visible reference layer plus named hidden placeholders.  Cubism can
    # import the scaffold, and the hidden layers can later be replaced by
    # cleanly separated artwork without changing the naming contract.
    names = [("ERI_REFERENCE_BUST", False, 255)]
    if scaffold:
        names += [
            ("01_BODY_BASE", True, 255),
            ("02_BACK_HAIR", True, 255),
            ("03_FACE", True, 255),
            ("04_FRONT_HAIR", True, 255),
            ("05_EYES", True, 255),
            ("06_MOUTH", True, 255),
            ("07_ACCESSORIES", True, 255),
            ("08_HAND_GESTURES", True, 255),
        ]
    records = b"".join(make_layer_record(name, width, height, rgba, hidden, opacity, include_alpha) for name, hidden, opacity in names)
    pixels = b"".join(layer_pixels(rgba, width, height, hidden, include_alpha) for _, hidden, _ in names)
    # A positive layer count is the ordinary PSD form. The negative form is a
    # legacy transparency-channel hint and is unnecessary because every layer
    # already carries an explicit alpha channel.
    layer_info = struct.pack(">h", len(names)) + records + pixels
    layer_info += b"\0" * ((4 - len(layer_info) % 4) % 4)
    layer_mask = struct.pack(">I", len(layer_info)) + layer_info + struct.pack(">I", 0)

    header = b"8BPS" + struct.pack(">H", 1) + b"\0" * 6
    header += struct.pack(">HIIHH", 4 if include_alpha else 3, height, width, 8, 3)
    color_mode = struct.pack(">I", 0)
    resources = struct.pack(">I", 0)
    channels = (0, 1, 2, -1) if include_alpha else (0, 1, 2)
    encoded = [rle_channel(channel_bytes(rgba, channel), width, height) for channel in channels]
    composite = struct.pack(">H", 1)
    composite += b"".join(item[: 2 * height] for item in encoded)
    composite += b"".join(item[2 * height :] for item in encoded)
    return header + color_mode + resources + struct.pack(">I", len(layer_mask)) + layer_mask + composite


def main() -> int:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else SOURCE
    output = Path(sys.argv[2]) if len(sys.argv) > 2 else OUTPUT
    width, height, rgba = read_rgba_png(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(build_psd(width, height, rgba, scaffold="--single" not in sys.argv, include_alpha="--no-alpha" not in sys.argv))
    print(f"wrote {output} ({width}x{height})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
