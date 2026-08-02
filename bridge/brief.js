// One-shot morning brief — the schedulable half of the phone channel.
//
// `sherman brief` runs ONE headless engine turn that builds the morning brief
// (the morning-brief skill owns its shape), prints it to stdout, and — when
// this machine has a bot token AND a paired chat — delivers it to Telegram.
//
// This file exists because the bridge cannot do this job: bridge/telegram.js
// answers incoming messages and nothing else, so "schedule my brief" had no
// path to a phone at all. The split is deliberate and stays: the bridge is a
// long-running conversation, this is a single turn that exits — which is
// exactly the shape a scheduler (Windows Task Scheduler, cron) can run.
//
// Delivery is honest about its halves. The brief PRINTS regardless; Telegram
// delivery happens only when both the token and the paired chat exist, and a
// missing half is a sentence naming the one command that fixes it — never a
// silent skip, which reads as "the brief never ran" from a phone.
//
// Same contract as the bridge: launched by `sherman brief`, which assembles
// the adapter and sets the working directory exactly as it does for the
// shell, so the turn runs under the same persona and the same no-PHI rule.

import { loadConfig } from '../shell/src/config.js';
import { selectBackend } from '../shell/src/engine/index.js';

const config = loadConfig();
const token = process.env.TELEGRAM_BOT_TOKEN || config.telegramToken || '';
const chat = String(process.env.SHERMAN_TELEGRAM_CHAT || config.telegramChat || '');

const REQUEST = [
    'MORNING BRIEF TURN',
    'Build the morning brief by following the morning-brief skill exactly:',
    'the user\'s own configuration if one exists in their private scope, the',
    'default sections otherwise. Evidence only; thin mornings said plainly.',
    '',
    'Reply with the BRIEF ITSELF and nothing else — no preamble, no "here is',
    'your brief", no closing questions. It may be delivered to a phone, so',
    'keep it plain text: no markdown tables, no code fences.',
    'Never include patient-identifying data. The Sherman operating contract',
    'and no-PHI rule remain authoritative.',
].join('\n');

async function tg(method, params) {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params ?? {}),
    });
    const body = await res.json();
    if (!body.ok) throw new Error(`${method}: ${body.description ?? res.status}`);
    return body.result;
}

/** Telegram caps messages at 4096 chars; same split the bridge uses. */
async function deliver(text) {
    const full = text.trim() || '(the brief came back empty)';
    for (let i = 0; i < full.length; i += 4000) {
        await tg('sendMessage', { chat_id: chat, text: full.slice(i, i + 4000) });
    }
}

async function main() {
    const session = selectBackend(config);
    const parts = [];
    try {
        for await (const event of session.send(REQUEST)) {
            if (event.kind === 'message') parts.push(event.text);
            if (event.kind === 'error') {
                console.error(`engine error: ${event.message}`);
                process.exit(1);
            }
        }
    } finally {
        session.dispose?.();
    }

    const brief = parts.join('\n\n').trim();
    if (!brief) {
        console.error('The engine returned no brief. Nothing was delivered.');
        process.exit(1);
    }

    // The terminal copy always exists, whatever happens to delivery.
    console.log(brief);

    // Delivery, with each missing half named next to its one repair command.
    // The config path is printed because "I gave it the token" and "this
    // process read a config that has one" are different machines' truths more
    // often than anyone expects — a scheduler may run under another profile.
    if (!token) {
        console.error('');
        console.error(`Not sent to Telegram: no bot token in ${config.configPath}.`);
        console.error('Save one with:  sherman telegram --token <token from @BotFather>');
        process.exit(2);
    }
    if (!chat) {
        console.error('');
        console.error(`Not sent to Telegram: no paired chat in ${config.configPath}.`);
        console.error('Pair once: run `sherman telegram`, then text it the pairing code it shows.');
        process.exit(2);
    }
    try {
        await deliver(brief);
        console.error('');
        console.error(`Delivered to Telegram chat ${chat} (verified: sendMessage accepted).`);
    } catch (err) {
        console.error('');
        console.error(`Telegram delivery failed: ${err.message}`);
        console.error(`Token and chat came from ${config.configPath}.`);
        process.exit(2);
    }
}

main().catch((err) => {
    console.error(`brief failed: ${err.message}`);
    process.exit(1);
});
