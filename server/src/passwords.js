// Password hashing.
//
// scrypt is used rather than bcrypt/argon2 because it ships inside Node itself,
// which keeps the server dependency-free. scrypt is a memory-hard password KDF
// and is a perfectly respectable production choice.
//
// The stored format keeps the parameters alongside the hash, so the cost can be
// raised later without invalidating existing passwords: old hashes keep working
// with the parameters they were made with.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LEN = 64;
const SALT_LEN = 16;

/** Current cost. N is the CPU/memory cost; higher is slower and safer. */
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const kdfName = (p) => `scrypt$${p.N}$${p.r}$${p.p}`;

function parseKdf(kdf) {
  const parts = String(kdf || "").split("$");
  if (parts[0] !== "scrypt" || parts.length !== 4) return PARAMS;
  const [, N, r, p] = parts;
  return { N: Number(N), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem };
}

/**
 * Hash a password for storage.
 * @returns {{salt: string, hash: string, kdf: string}}
 */
export function hashPassword(password) {
  const salt = randomBytes(SALT_LEN).toString("hex");
  const hash = scryptSync(password, salt, KEY_LEN, PARAMS).toString("hex");
  return { salt, hash, kdf: kdfName(PARAMS) };
}

/**
 * Check a password against a stored hash. Constant-time, so it does not leak
 * how much of the hash matched.
 */
export function verifyPassword(password, salt, expectedHex, kdf) {
  let actual;
  try {
    actual = scryptSync(password, salt, KEY_LEN, parseKdf(kdf));
  } catch {
    return false;
  }
  const expected = Buffer.from(String(expectedHex || ""), "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(actual, expected);
}
