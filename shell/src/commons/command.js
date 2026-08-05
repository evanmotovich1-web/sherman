import { rmSync } from 'node:fs';

import { CommonsClient, CommonsError, readBoundedJson } from './client.js';
import { enrollDevice, identityPath, loadIdentity } from './identity.js';
import {
    LOCAL_HUMAN_CONFIRMATION,
    approvePendingIntent,
    createPendingIntent,
    loadCommonsSettings,
    loadCommonsState,
    publishPendingIntent,
    saveCommonsSettings,
    uninstallCommons,
} from './local-state.js';
import {
    buildCommonsInventory, prepareInventoryDelta, recordInventorySync,
} from './inventory.js';
import {
    buildSkillPublicationBundle,
    installQuarantinedArtifact,
    loadArtifactState,
    prepareSkillPublication,
    quarantineSkillBundle,
    recordSkillPublication,
    reviewQuarantinedArtifact,
} from './artifacts.js';
import { safeTerminalText } from '../ui/sanitize.js';
import { openUrl } from '../browser.js';

const BOUNDARY = 'The Commons service may not be deployed; remote feed, publish, inventory, revoke, and artifact routes can be unavailable.';

function result(ok, text) {
    return { ok, text };
}

function safeError(error) {
    const messages = {
        offline: 'Commons is offline or unreachable.',
        timeout: 'Commons did not respond before the local timeout.',
        revoked: 'This Commons enrollment is revoked. Use /commons uninstall to remove local keys and state.',
        response_too_large: 'Commons returned more data than the local safety limit.',
        service_unavailable: 'This Commons service capability is not available.',
        invalid_request: 'The Commons request was rejected locally.',
        invalid_response: 'Commons returned an invalid response.',
        request_rejected: 'Commons rejected the request.',
    };
    return messages[error?.code] ?? 'The Commons operation could not be completed safely.';
}

function clientFor({ home, fetchImpl, clientFactory }) {
    if (clientFactory) return clientFactory();
    const settings = loadCommonsSettings(home);
    const identity = loadIdentity(home);
    if (!settings || !identity) throw Object.assign(new Error(), { code: 'invalid_request' });
    return new CommonsClient({ serviceUrl: settings.serviceUrl, identity, fetchImpl });
}

function dashboardFor({ home, serviceUrl, dashboardUrl }) {
    const configuredService = serviceUrl || loadCommonsSettings(home)?.serviceUrl;
    if (!configuredService) throw Object.assign(new Error(), { code: 'invalid_request' });
    let service;
    let dashboard;
    try {
        service = new URL(configuredService);
        dashboard = new URL(dashboardUrl || '/', service.origin);
    } catch {
        throw Object.assign(new Error(), { code: 'invalid_request' });
    }
    const localhost = ['localhost', '127.0.0.1', '[::1]'].includes(service.hostname);
    if (
        dashboard.origin !== service.origin
        || dashboard.username || dashboard.password
        || (dashboard.protocol !== 'https:' && !(localhost && dashboard.protocol === 'http:'))
    ) {
        throw Object.assign(new Error(), { code: 'invalid_dashboard' });
    }
    return dashboard.href;
}

async function enroll({ home, token, serviceUrl, fetchImpl }) {
    if (!serviceUrl) return result(false, 'Enrollment needs an approved HTTPS Commons service URL. Set SHERMAN_COMMONS_URL for this local shell.');
    let endpoint;
    try {
        endpoint = new URL(serviceUrl);
    } catch {
        return result(false, 'Enrollment needs an approved HTTPS Commons service URL.');
    }
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
        return result(false, 'Enrollment needs an approved HTTPS Commons service URL.');
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
    try {
        const identity = await enrollDevice({
            home,
            enrollmentToken: token,
            label: 'Sherman Shell',
            enroll: async (body) => {
                let response;
                try {
                    response = await fetchImpl(new URL('/enrollment/v1/device', endpoint.origin).href, {
                        method: 'POST',
                        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                        signal: controller.signal,
                    });
                } catch {
                    throw Object.assign(new Error(), { code: timedOut ? 'timeout' : 'offline' });
                }
                if (!response.ok) throw Object.assign(new Error(), { code: response.status === 404 ? 'service_unavailable' : 'request_rejected' });
                const value = await readBoundedJson(response, 4096);
                const allowed = ['protocol', 'network_id', 'device_id', 'agent_id', 'owner_display_name'];
                if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
                    throw Object.assign(new Error(), { code: 'invalid_response' });
                }
                return value;
            },
        });
        saveCommonsSettings({ home, serviceUrl: endpoint.origin, autoPublishInventory: false });
        return result(true, `Commons enrolled for ${identity.ownerDisplayName}. Inventory sharing is off.`);
    } catch (error) {
        // A response may fail after identity.js has created no file, but remove
        // any partial local identity defensively. Never echo the token or error.
        try { rmSync(identityPath(home), { force: true }); } catch {}
        return result(false, safeError(error));
    } finally {
        clearTimeout(timer);
    }
}

function renderPage(page) {
    if (!page.items.length) return 'Commons returned no posts.';
    return page.items.map((post) => [
        `${post.id} · ${post.kind}`,
        `${post.title}`,
        `Sherman for ${post.owner_display_name} · ${post.authorship_mode.replace('_', '-')}`,
    ].join('\n')).join('\n\n');
}

function renderTrending(page) {
    if (!page.items.length) return 'Commons returned no trending issues.';
    return page.items.map((issue) => [
        `${issue.id} · ${issue.issue_key} · ${issue.trend.state ?? 'not trending'}`,
        issue.title,
        `${issue.trend.unique_owners} distinct active owners · threshold ${issue.trend.threshold}`,
    ].join('\n')).join('\n\n');
}

export async function runCommonsCommand(args = '', {
    home = process.env.HOME,
    serviceUrl = process.env.SHERMAN_COMMONS_URL,
    dashboardUrl = process.env.SHERMAN_COMMONS_DASHBOARD_URL,
    fetchImpl = globalThis.fetch,
    clientFactory = null,
    openDashboard = openUrl,
} = {}) {
    const text = String(args ?? '').trim();
    const split = text.match(/^(\S+)(?:\s+([\s\S]*))?$/);
    const subcommand = split?.[1]?.toLowerCase() || 'status';
    const rest = split?.[2]?.trim() || '';
    try {
        if (subcommand === 'enroll') {
            if (!rest) return result(false, 'Usage: /commons enroll <one-time-token>');
            return enroll({ home, token: rest, serviceUrl, fetchImpl });
        }
        if (subcommand === 'status') {
            const identity = loadIdentity(home);
            if (!identity) return result(true, `Commons is not enrolled. Inventory sharing is off.\n${BOUNDARY}`);
            const state = loadCommonsState(home);
            const pending = state.intents.filter((intent) => intent.status !== 'published').length;
            const response = await clientFor({ home, fetchImpl, clientFactory }).heartbeat();
            return result(true, `Commons active for ${identity.ownerDisplayName}. ${pending} pending local intent${pending === 1 ? '' : 's'}. Inventory sharing is ${loadCommonsSettings(home)?.autoPublishInventory ? 'on' : 'off'}.${response.replayed ? ' Heartbeat replay acknowledged.' : ''}`);
        }
        if (subcommand === 'feed' || subcommand === 'trending') {
            const limit = rest ? Number(rest) : 20;
            const page = await clientFor({ home, fetchImpl, clientFactory })[subcommand]({ limit });
            return result(true, subcommand === 'feed' ? renderPage(page) : renderTrending(page));
        }
        if (subcommand === 'open' && !rest) {
            let url;
            try {
                url = dashboardFor({ home, serviceUrl, dashboardUrl });
            } catch (error) {
                return result(false, error?.code === 'invalid_dashboard'
                    ? 'The Commons dashboard URL must be same-origin with the configured service and use HTTPS (HTTP is allowed only for localhost development).'
                    : 'Commons needs an enrolled service or SHERMAN_COMMONS_URL before its dashboard can open.');
            }
            const opened = openDashboard(url);
            return opened?.ok
                ? result(true, `Commons dashboard opening in your browser (${opened.method}).`)
                : result(false, `Could not open the Commons dashboard here (${opened?.reason ?? 'no browser mechanism available'}).`);
        }
        if (subcommand === 'thread' || subcommand === 'open') {
            if (!rest) return result(false, 'Usage: /commons thread <post-id>');
            const thread = await clientFor({ home, fetchImpl, clientFactory }).thread(rest, { limit: 20 });
            return result(true, renderPage({ items: [thread.post, ...thread.replies] }));
        }
        if (subcommand === 'propose') {
            let post;
            try { post = JSON.parse(rest); } catch { return result(false, 'Usage: /commons propose <strict post JSON>'); }
            const intent = createPendingIntent({ home, post, source: 'shell' });
            return result(true, `Created pending intent ${intent.id}. Nothing was sent. Review the exact local intent, then type /commons approve ${intent.id}.`);
        }
        if (subcommand === 'approve') {
            if (!/^[a-f0-9-]{36}$/.test(rest)) return result(false, 'Usage: /commons approve <intent-id>');
            const intent = approvePendingIntent({ home, id: rest, confirmation: LOCAL_HUMAN_CONFIRMATION });
            return result(true, [
                `Intent ${intent.id} approved for its exact body hash ${intent.bodyHash} until ${new Date(intent.approvedUntil).toISOString()}.`,
                `Kind: ${safeTerminalText(intent.post.kind)} · ${safeTerminalText(intent.post.authorship_mode).replace('_', '-')} · ${safeTerminalText(intent.post.visibility)}`,
                `Title: ${safeTerminalText(intent.post.title)}`,
                `Body: ${safeTerminalText(intent.post.body, { preserveNewlines: true })}`,
                'Nothing was sent. Publication still requires /commons publish-intent with this intent ID.',
            ].join('\n'));
        }
        if (subcommand === 'publish-intent') {
            if (!/^[a-f0-9-]{36}$/.test(rest)) return result(false, 'Usage: /commons publish-intent <intent-id>');
            const intent = await publishPendingIntent({
                home, id: rest, client: clientFor({ home, fetchImpl, clientFactory }),
            });
            return result(true, `Published approved intent ${intent.id}; receipt ${intent.receipt.postId}.`);
        }
        if (subcommand === 'inventory') {
            const action = rest.toLowerCase() || 'status';
            const settings = loadCommonsSettings(home);
            if (!settings) return result(false, 'Commons must be enrolled before inventory sharing can be configured.');
            if (action === 'enable' || action === 'disable') {
                saveCommonsSettings({
                    home, serviceUrl: settings.serviceUrl, autoPublishInventory: action === 'enable',
                });
                return result(true, `Commons metadata-only inventory sharing is ${action === 'enable' ? 'on' : 'off'}. No skill source, secrets, values, paths, or raw files are included.`);
            }
            if (action === 'status') {
                return result(true, `Commons metadata-only inventory sharing is ${settings.autoPublishInventory ? 'on' : 'off'}.`);
            }
            if (action === 'sync') {
                const inventory = buildCommonsInventory();
                const delta = prepareInventoryDelta({ home, inventory });
                if (!delta.enabled) return result(false, 'Inventory sharing is off. Type /commons inventory enable to opt in.');
                if (!delta.upserts.length && !delta.removals.length) return result(true, 'Commons inventory is already current locally.');
                const receipt = await clientFor({ home, fetchImpl, clientFactory }).upsertInventory({
                    hash: delta.hash, upserts: delta.upserts, removals: delta.removals,
                });
                recordInventorySync({ home, inventory, receipt });
                return result(true, `Commons accepted metadata-only inventory hash ${inventory.hash}.`);
            }
            return result(false, 'Usage: /commons inventory [status|enable|disable|sync]');
        }
        if (subcommand === 'artifact') {
            const artifactMatch = rest.match(/^(\S+)(?:\s+([\s\S]*))?$/);
            const action = artifactMatch?.[1]?.toLowerCase() || 'status';
            const artifactArgs = artifactMatch?.[2]?.trim() || '';
            if (action === 'prepare') {
                const [name, version, ...extra] = artifactArgs.split(/\s+/);
                if (!name || !version || extra.length) return result(false, 'Usage: /commons artifact prepare <personal-skill-name> <semver>');
                const publication = prepareSkillPublication({
                    home, name, version, compatibility: { node: '>=22' },
                });
                return result(true, `Prepared local pending artifact ${publication.id} with candidate digest ${publication.digest}. Nothing was uploaded or signed.`);
            }
            if (action === 'publish') {
                if (!artifactArgs) return result(false, 'Usage: /commons artifact publish <pending-id>');
                const identity = loadIdentity(home);
                if (!identity) return result(false, 'Commons must be enrolled before an artifact can be published.');
                const client = clientFor({ home, fetchImpl, clientFactory });
                const keys = await client.publisherKeys();
                const publisher = keys.find((key) => key.public_key === identity.publicKey);
                if (!publisher) return result(false, 'No active server-provisioned publisher key matches this enrolled device. Nothing was uploaded.');
                const bundle = buildSkillPublicationBundle({
                    home,
                    id: artifactArgs,
                    networkId: identity.networkId,
                    publisherKeyId: publisher.id,
                    privateKey: identity.privateKey,
                });
                const receipt = await client.publishArtifact(bundle, { idempotencyKey: `artifact:${bundle.digest}` });
                recordSkillPublication({ home, id: artifactArgs, bundle, receipt });
                return result(true, `Published signed artifact ${receipt.id} for quarantine scanning; status ${receipt.scan_status}.${receipt.replayed ? ' Exact request replay acknowledged.' : ''}`);
            }
            if (action === 'download') {
                if (!artifactArgs) return result(false, 'Usage: /commons artifact download <artifact-id>');
                const downloaded = await clientFor({ home, fetchImpl, clientFactory }).downloadArtifact(artifactArgs);
                const { artifact, trust } = downloaded;
                const trustedPublisher = {
                    network_id: trust.network_id,
                    publisher_key_id: trust.publisher_key_id,
                    public_key: trust.public_key,
                    status: trust.publisher_status,
                    revoked_at: trust.publisher_revoked_at,
                    scan: {
                        status: trust.scan.status,
                        scanner_version: trust.scan.scanner_version,
                        artifact_digest: trust.scan.artifact_digest,
                        artifact_version: trust.scan.artifact_version,
                        scanned_at: trust.scan.scanned_at * 1000,
                    },
                };
                const adoption = quarantineSkillBundle({
                    home,
                    bundle: artifact,
                    trustedScanVersion: trust.current_scanner_version,
                    resolveTrustedPublisher: (networkId, publisherKeyId) => (
                        networkId === trustedPublisher.network_id && publisherKeyId === trustedPublisher.publisher_key_id
                            ? trustedPublisher : null
                    ),
                });
                return result(true, `Downloaded and quarantined ${adoption.name} ${adoption.version} as ${adoption.id}. Review its deterministic diff before installation; nothing was executed.`);
            }
            if (action === 'status') {
                const state = loadArtifactState(home);
                const pending = state.publications.filter((item) => item.status === 'pending').length;
                const published = state.publications.filter((item) => item.status === 'published').length;
                const quarantined = state.adoptions.filter((item) => item.status === 'quarantined').length;
                return result(true, `Commons artifacts: ${pending} pending publication manifest${pending === 1 ? '' : 's'} · ${published} published artifact${published === 1 ? '' : 's'} · ${quarantined} quarantined adoption${quarantined === 1 ? '' : 's'}.`);
            }
            if (action === 'review') {
                const review = reviewQuarantinedArtifact({ home, id: artifactArgs });
                return result(true, review.text);
            }
            if (action === 'install') {
                const [id, ...confirmationParts] = artifactArgs.split(/\s+/);
                const receipt = installQuarantinedArtifact({
                    home, id, confirmation: confirmationParts.join(' '),
                });
                return result(true, `Installed owner-confirmed personal skill ${receipt.name} ${receipt.version}; receipt ${receipt.id}. Bundled skills still win collisions. Nothing was executed.`);
            }
            return result(false, 'Usage: /commons artifact [status|prepare <name> <semver>|publish <id>|download <id>|review <id>|install <id> INSTALL <id> <digest> REVIEW <review-digest>]');
        }
        if (subcommand === 'revoke') {
            await clientFor({ home, fetchImpl, clientFactory }).revoke();
            uninstallCommons({ home });
            return result(true, 'Commons device revoked remotely; local identity, settings, pending state, quarantine, and keys removed.');
        }
        if (subcommand === 'uninstall') {
            const removed = uninstallCommons({ home });
            return result(true, removed
                ? 'Removed local Commons identity, settings, pending state, quarantine, and keys. Remote revocation was not claimed.'
                : 'Commons had no local state to remove. Remote revocation was not claimed.');
        }
        return result(false, 'Usage: /commons [status|enroll <token>|feed [limit]|trending [limit]|open|thread <id>|propose <json>|approve <intent-id>|publish-intent <intent-id>|inventory <action>|revoke|uninstall]');
    } catch (error) {
        if (error instanceof CommonsError || error?.code) return result(false, safeError(error));
        return result(false, safeError(null));
    }
}
