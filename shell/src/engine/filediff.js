// Line diffs, computed from bytes we actually read.
//
// WHY THIS FILE EXISTS AT ALL
//
// Probed against codex 0.145.0: a `file_change` item carries ONLY the path and
// an edit kind. The real payload, verbatim, is
//
//     {"id":"item_1","type":"file_change","status":"in_progress",
//      "changes":[{"path":"/abs/path/scanner.txt","kind":"update"}]}
//
// There is no line content and no unified patch in the stream — not at
// `item.started`, not at `item.completed`. So the only sound way to show line
// detail is to read the file ourselves, on both sides of the write, and diff
// two byte strings we genuinely observed.
//
// That is sound here because of a second probed fact: `item.started` arrives
// BEFORE the write lands and `item.completed` arrives AFTER it. Snapshotting on
// started and re-reading on completed therefore brackets exactly one edit.
//
// The rule this file exists to protect: every rendered line is a line that was
// literally present in one of those two reads. Nothing is reconstructed,
// inferred, or prettified. When the bytes cannot be sourced, `available:false`
// travels with a reason and the UI says so — see codex.js and Diff.js.

/**
 * Files larger than this are not snapshotted.
 *
 * A snapshot is held in memory for the lifetime of one in-flight edit, and the
 * resulting diff is committed to the transcript for the lifetime of the
 * session. 1 MiB is far above any source file Sherman edits in practice and far
 * below the point where holding two copies matters.
 */
export const MAX_SNAPSHOT_BYTES = 1024 * 1024;

/**
 * The most +/- rows any single file change contributes to the transcript.
 *
 * 24 is one screenful of diff on an 80x24 terminal minus the surrounding
 * chrome: enough that an ordinary edit is shown in full, small enough that a
 * thousand-line rewrite cannot flood the viewport or the scrollback. Anything
 * past it is reported as a truthful "+N more lines" count rather than dropped
 * silently — a hidden truncation would read as a smaller change than happened.
 */
export const MAX_DIFF_LINES = 24;

/**
 * Guard on the O(n*m) LCS table.
 *
 * Past this many cells the minimal edit script is abandoned in favour of a
 * coarse one (see diffLines). That fallback is still a TRUE description of the
 * change — every line in it came out of a real read — it is merely not the
 * shortest such description. Degrading to a truthful coarse diff is acceptable;
 * inventing a pretty one is not.
 */
const MAX_LCS_CELLS = 250_000;

/** Split file text into lines, without inventing a trailing empty line. */
export function toLines(text) {
    if (text === '') return [];
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
}

/**
 * A minimal-ish line edit script between two texts.
 *
 * Common leading and trailing lines are trimmed first — that is both a large
 * speedup and the reason most real edits stay inside the LCS budget. Only the
 * differing middle is aligned.
 *
 * @param {string} before
 * @param {string} after
 * @returns {Array<{sign:'+'|'-', text:string}>} changed lines only, in order
 */
export function diffLines(before, after) {
    const a = toLines(before);
    const b = toLines(after);

    let head = 0;
    while (head < a.length && head < b.length && a[head] === b[head]) head += 1;

    let tail = 0;
    while (
        tail < a.length - head &&
        tail < b.length - head &&
        a[a.length - 1 - tail] === b[b.length - 1 - tail]
    ) {
        tail += 1;
    }

    const midA = a.slice(head, a.length - tail);
    const midB = b.slice(head, b.length - tail);

    if (midA.length === 0 && midB.length === 0) return [];

    // Coarse fallback: too big to align cell-by-cell. Every line below is still
    // a real line from a real read; only the pairing is unrefined.
    if (midA.length * midB.length > MAX_LCS_CELLS) {
        return [
            ...midA.map((text) => ({ sign: '-', text })),
            ...midB.map((text) => ({ sign: '+', text })),
        ];
    }

    return lcsScript(midA, midB);
}

/** Classic LCS table walked back into a -/+ script. */
function lcsScript(a, b) {
    const rows = a.length + 1;
    const cols = b.length + 1;
    const table = new Uint32Array(rows * cols);

    for (let i = a.length - 1; i >= 0; i -= 1) {
        for (let j = b.length - 1; j >= 0; j -= 1) {
            table[i * cols + j] =
                a[i] === b[j]
                    ? table[(i + 1) * cols + (j + 1)] + 1
                    : Math.max(table[(i + 1) * cols + j], table[i * cols + (j + 1)]);
        }
    }

    const ops = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            i += 1;
            j += 1;
        } else if (table[(i + 1) * cols + j] >= table[i * cols + (j + 1)]) {
            ops.push({ sign: '-', text: a[i] });
            i += 1;
        } else {
            ops.push({ sign: '+', text: b[j] });
            j += 1;
        }
    }
    while (i < a.length) {
        ops.push({ sign: '-', text: a[i] });
        i += 1;
    }
    while (j < b.length) {
        ops.push({ sign: '+', text: b[j] });
        j += 1;
    }
    return ops;
}

/**
 * Build the renderable summary of one file change.
 *
 * `before`/`after` are the two reads, or null when that side could not be read
 * (a create has no before; a delete has no after; an unreadable or oversized
 * file has neither). A null on BOTH sides is unsourceable, and says so.
 *
 * @param {{path:string, changeKind:string, before:string|null, after:string|null,
 *          reason?:string|null}} input
 */
export function summarizeChange({ path, changeKind, before, after, reason = null }) {
    if (before === null && after === null) {
        return {
            path,
            changeKind,
            available: false,
            reason: reason ?? 'file content could not be read',
            added: 0,
            removed: 0,
            lines: [],
            more: 0,
        };
    }

    const ops = diffLines(before ?? '', after ?? '');
    const added = ops.reduce((n, op) => n + (op.sign === '+' ? 1 : 0), 0);
    const removed = ops.length - added;

    return {
        path,
        changeKind,
        available: true,
        reason: null,
        added,
        removed,
        lines: ops.slice(0, MAX_DIFF_LINES),
        more: Math.max(0, ops.length - MAX_DIFF_LINES),
    };
}
