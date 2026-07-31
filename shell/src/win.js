// /win: everything Sherman has recorded about how the operator works, judged
// in one pass and delivered as a local page.
//
// The evidence is what actually exists on this machine: every session log
// under ~/.sherman/sessions/, every persisted eval verdict under
// ~/.sherman/evals/, and — because other tools' history only exists here if
// the operator exports it — whatever they drop into ~/.sherman/win-sources/
// (a ChatGPT data export, notes, anything readable). Nothing is guessed and
// nothing leaves the machine: the judge is a read-only worker, the report is
// a file:// page under ~/.sherman/win/, and the browser opening it is the
// same host-side opener /email uses.

import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * The evidence actually present on this machine, as absolute paths.
 * Missing directories contribute empty lists, never a throw: a first-week
 * install simply has less to judge.
 */
export function collectWinSources({ home = homedir() } = {}) {
    const list = (dir, keep) => {
        try {
            return readdirSync(dir)
                .filter(keep)
                .sort()
                .map((name) => join(dir, name));
        } catch {
            return [];
        }
    };
    const base = join(home, '.sherman');
    return {
        sessions: list(join(base, 'sessions'), (n) => n.endsWith('.jsonl')),
        evals: list(join(base, 'evals'), (n) => n.endsWith('.md')),
        extras: list(join(base, 'win-sources'), (n) => !n.startsWith('.')),
    };
}

/**
 * The judging turn. Isolated and read-only like /subagent: judging a body of
 * work is not a reason to hold write access to anything, and the main thread
 * must not spend its context on a sweep this wide. The worker reads the files
 * itself — the request carries paths, not contents, because the corpus can be
 * far larger than a request should be.
 */
export function winRequest(sources, goal) {
    const listing = (label, paths) =>
        paths.length
            ? `${label} (${paths.length}):\n${paths.map((p) => `  ${p}`).join('\n')}`
            : `${label}: none found`;
    return {
        text: [
            'OPERATOR REVIEW TURN (/win)',
            'Read the evidence below and judge how the operator and Sherman are working together across every recorded session — not one session, the pattern.',
            '',
            listing('Session logs, one JSONL object {role, at, text} per line', sources.sessions),
            listing('Persisted eval verdicts', sources.evals),
            listing('Operator-provided exports from other tools', sources.extras),
            '',
            'Judge only from these files and the vault. Cite session ids or filenames for every claim — an uncited pattern is an opinion.',
            'Return Markdown with exactly these three sections:',
            '# What is going right',
            '# What is going wrong',
            '# What to change next',
            'Under each, short evidence-cited points: vault use, skills reached for unprompted or missed, work delegated to workers or ground through the main thread, durable knowledge written or lost, honest limits versus confident gaps. In "What to change next", give at most five concrete changes ranked by value; fewer is fine, and a clean record should read as clean.',
            goal ? `Standing session goal: ${goal}` : null,
            'Never quote patient-identifying data, even to report the boundary was tested — describe the shape and say the specifics were withheld. The Sherman operating contract and no-PHI rule remain authoritative.',
        ].filter(Boolean).join('\n'),
        mode: 'isolated-read-only',
        source: 'win',
    };
}

/** Minimal escape so evidence text cannot become markup. */
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Inline markdown the judge is told to use: bold, code, emphasis. */
function inline(text) {
    return escapeHtml(text)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/**
 * The judge's Markdown as HTML — headings, lists, paragraphs, rules. A tiny
 * hand renderer instead of a dependency: the input shape is dictated by
 * winRequest, and a full Markdown engine for three sections and some lists
 * would be the heaviest module in the shell.
 */
export function renderMarkdown(markdown) {
    const out = [];
    let list = null;
    const closeList = () => {
        if (list) {
            out.push(list === 'ul' ? '</ul>' : '</ol>');
            list = null;
        }
    };
    for (const raw of String(markdown).split('\n')) {
        const line = raw.trimEnd();
        const heading = line.match(/^(#{1,4})\s+(.*)$/);
        const bullet = line.match(/^[-*]\s+(.*)$/);
        const numbered = line.match(/^\d+[.)]\s+(.*)$/);
        if (heading) {
            closeList();
            const level = heading[1].length;
            out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        } else if (bullet || numbered) {
            const want = bullet ? 'ul' : 'ol';
            if (list !== want) {
                closeList();
                out.push(want === 'ul' ? '<ul>' : '<ol>');
                list = want;
            }
            out.push(`<li>${inline((bullet ?? numbered)[1])}</li>`);
        } else if (/^(-{3,}|\*{3,})$/.test(line)) {
            closeList();
            out.push('<hr>');
        } else if (line.trim() === '') {
            closeList();
        } else {
            closeList();
            out.push(`<p>${inline(line)}</p>`);
        }
    }
    closeList();
    return out.join('\n');
}

/** The page around the verdict: Sherman's inks, counts of what was judged. */
export function renderWinHtml(markdown, { sessions = 0, evals = 0, extras = 0, generatedAt = new Date() } = {}) {
    const counts = [
        `${sessions} session log${sessions === 1 ? '' : 's'}`,
        `${evals} eval verdict${evals === 1 ? '' : 's'}`,
        extras ? `${extras} operator export${extras === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' · ');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sherman · /win</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #12101a; color: #d8d4e8; font: 16px/1.6 -apple-system, "Segoe UI", system-ui, sans-serif; }
  main { max-width: 46rem; margin: 0 auto; padding: 3rem 1.5rem 5rem; }
  header { border-bottom: 1px solid #2c2740; padding-bottom: 1rem; margin-bottom: 2rem; }
  header h1 { margin: 0; font-size: 1.6rem; color: #ff5fa2; letter-spacing: .04em; }
  header p { margin: .4rem 0 0; color: #8a83a8; }
  h1 { color: #ff5fa2; font-size: 1.25rem; margin-top: 2.2rem; }
  h2, h3 { color: #a06bff; }
  strong { color: #f0edfa; }
  code { background: #201b30; border-radius: 4px; padding: .1em .35em; color: #6cb8ff; font-size: .9em; }
  li { margin: .35rem 0; }
  hr { border: 0; border-top: 1px solid #2c2740; margin: 2rem 0; }
  footer { margin-top: 3rem; color: #8a83a8; font-size: .85rem; border-top: 1px solid #2c2740; padding-top: 1rem; }
</style>
</head>
<body>
<main>
<header>
<h1>SHERMAN · /win</h1>
<p>How you and Sherman are working — judged from ${escapeHtml(counts)} on this machine. Nothing left it.</p>
</header>
${renderMarkdown(markdown)}
<footer>Generated ${escapeHtml(generatedAt.toISOString())} · a local file under ~/.sherman/win/ · evidence-cited, PHI withheld by contract</footer>
</main>
</body>
</html>
`;
}

/**
 * Write the page and hand back where it landed, or null when even that write
 * failed — a caller must never announce a page that is not on disk.
 */
export function writeWinSite(html, { home = homedir(), now = new Date() } = {}) {
    try {
        const dir = join(home, '.sherman', 'win');
        mkdirSync(dir, { recursive: true });
        const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '_');
        const file = join(dir, `win-${stamp}.html`);
        writeFileSync(file, html);
        return file;
    } catch {
        return null;
    }
}
