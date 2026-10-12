// The API.
//
// Every route that touches budget data resolves the caller from their session
// cookie first and then works only inside that caller's own database. There is
// no route that takes a user id from the request, so there is nothing to tamper
// with to reach someone else's data.

import { MIN_PASSWORD } from "./config.js";
import {
  clearSessionCookie,
  clientIp,
  fail,
  readJson,
  sendJson,
  sessionToken,
  setSessionCookie,
} from "./http.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import {
  createSession,
  createUser,
  deleteUser,
  destroySession,
  destroyUserSessions,
  getUserByEmail,
  getUserById,
  loadState,
  publicUser,
  saveState,
  sessionUser,
  updateUserName,
  updateUserPassword,
  wipeUserData,
} from "./store.js";

// ---------------------------------------------------------------------------
// Rate limiting
//
// A small in-memory limiter on the auth routes. It is not a substitute for a
// reverse proxy in front of a public deployment, but it stops the obvious
// scripted guessing of passwords from a single address.
// ---------------------------------------------------------------------------

const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 20;

function tooManyAttempts(req) {
  const key = clientIp(req);
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.reset <= now) {
    attempts.set(key, { count: 1, reset: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

function clearAttempts(req) {
  attempts.delete(clientIp(req));
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.reset <= now) attempts.delete(key);
}, WINDOW_MS).unref();

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function validEmail(email) {
  return EMAIL.test(email) && email.length <= 254;
}

async function requireUser(req, res) {
  const user = sessionUser(sessionToken(req));
  if (!user) {
    fail(res, 401, "Please sign in.");
    return null;
  }
  return user;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const routes = {
  "POST /api/auth/register": async (req, res) => {
    if (tooManyAttempts(req)) return fail(res, 429, "Too many attempts. Try again later.");

    const body = await readJson(req);
    const name = clean(body.name, 80);
    const email = clean(body.email, 254).toLowerCase();
    const password = String(body.password ?? "");

    if (!name) return fail(res, 400, "Please enter your name.");
    if (!validEmail(email)) return fail(res, 400, "That email address does not look right.");
    if (password.length < MIN_PASSWORD) {
      return fail(res, 400, `Please use at least ${MIN_PASSWORD} characters for your password.`);
    }
    if (getUserByEmail(email)) {
      return fail(res, 409, "An account with that email already exists.");
    }

    const secret = hashPassword(password);
    const user = createUser({ email, name, salt: secret.salt, hash: secret.hash, kdf: secret.kdf });
    const session = createSession(user.id);
    setSessionCookie(res, session.token, session.expiresAt);
    clearAttempts(req);
    return sendJson(res, 201, { user: publicUser(user) });
  },

  "POST /api/auth/login": async (req, res) => {
    if (tooManyAttempts(req)) return fail(res, 429, "Too many attempts. Try again later.");

    const body = await readJson(req);
    const email = clean(body.email, 254).toLowerCase();
    const password = String(body.password ?? "");
    if (!email || !password) return fail(res, 400, "Enter your email and password.");

    const user = getUserByEmail(email);
    // Same message whether the email is unknown or the password is wrong, so
    // this cannot be used to discover which accounts exist.
    const ok = user && verifyPassword(password, user.salt, user.hash, user.kdf);
    if (!ok) return fail(res, 401, "Email or password is not right.");

    const session = createSession(user.id);
    setSessionCookie(res, session.token, session.expiresAt);
    clearAttempts(req);
    return sendJson(res, 200, { user: publicUser(user) });
  },

  "POST /api/auth/logout": async (req, res) => {
    destroySession(sessionToken(req));
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  },

  "GET /api/auth/me": async (req, res) => {
    // 200 with a null user rather than 401: "not signed in yet" is the normal
    // state on a first visit, not an error worth a console entry.
    const user = sessionUser(sessionToken(req));
    return sendJson(res, 200, { user: publicUser(user) });
  },

  "POST /api/auth/password": async (req, res) => {
    if (tooManyAttempts(req)) return fail(res, 429, "Too many attempts. Try again later.");

    const user = await requireUser(req, res);
    if (!user) return;

    const body = await readJson(req);
    const current = String(body.current ?? "");
    const next = String(body.next ?? "");

    if (!verifyPassword(current, user.salt, user.hash, user.kdf)) {
      return fail(res, 401, "Your current password is not right.");
    }
    if (next.length < MIN_PASSWORD) {
      return fail(res, 400, `Please use at least ${MIN_PASSWORD} characters.`);
    }

    const secret = hashPassword(next);
    updateUserPassword(user.id, secret);
    // Changing the password signs every other device out.
    destroyUserSessions(user.id);
    const session = createSession(user.id);
    setSessionCookie(res, session.token, session.expiresAt);
    clearAttempts(req);
    return sendJson(res, 200, { ok: true });
  },

  "POST /api/auth/profile": async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const body = await readJson(req);
    const name = clean(body.name, 80);
    if (!name) return fail(res, 400, "Please enter your name.");

    const updated = updateUserName(user.id, name);
    return sendJson(res, 200, { user: publicUser(updated) });
  },

  "GET /api/state": async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    return sendJson(res, 200, { data: loadState(user.id) });
  },

  "PUT /api/state": async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;

    const body = await readJson(req);
    if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
      return fail(res, 400, "Expected a data object.");
    }
    saveState(user.id, body.data);
    return sendJson(res, 200, { ok: true, savedAt: Date.now() });
  },

  "POST /api/account/wipe": async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    wipeUserData(user.id);
    return sendJson(res, 200, { ok: true });
  },

  "DELETE /api/account": async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    deleteUser(user.id);
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  },
};

/**
 * Handle an /api request.
 * @returns {Promise<boolean>} true when the request was handled.
 */
export async function handleApi(req, res, pathname) {
  const key = `${req.method} ${pathname}`;
  const handler = routes[key];
  if (!handler) {
    // Known path, wrong method.
    const known = Object.keys(routes).some((r) => r.endsWith(` ${pathname}`));
    if (known) fail(res, 405, "Method not allowed.");
    else fail(res, 404, "Not found.");
    return true;
  }

  try {
    await handler(req, res);
  } catch (error) {
    if (!res.headersSent) {
      fail(res, error.status || 500, error.status ? error.message : "Something went wrong.");
    } else {
      res.end();
    }
    if (!error.status) console.error("[api]", error);
  }
  return true;
}
