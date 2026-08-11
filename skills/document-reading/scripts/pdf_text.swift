// pdf_text.swift — extract the text layer of a PDF via macOS PDFKit.
//
//   usage: swift pdf_text.swift <file.pdf> [first-page last-page]
//
// Prints the text with per-page markers. Exit codes: 0 text extracted,
// 1 unreadable/locked, 2 usage, 3 no extractable text (likely a scanned
// image PDF — no OCR here, and pretending otherwise would be worse).

import Foundation
import PDFKit

func fail(_ message: String, code: Int32) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(code)
}

let args = CommandLine.arguments
guard args.count >= 2 else {
    fail("usage: swift pdf_text.swift <file.pdf> [first-page last-page]", code: 2)
}

let url = URL(fileURLWithPath: args[1])
guard let doc = PDFDocument(url: url) else {
    fail("not a readable PDF: \(args[1])", code: 1)
}
if doc.isLocked {
    fail("this PDF is password-protected; it cannot be extracted here", code: 1)
}

let pageCount = doc.pageCount
let first = args.count >= 3 ? max(1, Int(args[2]) ?? 1) : 1
let last = args.count >= 4 ? min(pageCount, Int(args[3]) ?? pageCount) : pageCount
guard first <= last, first <= pageCount else {
    fail("page range \(first)-\(last) is outside 1-\(pageCount)", code: 2)
}

var output = ""
for index in (first - 1)..<last {
    guard let page = doc.page(at: index), let text = page.string else { continue }
    output += "\n--- page \(index + 1) of \(pageCount) ---\n"
    output += text
}

if output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
    fail("no extractable text in pages \(first)-\(last) — likely a scanned image PDF (no OCR is bundled)", code: 3)
}
print(output)
