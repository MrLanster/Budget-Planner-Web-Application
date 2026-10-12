// Budget Planner - the signed-in user.
//
// This used to be a local password: a salted hash kept in this browser, asked
// on every open, protecting nothing outside this device. Accounts now live on
// the server, so this module is a thin client for the auth API.
//
// What that buys: a real account with an email, a password that is verified on
// the server and never stored in the browser, and a session cookie that is the
// only thing standing between a request and that account's data.
//
// The password itself never touches this file beyond being posted once.

const NOTHING = null;

/** The signed-in user, or null. Filled by me() / register() / signIn(). */
let current = NOTHING;

async function request(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* some errors have no body */
  }

  if (!res.ok) {
    const error = new Error((payload && payload.error) || "Something went wrong");
    error.status = res.status;
    throw error;
  }
  return payload || {};
}

export const Auth = {
  /** The signed-in user, or null. */
  user() {
    return current;
  },

  name() {
    return current ? current.name : "";
  },

  firstName() {
    return (current && current.name ? current.name.split(" ")[0] : "") || "there";
  },

  email() {
    return current ? current.email : "";
  },

  /** Asks the server who, if anyone, is signed in. */
  async me() {
    try {
      const body = await request("/api/auth/me");
      current = body.user || null;
    } catch {
      current = null;
    }
    return current;
  },

  async register(name, email, password) {
    const body = await request("/api/auth/register", {
      method: "POST",
      body: { name, email, password },
    });
    current = body.user || null;
    return current;
  },

  async signIn(email, password) {
    const body = await request("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    current = body.user || null;
    return current;
  },

  async signOut() {
    try {
      await request("/api/auth/logout", { method: "POST" });
    } finally {
      current = null;
    }
  },

  async changePassword(currentPassword, nextPassword) {
    await request("/api/auth/password", {
      method: "POST",
      body: { current: currentPassword, next: nextPassword },
    });
  },

  async setName(name) {
    const body = await request("/api/auth/profile", {
      method: "POST",
      body: { name },
    });
    current = body.user || current;
    return current;
  },
};
