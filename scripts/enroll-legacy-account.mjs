// Generate a reviewed SQL file for a previously verified owner. Never deploys,
// sends mail, verifies ownership, or changes a live database by itself.
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
export function enrollmentSQL({ id, email }) {
  if (!/^[a-f0-9-]{36}$/.test(id || '') || typeof email !== 'string' || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new Error('Provide a legacy user UUID and a real owner-approved email address.');
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  return `-- Apply only after independently verifying this legacy account's owner.\n-- This assigns an email; the owner must complete Better Auth verification and password reset.\nUPDATE auth_users SET email = ${quote(email.trim().toLowerCase())}, emailVerified = 0, updatedAt = unixepoch() * 1000\nWHERE id = ${quote(id)} AND email IS NULL;\n`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [id, email, output] = process.argv.slice(2);
  if (!output) throw new Error('Usage: node scripts/enroll-legacy-account.mjs USER_UUID EMAIL OUTPUT.sql');
  await writeFile(output, enrollmentSQL({ id, email }), { flag: 'wx' });
  console.log('Wrote enrollment SQL for review. No database was changed.');
}
