// Treat every engine/config/path string as hostile terminal output. Ink styles
// its own spans; raw OSC/CSI/C0 bytes must never reach the terminal renderer.
export function safeTerminalText(value, { preserveNewlines = false } = {}) {
    const clean = String(value ?? '')
        .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    return preserveNewlines
        ? clean.replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '')
        : clean
              .replace(/\r\n?|\n/g, ' ')
              .replace(/[\x00-\x1f\x7f-\x9f]/g, '');
}
