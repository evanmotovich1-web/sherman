// Telegram bridge — Sherman over a Telegram bot, driving the same engine
// sessions the Sherman Shell drives. Launched by `sherman telegram`, which
// assembles the adapter and sets the working directory exactly as it does for
// the shell, so every turn here runs under the same persona and the same
// no-PHI contract.
//
// Zero dependencies: the Bot API is plain HTTPS long-polling (getUpdates) and
// Node 22's global fetch covers it. One engine session per chat id, so a
// Telegram conversation keeps its thread the way a shell session does.
//
// Access is DEFAULT-DENY. The bridge answers exactly one chat: the id in the
// config's `telegram_chat`. Any other sender is told how pairing works and
// nothing of theirs reaches the engine. A bot token is a capability to talk
// to your bot; the allowlist is what keeps that from meaning "anyone who
// finds the bot talks to Sherman".
//
// Stated plainly: this file has been run against the live Telegram API only
// where its runner says so — the first real run is the first test, the same
// honest footing install.ps1 started on.

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../shell/src/config.js';
import { selectBackend } from '../shell/src/engine/index.js';

const config = loadConfig();

const token = process.env.TELEGRAM_BOT_TOKEN || config.telegramToken || '';
let allowedChat = String(process.env.SHERMAN_TELEGRAM_CHAT || config.telegramChat || '');

// Pairing happens by proving you can see this terminal: the bridge shows a
// code here, the person texts it to the bot, and the first chat that sends
// it becomes the ONE chat the bridge answers -- written to the config so it
// survives restarts. No command to run, no id to copy.
const pairingCode = allowedChat ? '' : randomBytes(3).toString('hex').toUpperCase();

function persistPairedChat(chatId) {
    const parsed = JSON.parse(readFileSync(config.configPath, 'utf8'));
    parsed.telegram_chat = String(chatId);
    writeFileSync(config.configPath, JSON.stringify(parsed) + '\n');
    // Verified by reading back, same as every claim in this repo.
    const check = JSON.parse(readFileSync(config.configPath, 'utf8'));
    if (String(check.telegram_chat) !== String(chatId)) {
        throw new Error('pairing did not persist to the config');
    }
    allowedChat = String(chatId);
}

if (!token) {
    // The config PATH is named because "I already gave it the token" is the
    // most common state this error is read in: the token exists — in another
    // profile's config, on the other side of a WSL/Windows boundary, or in a
    // scheduler running as a different user. Naming where THIS process looked
    // turns that from a mystery into a diff.
    console.error(`No Telegram bot token in ${config.configPath}.`);
    console.error('');
    console.error('  1. In Telegram, message @BotFather: /newbot — it hands you a token.');
    console.error('  2. Save it:  sherman telegram --token <token>');
    console.error('  3. Run:      sherman telegram');
    console.error('');
    console.error('If you already saved a token, it is not in the file above — save it');
    console.error('again from this same terminal, then rerun.');
    process.exit(1);
}

const API = `https://api.telegram.org/bot${token}`;

async function tg(method, params) {
    const res = await fetch(`${API}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params ?? {}),
    });
    const body = await res.json();
    if (!body.ok) throw new Error(`${method}: ${body.description ?? res.status}`);
    return body.result;
}

// Telegram caps messages at 4096 chars; split on line boundaries where we can.
async function reply(chatId, text) {
    const full = text.trim() || '(no reply)';
    for (let i = 0; i < full.length; i += 4000) {
        await tg('sendMessage', { chat_id: chatId, text: full.slice(i, i + 4000) });
    }
}

const PAIRING =
    'This Sherman answers only its owner. To pair this chat, send the ' +
    'pairing code shown in the terminal where sherman telegram is running.';

const HELLO =
    'Sherman Abrams — company agent for Sherman Abrams Labs.\n\n' +
    'Ask about the company; I will say when something is outside what I ' +
    'know.\n\nNo patient-identifying information here, ever. This channel ' +
    'is not for PHI, and I will not accept it.';

/** One engine session per chat id — conversations keep their thread. */
const sessions = new Map();
function sessionFor(chatId) {
    let s = sessions.get(chatId);
    if (!s) {
        s = selectBackend(config);
        sessions.set(chatId, s);
    }
    return s;
}

async function handle(message) {
    const chatId = message.chat?.id;
    const text = (message.text ?? '').trim();
    if (!chatId || !text) return;

    if (!allowedChat && pairingCode && text.toUpperCase() === pairingCode) {
        persistPairedChat(chatId);
        console.log(`chat ${chatId} paired (verified: read back from config)`);
        await reply(chatId, 'Paired. This phone now reaches Sherman.\n\n' + HELLO);
        return;
    }

    if (!allowedChat || String(chatId) !== allowedChat) {
        console.log(`unpaired chat ${chatId} knocked; told it how pairing works`);
        await reply(chatId, PAIRING);
        return;
    }

    if (text === '/start') {
        await reply(chatId, HELLO);
        return;
    }

    console.log(`chat ${chatId} > ${text.slice(0, 80)}`);
    const session = sessionFor(chatId);
    const parts = [];
    try {
        for await (const event of session.send(text)) {
            if (event.kind === 'message') parts.push(event.text);
            if (event.kind === 'error') parts.push(`(engine error: ${event.message})`);
        }
    } catch (err) {
        parts.push(`(bridge error: ${err.message})`);
    }
    await reply(chatId, parts.join('\n\n'));
    console.log(`chat ${chatId} < ${parts.join(' ').slice(0, 80)}`);
}

async function main() {
    // getMe is the token check: fail loud now, not on the first message.
    const me = await tg('getMe');
    console.log(`bridge up: @${me.username} · engine ${config.engine}`);
    if (!allowedChat) {
        console.log('');
        console.log(`  To pair your phone: open https://t.me/${me.username} in Telegram`);
        console.log(`  and send it this pairing code:  ${pairingCode}`);
        console.log('');
        console.log('  The first chat that sends the code becomes the one chat this');
        console.log('  bridge answers. Everyone else is turned away.');
    } else {
        console.log(`answering chat ${allowedChat} only`);
    }

    let offset = 0;
    for (;;) {
        let updates;
        try {
            updates = await tg('getUpdates', { timeout: 50, offset });
        } catch (err) {
            console.error(`poll failed (${err.message}); retrying in 5s`);
            await new Promise((r) => setTimeout(r, 5000));
            continue;
        }
        for (const u of updates) {
            offset = u.update_id + 1;
            if (u.message) {
                // Sequential on purpose: one engine, honest ordering.
                await handle(u.message);
            }
        }
    }
}

main().catch((err) => {
    console.error(`bridge stopped: ${err.message}`);
    process.exit(1);
});
