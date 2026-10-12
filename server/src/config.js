// Budget Planner server - where everything lives.
//
// Nothing here needs a build step or an install: Node's own http, crypto and
// sqlite modules are enough. That is deliberate - a server with no dependencies
// cannot rots the way one with a hundred transitive packages does.

import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The server/ directory. */
export const ROOT = path.resolve(here, "..");
/** The project root, which holds web/ and app/. */
export const PROJECT = path.resolve(ROOT, "..");
/** The web app, served as static files. */
export const WEB_DIR = path.join(PROJECT, "web");

/** Everything the server writes. Kept out of git. */
export const DATA_DIR = process.env.BP_DATA_DIR
  ? path.resolve(process.env.BP_DATA_DIR)
  : path.join(ROOT, "data");

/** The accounts database: users and sessions. One file for the whole server. */
export const ACCOUNTS_DB = path.join(DATA_DIR, "accounts.db");

/** One database file per user. This is the "separate DB" guarantee. */
export const USERS_DIR = path.join(DATA_DIR, "users");

export const PORT = Number(process.env.PORT || 8080);

/**
 * Where to listen.
 *
 * On a host, the platform sets PORT and the app has to accept connections from
 * outside, so it binds every interface. Started locally with nothing set, it
 * stays on the loopback address and is not exposed to the local network.
 * HOST overrides both if it is set.
 */
export const HOST = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");

/** True when running behind HTTPS, which turns on the Secure cookie flag. */
export const IS_PROD = process.env.NODE_ENV === "production";

/**
 * The tables a user's data is made of. These are the exact same names the
 * browser app used in localStorage and the native apps use in SQLite, so the
 * Repo layer above them did not have to change at all.
 */
export const TABLES = [
  "kv",
  "months",
  "people",
  "tx",
  "room_bill",
  "savings_tx",
  "need_item",
  "bill",
];

/**
 * Sessions last this long. Long, because the point of "remember me" on a
 * personal app is that you do not sign in every morning; short enough that a
 * forgotten public computer does not stay signed in for ever.
 */
export const SESSION_DAYS = 30;

export const SESSION_COOKIE = "bp_session";

/** A password has to be at least this long. Eight is the usual floor. */
export const MIN_PASSWORD = 8;
