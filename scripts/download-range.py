"""Resumable parallel range downloader for large Hugging Face files.

This is intentionally dependency-free so it can run with the Python already
installed on Windows. The destination is written atomically after all ranges
are complete.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import os
import pathlib
import sys
import time
import urllib.request


def get_total_size(url: str) -> int:
    request = urllib.request.Request(url, headers={"Range": "bytes=0-0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        content_range = response.headers.get("Content-Range", "")
        if "/" not in content_range:
            raise RuntimeError(f"Server did not return Content-Range for {url}")
        return int(content_range.rsplit("/", 1)[1])


def download_part(url: str, part_path: pathlib.Path, start: int, end: int) -> int:
    expected = end - start + 1
    if part_path.exists() and part_path.stat().st_size == expected:
        return expected
    if part_path.exists():
        part_path.unlink()

    request = urllib.request.Request(
        url,
        headers={"Range": f"bytes={start}-{end}", "Accept-Encoding": "identity"},
    )
    temporary = part_path.with_suffix(part_path.suffix + ".tmp")
    with urllib.request.urlopen(request, timeout=1800) as response, temporary.open("wb") as output:
        received = 0
        while True:
            block = response.read(8 * 1024 * 1024)
            if not block:
                break
            output.write(block)
            received += len(block)
    if received != expected:
        temporary.unlink(missing_ok=True)
        raise RuntimeError(f"Range {start}-{end} returned {received} bytes, expected {expected}")
    temporary.replace(part_path)
    return received


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("destination", type=pathlib.Path)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--chunk-gib", type=float, default=0.5)
    args = parser.parse_args()

    if args.workers < 1:
        parser.error("--workers must be positive")
    total = get_total_size(args.url)
    chunk_size = max(1, int(args.chunk_gib * 1024**3))
    part_dir = args.destination.with_name(args.destination.name + ".parts")
    part_dir.mkdir(parents=True, exist_ok=True)
    ranges = []
    start = 0
    while start < total:
        end = min(total - 1, start + chunk_size - 1)
        index = len(ranges)
        ranges.append((index, start, end))
        start = end + 1

    print(f"Downloading {total / 1024**3:.2f} GiB in {len(ranges)} ranges with {args.workers} workers", flush=True)
    started = time.monotonic()
    done = sum(
        end - start + 1
        for index, start, end in ranges
        if (part_dir / f"part-{index:05d}").exists()
        and (part_dir / f"part-{index:05d}").stat().st_size == end - start + 1
    )

    def task(item: tuple[int, int, int]) -> int:
        index, start, end = item
        return download_part(args.url, part_dir / f"part-{index:05d}", start, end)

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = [executor.submit(task, item) for item in ranges]
        for future in concurrent.futures.as_completed(futures):
            done += future.result()
            elapsed = max(time.monotonic() - started, 0.1)
            speed = done / elapsed / 1024**2
            print(f"{done / total:6.1%}  {speed:6.1f} MiB/s", flush=True)

    args.destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.destination.with_suffix(args.destination.suffix + ".tmp")
    with temporary.open("wb") as output:
        for index, _, _ in ranges:
            part_path = part_dir / f"part-{index:05d}"
            with part_path.open("rb") as part:
                while block := part.read(16 * 1024 * 1024):
                    output.write(block)
    if temporary.stat().st_size != total:
        raise RuntimeError("Merged file size does not match server size")
    temporary.replace(args.destination)
    for part in part_dir.glob("part-*"):
        part.unlink()
    part_dir.rmdir()
    print(f"Saved {args.destination} ({total / 1024**3:.2f} GiB)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
