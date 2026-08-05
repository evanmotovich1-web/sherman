import { chmodSync, readFileSync, writeFileSync } from 'node:fs';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) process.exit(64);

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
const identifier = (value) => typeof value === 'string'
  && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const text = (value, max) => typeof value === 'string' && value.length > 0
  && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const nullableIdentifier = (value) => value === null || identifier(value);
const email = (value) => text(value, 254) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;
const nullableSql = (value) => value === null ? 'NULL' : sql(value);

let seed;
try { seed = JSON.parse(readFileSync(inputPath, 'utf8')); } catch { process.exit(1); }
if (!exact(seed, ['network', 'organizations', 'users', 'agents'])
  || !exact(seed.network, ['id', 'name']) || !identifier(seed.network.id) || !text(seed.network.name, 120)
  || !Array.isArray(seed.organizations) || seed.organizations.length > 10
  || !Array.isArray(seed.users) || seed.users.length < 2 || seed.users.length > 20
  || !Array.isArray(seed.agents) || seed.agents.length < 2 || seed.agents.length > 20) process.exit(1);

const organizationIds = new Set();
const organizationNames = new Set();
for (const organization of seed.organizations) {
  const normalizedName = organization?.name?.trim().toLowerCase();
  if (!exact(organization, ['id', 'name']) || !identifier(organization.id)
    || !text(organization.name, 120) || organizationIds.has(organization.id)
    || organizationNames.has(normalizedName)) process.exit(1);
  organizationIds.add(organization.id);
  organizationNames.add(normalizedName);
}
const users = new Map();
const userEmails = new Set();
const accessSubjects = new Set();
let networkAdmins = 0;
for (const user of seed.users) {
  const normalizedEmail = user?.email?.trim().toLowerCase();
  if (!exact(user, ['id', 'organization_id', 'email', 'access_subject', 'display_name', 'role'])
    || !identifier(user.id) || !nullableIdentifier(user.organization_id)
    || (user.organization_id !== null && !organizationIds.has(user.organization_id))
    || !email(user.email) || !text(user.access_subject, 512) || !text(user.display_name, 120)
    || !['network_admin', 'organization_admin', 'member'].includes(user.role) || users.has(user.id)
    || (user.role === 'organization_admin' && user.organization_id === null)
    || userEmails.has(normalizedEmail) || accessSubjects.has(user.access_subject)) process.exit(1);
  if (user.role === 'network_admin') networkAdmins += 1;
  users.set(user.id, user);
  userEmails.add(normalizedEmail);
  accessSubjects.add(user.access_subject);
}
if (networkAdmins < 1) process.exit(1);
const agentIds = new Set();
const agentOwners = new Set();
const agentNames = new Set();
for (const agent of seed.agents) {
  const owner = users.get(agent?.owner_user_id);
  const normalizedName = agent?.display_name?.trim().toLowerCase();
  if (!exact(agent, ['id', 'organization_id', 'owner_user_id', 'display_name'])
    || !identifier(agent.id) || agentIds.has(agent.id) || !nullableIdentifier(agent.organization_id)
    || !owner || agent.organization_id !== owner.organization_id || !text(agent.display_name, 120)
    || agentOwners.has(agent.owner_user_id) || agentNames.has(normalizedName)) process.exit(1);
  agentIds.add(agent.id);
  agentOwners.add(agent.owner_user_id);
  agentNames.add(normalizedName);
}
for (const ownerId of users.keys()) {
  if (!seed.agents.some((agent) => agent.owner_user_id === ownerId)) process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const statements = [
  'PRAGMA foreign_keys = ON;',
  `INSERT INTO networks (id, name, created_at) VALUES (${sql(seed.network.id)}, ${sql(seed.network.name)}, ${now});`,
  ...seed.organizations.map((organization) => `INSERT INTO organizations (id, network_id, name, created_at) VALUES (${sql(organization.id)}, ${sql(seed.network.id)}, ${sql(organization.name)}, ${now});`),
  ...seed.users.map((user) => `INSERT INTO users (id, network_id, organization_id, normalized_email, access_subject, display_name, role, created_at) VALUES (${sql(user.id)}, ${sql(seed.network.id)}, ${nullableSql(user.organization_id)}, ${sql(user.email.trim().toLowerCase())}, ${sql(user.access_subject)}, ${sql(user.display_name)}, ${sql(user.role)}, ${now});`),
  ...seed.agents.map((agent) => `INSERT INTO agents (id, network_id, organization_id, owner_user_id, display_name, created_at) VALUES (${sql(agent.id)}, ${sql(seed.network.id)}, ${nullableSql(agent.organization_id)}, ${sql(agent.owner_user_id)}, ${sql(agent.display_name)}, ${now});`),
  '',
];
writeFileSync(outputPath, statements.join('\n'), { mode: 0o600, flag: 'wx' });
chmodSync(outputPath, 0o600);
process.stdout.write(seed.network.id);
