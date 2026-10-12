// The storage layer.
//
// Two kinds of database:
//
//   accounts.db     one file for the whole server: who exists, who is signed in.
//   users/<id>.db   one file per user, holding only that user's budget data.
//
// Because each user's rows live in their own file, one user's data is not merely
// filtered out for another user - it is in a different database that the other
// user's account never opens. That is the strongest form of separation a single
// server can offer.

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  ACCOUNTS_DB,
  DATA_DIR,
  SESSION_DAYS,
  TABLES,
  USERS_DIR,
} from "./config.js";

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(USERS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Accounts and sessions
// ---------------------------------------------------------------------------

const accounts = new DatabaseSync(ACCOUNTS_DB);
accounts.exec("PRAGMA journal_mode = WAL;");
accounts.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    email       TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    salt        TEXT NOT NULL,
    hash        TEXT NOT NULL,
    kdf         TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
`);

const publicUser = (u) => (u ? { id: u.id, name: u.name, email: u.email } : null);

export function getUserById(id) {
  return accounts.prepare("SELECT * FROM users WHERE id = ?").get(id) || null;
}

export function getUserByEmail(email) {
  return accounts
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(String(email || "").trim().toLowerCase()) || null;
}

export function createUser({ email, name, salt, hash, kdf }) {
  const id = randomUUID();
  accounts
    .prepare(
      "INSERT INTO users (id, email, name, salt, hash, kdf, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      id,
      String(email).trim().toLowerCase(),
      String(name).trim(),
      salt,
      hash,
      kdf,
      Date.now()
    );
  return getUserById(id);
}

export function updateUserPassword(id, { salt, hash, kdf }) {
  accounts
    .prepare("UPDATE users SET salt = ?, hash = ?, kdf = ? WHERE id = ?")
    .run(salt, hash, kdf, id);
}

export function updateUserName(id, name) {
  accounts.prepare("UPDATE users SET name = ? WHERE id = ?").run(String(name).trim(), id);
  return getUserById(id);
}

/** Remove a user, their sessions, and their database file. */
export function deleteUser(id) {
  accounts.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  accounts.prepare("DELETE FROM users WHERE id = ?").run(id);
  const handle = pool.get(id);
  if (handle) {
    try { handle.close(); } catch { /* already gone */ }
    pool.delete(id);
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.rmSync(path.join(USERS_DIR, `${id}.db${suffix}`), { force: true }); } catch { /* ignore */ }
  }
}

export { publicUser };

// ---------------------------------------------------------------------------
// Sessions
//
// The cookie carries a random token. Only a hash of it is stored, so a stolen
// copy of accounts.db cannot be turned into a working login.
// ---------------------------------------------------------------------------

const hashToken = (token) =>
  createHash("sha256").update(String(token)).digest("hex");

export function createSession(userId) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
  accounts
    .prepare(
      "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
    )
    .run(hashToken(token), userId, now, expiresAt);
  return { token, expiresAt };
}

/** The user for a session token, or null. Expired sessions are dropped. */
export function sessionUser(token) {
  if (!token) return null;
  const row = accounts
    .prepare("SELECT * FROM sessions WHERE token_hash = ?")
    .get(hashToken(token));
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    accounts.prepare("DELETE FROM sessions WHERE token_hash = ?").run(row.token_hash);
    return null;
  }
  return getUserById(row.user_id);
}

export function destroySession(token) {
  if (!token) return;
  accounts.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

/** Sign the user out everywhere (used after a password change). */
export function destroyUserSessions(userId) {
  accounts.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

/** Housekeeping: clear expired sessions once at boot and once a day. */
export function pruneSessions() {
  accounts.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
}
pruneSessions();
setInterval(pruneSessions, 24 * 60 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// A user's own database
// ---------------------------------------------------------------------------

/** Open handles, keyed by user id. Kept small: this is a personal app. */
const pool = new Map();

function userDb(userId) {
  const existing = pool.get(userId);
  if (existing) return existing;

  const db = new DatabaseSync(path.join(USERS_DIR, `${userId}.db`));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rows (
      seq   INTEGER PRIMARY KEY AUTOINCREMENT,
      tbl   TEXT NOT NULL,
      json  TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS rows_tbl ON rows (tbl);
  `);
  pool.set(userId, db);
  return db;
}

/**
 * Read a user's whole dataset in the shape the browser app expects:
 * { kv: {...}, months: [...], tx: [...], ... }.
 *
 * Row order is preserved by the autoincrement key, so lists come back in the
 * same order they were saved.
 */
export function loadState(userId) {
  const db = userDb(userId);
  const state = { kv: {} };
  const select = db.prepare(
    "SELECT json FROM rows WHERE tbl = ? ORDER BY seq"
  );

  for (const table of TABLES) {
    if (table === "kv") continue;
    state[table] = select.all(table).map((r) => JSON.parse(r.json));
  }
  for (const row of db.prepare("SELECT k, v FROM kv").all()) {
    state.kv[row.k] = row.v;
  }
  return state;
}

/**
 * Replace a user's whole dataset. The browser app already kept everything in
 * memory and rewrote the whole blob on every change, so replacing it whole is
 * the same shape of write, just durable and private.
 */
export function saveState(userId, data) {
  const db = userDb(userId);
  const source = data && typeof data === "object" ? data : {};

  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DELETE FROM rows; DELETE FROM kv;");

    const insertKv = db.prepare("INSERT INTO kv (k, v) VALUES (?, ?)");
    const kv = source.kv && typeof source.kv === "object" ? source.kv : {};
    for (const [key, value] of Object.entries(kv)) {
      insertKv.run(String(key), String(value));
    }

    const insertRow = db.prepare("INSERT INTO rows (tbl, json) VALUES (?, ?)");
    for (const table of TABLES) {
      if (table === "kv") continue;
      const list = Array.isArray(source[table]) ? source[table] : [];
      for (const row of list) insertRow.run(table, JSON.stringify(row ?? null));
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Empty a user's data but keep the account. */
export function wipeUserData(userId) {
  const db = userDb(userId);
  db.exec("DELETE FROM rows; DELETE FROM kv;");
}

/** An empty dataset, used by the client's wipe(). */
export function emptyState() {
  const state = { kv: {} };
  for (const table of TABLES) {
    if (table !== "kv") state[table] = [];
  }
  return state;
}
