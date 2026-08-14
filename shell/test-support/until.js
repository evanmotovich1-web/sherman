// Wait for a rendered state — not for a deadline.
//
// Every ink test in this suite asserts that the shell EVENTUALLY renders
// something. The deadline exists only so a predicate that will never be
// satisfied fails with a message instead of hanging the suite forever. It is
// not an assertion about latency, and none of these tests measure speed.
//
// One copy, because there were four — three at 2000ms and one at 3000ms.
// Already drifted, which is what a duplicated number does: it gets tuned where
// it hurts and nowhere else, and the next person cannot tell which value was a
// decision and which was a copy.
//
// On the number itself: the two tests that failed the first time CI ran did
// NOT fail for want of time. They failed because Ink turns off interactive
// rendering when it sees CI in the environment, so the frames they poll for
// were never written at all — fixed where that decision is made, by passing
// `interactive: true` at those render sites. A longer deadline would have
// bought nothing there.
//
// It is still worth being generous on a shared runner. The mouse test takes
// ~1.2s on the machine this suite was written on, leaving under a second of
// headroom against 2000ms, and a contended runner can spend that without
// anything being wrong. A test that fails on a slow machine while the behavior
// is correct is a false alarm, and false alarms are how a red CI stops being
// read. A genuine hang still fails — just later, on the runner where nobody is
// watching a clock anyway.

/** Generous on a shared runner, and roomy enough on a developer machine that
 *  a parallel engine session churning the same cores cannot fail a correct
 *  render — proven live 2026-08-13, when the full suite red-lined one TTY
 *  test three runs straight beside a working codex session and passed the
 *  moment it ran alone. The deadline is a hang backstop, not a latency bar. */
export const RENDER_DEADLINE_MS = process.env.CI ? 30_000 : 15_000;

/**
 * Poll `predicate` until it is true, or throw once the deadline passes.
 *
 * @param {() => boolean} predicate
 * @param {number} [deadline] override in ms; callers should not need one
 */
export const until = async (predicate, deadline = RENDER_DEADLINE_MS) => {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started >= deadline) {
            throw new Error('timed out waiting for rendered state');
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
};
