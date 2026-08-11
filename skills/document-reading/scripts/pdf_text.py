#!/usr/bin/env python3
"""Extract the text layer of a PDF via pypdf, anywhere Python runs.

    usage: python3 pdf_text.py <file.pdf> [first-page last-page]

Prints the text with per-page markers. Exit codes: 0 text extracted,
1 unreadable/locked, 2 usage, 3 no extractable text (likely a scanned image
PDF -- no OCR here), 4 pypdf not installed (the fix is printed).

Local-only by design: one file in, stdout out, no network, no writes.
"""
from __future__ import annotations

import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: python3 pdf_text.py <file.pdf> [first-page last-page]", file=sys.stderr)
        return 2

    try:
        from pypdf import PdfReader
    except ImportError:
        try:
            from PyPDF2 import PdfReader  # the older name, if that is what exists
        except ImportError:
            print(
                "pypdf is not installed. Install it with: python3 -m pip install pypdf",
                file=sys.stderr,
            )
            return 4

    path = sys.argv[1]
    try:
        reader = PdfReader(path)
    except Exception as error:  # noqa: BLE001 - the message is the diagnosis
        print(f"not a readable PDF: {path} ({error})", file=sys.stderr)
        return 1

    if getattr(reader, "is_encrypted", False):
        try:
            if reader.decrypt("") == 0:
                raise ValueError("password required")
        except Exception:  # noqa: BLE001
            print("this PDF is password-protected; it cannot be extracted here", file=sys.stderr)
            return 1

    page_count = len(reader.pages)
    first = max(1, int(sys.argv[2])) if len(sys.argv) >= 3 else 1
    last = min(page_count, int(sys.argv[3])) if len(sys.argv) >= 4 else page_count
    if first > last or first > page_count:
        print(f"page range {first}-{last} is outside 1-{page_count}", file=sys.stderr)
        return 2

    chunks = []
    for index in range(first - 1, last):
        text = reader.pages[index].extract_text() or ""
        if text.strip():
            chunks.append(f"\n--- page {index + 1} of {page_count} ---\n{text}")

    if not chunks:
        print(
            f"no extractable text in pages {first}-{last} -- likely a scanned image PDF (no OCR is bundled)",
            file=sys.stderr,
        )
        return 3

    sys.stdout.write("".join(chunks))
    return 0


if __name__ == "__main__":
    sys.exit(main())
