# Budget Planner server

The web app used to keep everything in the browser. It now signs people in and
keeps each person's budget in **their own database file**, so one user's data is
not merely hidden from another — it lives somewhere the other account never
opens.

## Running it

Requires **Node.js 22.5 or newer** (for the built-in `node:sqlite`). There are no
packages to install.

```
cd server
start.cmd            (Windows)
# or
npm start
```

Then open <http://localhost:8080>.

To try it the way it is meant to be used, create two accounts and add a few
entries to each: neither account can see the other's numbers.

## What is where

```
server/
  src/
    server.js     entry point: routes /api to the API, everything else to web/
    api.js        the routes, and the rule that every one of them is scoped to
                  the signed-in user
    store.js      accounts.db (users, sessions) and one users/<id>.db per person
    passwords.js  scrypt hashing and constant-time checking
    sessions.js   (in store.js) random session tokens, stored only as hashes
    http.js       cookies, JSON bodies, security headers, rate-limit helper
    static.js     serves web/, and refuses anything outside it
  data/           created at run time, and never committed
    accounts.db   who exists, who is signed in
    users/<id>.db one per account - the actual budgets
  start.cmd       runs it with whichever Node is installed
```

## How the app stores data now

The browser app still keeps the whole store in memory and rewrites it on every
change — that is what it always did with localStorage. The difference is that the
rewrite goes to `PUT /api/state`, and the server replaces *that user's* database.
Nothing above the storage layer changed, so every existing feature keeps working.

## Configuration

Set by environment variable:

| Variable      | Default      | Meaning                                            |
| ------------- | ------------ | -------------------------------------------------- |
| `HOST`        | `127.0.0.1`  | `0.0.0.0` to accept connections from other machines |
| `PORT`        | `8080`       |                                                    |
| `NODE_ENV`    |              | `production` turns on the `Secure` cookie flag     |
| `BP_DATA_DIR` | `server/data`| Where the databases live                           |

## Before this faces the internet

The core is here and the isolation is real, but a public deployment should add:

- **HTTPS.** Set `NODE_ENV=production` (so cookies are `Secure`) and terminate
  TLS at a proxy such as Caddy or nginx in front of this server.
- **Rate limiting at the edge.** The built-in limiter is per-address and in
  memory; a proxy should also throttle `/api/auth/*`.
- **Password reset.** That needs email, which is deliberately not wired in.
- **Backups.** Copy `server/data/` on a schedule. Each user's budget is a single
  file, which makes this easy.
- **A real session store or shorter sessions** if you expect many users.
