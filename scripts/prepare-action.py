"""Prepare a light-background character action as a transparent WebM asset."""

import argparse
import collections
import json
import math
import subprocess
from pathlib import Path


def ffmpeg(*args):
    return ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", *map(str, args)]


def decode_frames(source, width, height, fps):
    command = ffmpeg(
        "-i", source, "-vf", f"fps={fps},scale={width}:{height}:flags=lanczos",
        "-an", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
    )
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    frame_size = width * height * 3
    try:
        while True:
            frame = process.stdout.read(frame_size)
            if not frame:
                break
            if len(frame) != frame_size:
                raise RuntimeError("Incomplete RGB frame.")
            yield frame
    finally:
        process.stdout.close()
    error = process.stderr.read().decode(errors="replace")
    if process.wait() != 0:
        raise RuntimeError(error)


def background_color(frame, width, height):
    points = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]
    samples = []
    for x, y in points:
        offset = (y * width + x) * 3
        samples.append(frame[offset:offset + 3])
    return tuple(sum(sample[channel] for sample in samples) // len(samples) for channel in range(3))


def largest_foreground_component(frame, width, height, key, threshold):
    background_like = bytearray(width * height)
    for index in range(width * height):
        offset = index * 3
        distance = math.sqrt(sum((frame[offset + channel] - key[channel]) ** 2 for channel in range(3)))
        background_like[index] = 1 if distance < threshold else 0

    outside = bytearray(width * height)
    queue = collections.deque()
    for x in range(width):
        queue.append(x)
        queue.append((height - 1) * width + x)
    for y in range(height):
        queue.append(y * width)
        queue.append(y * width + width - 1)
    while queue:
        index = queue.popleft()
        if index < 0 or index >= width * height or outside[index] or not background_like[index]:
            continue
        outside[index] = 1
        x, y = index % width, index // width
        if x:
            queue.append(index - 1)
        if x + 1 < width:
            queue.append(index + 1)
        if y:
            queue.append(index - width)
        if y + 1 < height:
            queue.append(index + width)

    foreground = bytearray(width * height)
    for index in range(width * height):
        if not outside[index]:
            foreground[index] = 1

    visited = bytearray(width * height)
    best = []
    for start, value in enumerate(foreground):
        if not value or visited[start]:
            continue
        component = []
        queue = collections.deque([start])
        visited[start] = 1
        while queue:
            index = queue.popleft()
            component.append(index)
            x, y = index % width, index // width
            neighbors = []
            if x:
                neighbors.append(index - 1)
            if x + 1 < width:
                neighbors.append(index + 1)
            if y:
                neighbors.append(index - width)
            if y + 1 < height:
                neighbors.append(index + width)
            for neighbor in neighbors:
                if foreground[neighbor] and not visited[neighbor]:
                    visited[neighbor] = 1
                    queue.append(neighbor)
        if len(component) > len(best):
            best = component

    if not best:
        raise RuntimeError("No character foreground was detected.")
    mask = bytearray(width * height)
    for index in best:
        mask[index] = 1
    return mask


def remove_floor_shadow(mask, width, height):
    # The generated clip includes a gray oval beneath the feet. It is wider
    # than the feet and only appears in the bottom few rows, so remove those
    # rows without touching the character's legs.
    start_y = int(height * 0.92)
    for y in range(start_y, height):
        if y >= int(height * 0.955):
            for x in range(width):
                mask[y * width + x] = 0
            continue
        xs = [x for x in range(width) if mask[y * width + x]]
        if xs and xs[-1] - xs[0] > width * 0.075:
            for x in xs:
                mask[y * width + x] = 0
    return mask


def edge_alpha(frame, mask, width, height, key):
    """Fade only boundary pixels that still contain pale background spill."""
    alpha = bytearray(width * height)
    for index, value in enumerate(mask):
        if not value:
            continue
        x, y = index % width, index // width
        boundary = False
        for yy in range(max(0, y - 2), min(height, y + 3)):
            for xx in range(max(0, x - 2), min(width, x + 3)):
                if not mask[yy * width + xx]:
                    boundary = True
                    break
            if boundary:
                break
        if not boundary:
            alpha[index] = 255
            continue
        offset = index * 3
        distance = math.sqrt(sum((frame[offset + channel] - key[channel]) ** 2 for channel in range(3)))
        red, green, blue = frame[offset:offset + 3]
        if max(red, green, blue) - min(red, green, blue) < 16 and min(red, green, blue) > 170:
            alpha[index] = 0
            continue
        # Use a wider fade range so pale background spill becomes transparent
        # instead of remaining as a bright outline around the hair and sleeves.
        alpha[index] = max(0, min(255, int((distance - 8) * 255 / 120)))
    return alpha


def alpha_union(command, width, height):
    union = bytearray(width * height)
    frame_size = width * height * 4
    frames = 0
    with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as process:
        while True:
            frame = process.stdout.read(frame_size)
            if not frame:
                break
            if len(frame) != frame_size:
                raise RuntimeError("Incomplete RGBA frame.")
            frames += 1
            for index, alpha in enumerate(frame[3::4]):
                if alpha >= 8:
                    union[index] = 1
        error = process.stderr.read().decode(errors="replace")
        if process.wait() != 0:
            raise RuntimeError(error)
    if not frames or not any(union):
        raise RuntimeError("No visible character frames were decoded.")
    return union, frames


def shape_rectangles(mask, width, height, padding):
    expanded = bytearray(width * height)
    for index, value in enumerate(mask):
        if not value:
            continue
        x, y = index % width, index // width
        for yy in range(max(0, y - 1), min(height, y + 2)):
            for xx in range(max(0, x - 1), min(width, x + 2)):
                expanded[yy * width + xx] = 1

    rectangles = []
    active = {}
    for y in range(height):
        runs = []
        x = 0
        while x < width:
            if not expanded[y * width + x]:
                x += 1
                continue
            start = x
            while x < width and expanded[y * width + x]:
                x += 1
            runs.append((start, x - start))
        next_active = {}
        for run in runs:
            rectangle = active.pop(run, {"x": run[0] + padding, "y": y + padding, "width": run[1], "height": 0})
            rectangle["height"] += 1
            next_active[run] = rectangle
        rectangles.extend(active.values())
        active = next_active
    rectangles.extend(active.values())
    return rectangles


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--height", type=int, default=225)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--threshold", type=int, default=35, help="Background distance threshold (default: 35).")
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    if args.height < 64 or not 1 <= args.fps <= 120:
        parser.error("Height must be at least 64 and FPS must be between 1 and 120.")

    output = args.output_dir
    output.mkdir(parents=True, exist_ok=True)
    analysis_width, analysis_height = 640, 360
    first = next(decode_frames(args.input, analysis_width, analysis_height, args.fps), None)
    if first is None:
        raise RuntimeError("No animation frames were decoded.")
    key = background_color(first, analysis_width, analysis_height)

    masks = []
    left, top, right, bottom = analysis_width, analysis_height, 0, 0
    for frame in decode_frames(args.input, analysis_width, analysis_height, args.fps):
        mask = largest_foreground_component(frame, analysis_width, analysis_height, key, args.threshold)
        mask = remove_floor_shadow(mask, analysis_width, analysis_height)
        masks.append(mask)
        visible = [index for index, value in enumerate(mask) if value]
        if visible:
            left = min(left, min(index % analysis_width for index in visible))
            top = min(top, min(index // analysis_width for index in visible))
            right = max(right, max(index % analysis_width for index in visible) + 1)
            bottom = max(bottom, max(index // analysis_width for index in visible) + 1)
    if not masks or right <= left or bottom <= top:
        raise RuntimeError("No character mask was found.")

    crop_x = max(0, left - 3)
    crop_y = max(0, top - 3)
    crop_right = min(analysis_width, right + 3)
    crop_bottom = min(analysis_height, bottom + 3)
    crop_width, crop_height = crop_right - crop_x, crop_bottom - crop_y
    display_height = args.height
    display_width = round(crop_width / crop_height * display_height)
    video_width, video_height = display_width * 2, display_height * 2
    clip = output / "action.webm"

    encoder = subprocess.Popen(
        ffmpeg(
            "-y", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", f"{analysis_width}x{analysis_height}",
            "-framerate", str(args.fps), "-i", "pipe:0", "-vf",
            f"crop={crop_width}:{crop_height}:{crop_x}:{crop_y},scale={video_width}:{video_height}:flags=lanczos,format=rgba",
            "-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "28",
            "-cpu-used", "5", "-row-mt", "1", "-auto-alt-ref", "0", "-metadata:s:v:0", "alpha_mode=1", clip,
        ), stdin=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    frame_count = 0
    try:
        for frame, mask in zip(decode_frames(args.input, analysis_width, analysis_height, args.fps), masks):
            alpha = edge_alpha(frame, mask, analysis_width, analysis_height, key)
            rgba = bytearray(analysis_width * analysis_height * 4)
            for index in range(analysis_width * analysis_height):
                source = index * 3
                target = index * 4
                if mask[index]:
                    pixel_alpha = alpha[index]
                    if 0 < pixel_alpha < 255:
                        if pixel_alpha < 64:
                            pixel_alpha = 0
                        else:
                            blend = pixel_alpha / 255.0
                            for channel in range(3):
                                recovered = (frame[source + channel] - (1.0 - blend) * key[channel]) / blend
                                rgba[target + channel] = max(0, min(255, int(recovered)))
                    if pixel_alpha == 255:
                        rgba[target:target + 3] = frame[source:source + 3]
                    rgba[target + 3] = pixel_alpha
                else:
                    rgba[target:target + 4] = b"\x00\x00\x00\x00"
            encoder.stdin.write(rgba)
            frame_count += 1
    finally:
        encoder.stdin.close()
    error = encoder.stderr.read().decode(errors="replace")
    if encoder.wait() != 0:
        raise RuntimeError(error)

    subprocess.run(ffmpeg("-y", "-c:v", "libvpx-vp9", "-i", clip, "-frames:v", "1", output / "action-poster.png"), check=True)
    mask, decoded_frames = alpha_union(
        ffmpeg("-c:v", "libvpx-vp9", "-i", clip, "-vf", f"scale={display_width}:{display_height}", "-an", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"),
        display_width,
        display_height,
    )
    padding = 2
    layout = {
        "displayWidth": display_width,
        "displayHeight": display_height,
        "padding": padding,
        "windowWidth": display_width + padding * 2,
        "windowHeight": display_height + padding * 2,
        "frames": decoded_frames,
        "shape": shape_rectangles(mask, display_width, display_height, padding),
    }
    (output / "action-layout.json").write_text(json.dumps(layout, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"display": [display_width, display_height], "frames": frame_count, "clipBytes": clip.stat().st_size}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
