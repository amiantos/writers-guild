/**
 * Passwords
 *
 * Hashed with scrypt at one of OWASP's recommended settings (N=2^15, r=8, p=3), each with its own
 * salt. A hash keeps its settings, so they can be raised later without breaking older hashes.
 */

import crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt);

const COST = 2 ** 15;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 3;
const KEY_LENGTH = 64;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 256;

async function derive(password, salt, N, r, p) {
  // scrypt needs 128 * N * r bytes, past Node's 32MB default at these settings.
  return scrypt(password, salt, KEY_LENGTH, { N, r, p, maxmem: 256 * N * r });
}

/** @returns {Promise<string>} `scrypt$N$r$p$salt$hash`, the salt and hash base64. */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await derive(password, salt, COST, BLOCK_SIZE, PARALLELIZATION);
  return [
    'scrypt',
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

/** Whether a password matches a hash from hashPassword(). False for a missing or unreadable hash. */
export async function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, hash] = String(stored ?? '').split('$');
  if (scheme !== 'scrypt' || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), +N, +r, +p);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// Checked against when there's no account by the name given, so signing in takes as long either way.
let decoyHash = null;

/** Spend as long as verifyPassword() would, for a sign in to an account that doesn't exist. */
export async function verifyDecoy(password) {
  decoyHash ??= await hashPassword(crypto.randomBytes(16).toString('hex'));
  await verifyPassword(password, decoyHash);
  return false;
}

/** Why a password can't be used, or null if it can. */
export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer`;
  }
  return null;
}
