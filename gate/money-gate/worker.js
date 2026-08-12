// money-gate — the per-purchase authorization gate, a Cloudflare Worker.
//
// Stripe calls this endpoint with `issuing_authorization.request` in real
// time; the answer must land inside Stripe's two-second window. The worker
// is a thin shell: verify the signature, resolve state (KILL flag, day
// counter, any pushed approval) from KV, ask decide() — the pure function in
// decide.js — and write the counters back. No cap literal lives here; the
// caps are imported through decide.js from the single source of cap truth.
//
// Defense in depth: the same numbers are set declaratively on the card as
// spending_limits at creation time, so Stripe's timeout fallback holds the
// floor even if this worker is unreachable. The gate is where policy, the
// approvals pass-through, and the kill flag live; the card limits are the
// floor that cannot be down.
//
// Secrets: exactly one, the webhook signing secret, set at deploy with
// `wrangler secret put STRIPE_WEBHOOK_SECRET` — never in wrangler.toml,
// never in the repo. The KILL flag and approvals arrive through KV writes
// made from the operator's machine (see README.md); the worker itself holds
// no Stripe API key and can call nothing.

import { decide } from './decide.js';

const encoder = new TextEncoder();

function hex(buffer) {
    return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

/**
 * Verify a `Stripe-Signature` header (t=...,v1=...) against the raw body:
 * HMAC-SHA-256 of `${t}.${body}`, with a five-minute timestamp tolerance.
 */
export async function verifyStripeSignature(body, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
    if (!header || !secret) return false;
    const parts = Object.fromEntries(
        header.split(',').map((piece) => piece.split('=').map((s) => s.trim())).filter((kv) => kv.length === 2),
    );
    const timestamp = Number(parts.t);
    if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > 300) return false;
    if (!parts.v1) return false;

    const key = await crypto.subtle.importKey(
        'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const expected = hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${parts.t}.${body}`)));
    return timingSafeEqual(expected, parts.v1);
}

/** UTC day key for the rolling spend counter. */
function dayKey(date = new Date()) {
    return `day:${date.toISOString().slice(0, 10)}`;
}

/**
 * A one-time approval pushed from the operator's machine, or null. Approvals
 * land in KV as `approval:<id>` with the amount pinned; the first record
 * matching this authorization's exact amount is the pass, and it is deleted
 * on use — one click, one spend, nothing reusable.
 */
async function findApproval(kv, amountCents) {
    const listing = await kv.list({ prefix: 'approval:' });
    for (const entry of listing.keys) {
        let record;
        try {
            record = JSON.parse(await kv.get(entry.name));
        } catch {
            record = null;
        }
        if (record && record.amount_cents === amountCents) {
            return { id: record.id, amount_cents: record.amount_cents, kvKey: entry.name };
        }
    }
    return null;
}

export default {
    async fetch(request, env) {
        if (request.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'POST only' }), {
                status: 405, headers: { 'Content-Type': 'application/json' },
            });
        }

        const body = await request.text();
        const signed = await verifyStripeSignature(
            body, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET,
        );
        if (!signed) {
            // Spec §4.5 step 1: a failed signature is a decline, not an error
            // page — nothing unsigned may ever approve a spend.
            return new Response(JSON.stringify({ approved: false, reason: 'bad signature' }), {
                status: 400, headers: { 'Content-Type': 'application/json' },
            });
        }

        let event;
        try {
            event = JSON.parse(body);
        } catch {
            return new Response(JSON.stringify({ approved: false, reason: 'unparseable event' }), {
                status: 400, headers: { 'Content-Type': 'application/json' },
            });
        }

        if (event.type !== 'issuing_authorization.request') {
            return new Response(JSON.stringify({ received: true }), {
                status: 200, headers: { 'Content-Type': 'application/json' },
            });
        }

        const auth = event.data?.object ?? {};
        const amountCents = auth.pending_request?.amount ?? auth.amount;
        const cardKind = auth.card?.metadata?.sherman_card === 'training' ? 'training' : 'float';

        const kill = Boolean(await env.MONEY_KV.get('KILL'));
        const daySpent = Number(await env.MONEY_KV.get(dayKey())) || 0;
        const approval = await findApproval(env.MONEY_KV, amountCents);

        const decision = decide(
            { amount_cents: amountCents, card_kind: cardKind, approval_id: approval?.id ?? null },
            { kill, day_spent_cents: daySpent, approval },
        );

        if (decision.approved) {
            // Two UTC days of TTL: the counter needs to survive its own day
            // and nothing longer.
            await env.MONEY_KV.put(dayKey(), String(decision.day_spent_after_cents), { expirationTtl: 172800 });
            if (approval) await env.MONEY_KV.delete(approval.kvKey);
        } else {
            // Spec §4.5 step 3: record the decline so `sherman money sync`
            // can pick it up into the ledger and the approvals tee-up.
            await env.MONEY_KV.put(
                `decline:${Date.now()}`,
                JSON.stringify({ amount_cents: amountCents, reason: decision.reason, auth_id: auth.id ?? null }),
                { expirationTtl: 604800 },
            );
        }

        return new Response(JSON.stringify({ approved: decision.approved }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
        });
    },
};
