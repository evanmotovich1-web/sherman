// Scroll window arithmetic for the transcript.
//
// Hermes solves this with a ScrollBox in its own ink fork (`@hermes/ink`):
// `app/scroll.ts` calls `getScrollTop`/`getScrollHeight`/`scrollBy` on a handle
// stock ink does not have. So there is nothing to port here — only the shape of
// the problem, which is the same one: a buffer taller than its viewport, an
// offset from the bottom, and a clamp that must never let the offset outrun the
// buffer.
//
// The offset is measured in LINES FROM THE BOTTOM, not from the top. That is
// what makes "still following" a single comparison against zero and what keeps
// the position stable while new lines append underneath: at offset 0 the view
// follows the tail; at offset N the viewer is looking N lines above it, and N
// is exactly the number of lines below the window. The indicator prints that
// number directly — it is the state, not a figure derived for display.
//
// Everything here is pure and takes its dimensions as arguments, so the window
// math is testable without a terminal, a pty, or a render.

/**
 * Largest offset that still leaves something on screen.
 *
 * A buffer no taller than its viewport cannot scroll at all, so the maximum is
 * zero and the view is pinned to the tail. Otherwise the oldest line may reach
 * the top of the viewport and no further — scrolling into blank space above the
 * transcript would be motion without information.
 */
export function maxOffset(total, viewport) {
    if (!Number.isFinite(total) || !Number.isFinite(viewport)) return 0;
    return Math.max(0, Math.floor(total) - Math.max(0, Math.floor(viewport)));
}

/** Clamp an offset into `[0, maxOffset]`. */
export function clampOffset(offset, total, viewport) {
    const max = maxOffset(total, viewport);
    if (!Number.isFinite(offset)) return 0;
    return Math.max(0, Math.min(max, Math.floor(offset)));
}

/**
 * Move the window by `delta` lines, positive being up/back into history.
 *
 * Returns the clamped offset, so a caller may always store the result: pressing
 * PgUp at the top of the buffer yields the same offset it already had, which is
 * how "nothing happened" is expressed without a special case.
 */
export function scrollBy(offset, delta, total, viewport) {
    return clampOffset(offset + delta, total, viewport);
}

/**
 * The slice of the buffer to render, and the true count below it.
 *
 * `end` is exclusive. `below` is the number of buffer lines that exist beneath
 * the last visible one — the number the history indicator prints. `following`
 * is whether the window is pinned to the live tail.
 *
 * Before the first layout pass the viewport measures 0 (ink's `useBoxMetrics`
 * reports zeros until it has measured). That is reported honestly rather than
 * guessed at: the window is the whole buffer and `below` is 0, because with no
 * measured viewport there is no fact about what is off screen.
 */
export function scrollWindow({ total, viewport, offset }) {
    const size = Math.max(0, Math.floor(total) || 0);
    const height = Math.max(0, Math.floor(viewport) || 0);
    const at = clampOffset(offset, size, height);

    if (height === 0) {
        return { start: 0, end: size, below: 0, following: at === 0, offset: at };
    }

    const end = Math.max(0, size - at);
    const start = Math.max(0, end - height);
    return { start, end, below: size - end, following: at === 0, offset: at };
}

/**
 * The history indicator's text, or null while following the tail.
 *
 * The count is `below` straight from `scrollWindow` — lines that exist in the
 * buffer and are not on screen. It is never rounded, bucketed, or replaced by a
 * word like "more", because a number on this shell's chrome is a claim about
 * what is actually there.
 */
export function historyLabel(window) {
    if (!window || window.following || window.below <= 0) return null;
    const lines = window.below === 1 ? 'line' : 'lines';
    return `viewing history — ${window.below} ${lines} below · PgDn to follow`;
}
