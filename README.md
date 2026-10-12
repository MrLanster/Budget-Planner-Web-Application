# Budget Planner

A budget planner with an Android app, an iOS app, and a web app. The web app
ships in **two independent forms**, and you deploy whichever one you want:

| Version | Files | Runs on |
| ------- | ----- | ------- |
| Node web app | `web/` + `server/` | any Node host (Render, Railway, Fly.io, a VPS, Docker) |
| Streamlit app | `streamlit_app.py` + `requirements.txt` | Streamlit Community Cloud, or any machine with Python |

They share nothing but the idea, so ignore whatever you are not deploying. Both
give everyone their own account and keep one person's budget out of another's.
The Node version uses one SQLite file per user; the Streamlit version is core
budgeting (see [its section](#deploy-the-streamlit-version)).

## The Node web app

Only two folders matter:

| Path      | What it is                                                          |
| --------- | ------------------------------------------------------------------- |
| `web/`    | the browser app - plain HTML/CSS/JS, no build step                   |
| `server/` | the Node server: accounts, sessions, and one SQLite file per user    |

Everything else belongs to something else and is ignored at run time:

- `app/` - the Android app (and its `build/` output)
- `BudgetPlanner-iOS/` - the iOS app
- `gradle*`, `build.gradle.kts`, `settings.gradle.kts`, `local.properties` - the
  Android build
- `*.apk`, `BudgetPlanner-Web.zip` - built artefacts
- `server/data/` - **live accounts and everyone's budget. Never committed.**

### The exact files to commit

```
.gitignore
.dockerignore
.nvmrc
package.json
README.md
Dockerfile
render.yaml
web/
server/          (everything except server/data/)
```

That is the whole web app. If you would rather keep one repository for every
platform, committing the rest is fine too - `.gitignore` already excludes the
Android `build/` output, `.gradle/`, the APKs and `server/data/`.

## Run it locally

Needs **Node.js 22.5 or newer** (for the built-in `node:sqlite`). There is
nothing to install - no dependencies at all.

```
npm start        ->  http://localhost:8080
```

## Deploy it

The server is a single dependency-free Node process that serves both the app and
the API. Any Node host works (Render, Railway, Fly.io, a VPS, Docker).

| Setting          | Value                                                    |
| ---------------- | -------------------------------------------------------- |
| Start command    | `npm start`                                              |
| Node version     | 22.5+ (see `.nvmrc` and `engines` in `package.json`)     |
| Build command    | none needed                                              |
| `NODE_ENV`       | `production` - marks the session cookie `Secure`          |
| `BP_DATA_DIR`    | where databases live - **point at a persistent volume**  |

`HOST` and `PORT` need no setting: the server reads `PORT` from the host and
binds `0.0.0.0` automatically.

A `Dockerfile` is included for a VPS or any container host. It puts the data in
`/data`, so mount a volume there.

### The one thing that bites people

Most hosts give you an **ephemeral** filesystem: the disk is wiped on every
redeploy. Since each user's budget is a SQLite file, that means losing every
account. Mount a persistent disk/volume and set `BP_DATA_DIR` to it.

### Do not deploy `web/` on its own

Publishing just the `web/` folder to a static host (GitHub Pages, Netlify) would
silently drop the accounts and put everyone's data back in their own browser,
with no login. The server has to run for accounts to mean anything.

# Deploy the Streamlit version

`streamlit_app.py` is a self-contained Streamlit app: sign up, sign in, add
spending or income entries, list them, and see a monthly summary. It needs an
external Postgres, because Streamlit Community Cloud wipes its disk on every
restart and a local database file would vanish with everyone's accounts.

## What is in this version

- Accounts: register, sign in, sign out. Passwords are hashed with PBKDF2-SHA256
  from the Python standard library, each with its own random salt.
- Entries: spending or income, with category, date and an optional note.
- A monthly summary: income, spending, net, a breakdown by category, and CSV
  export. Deleting an entry is under "Delete an entry".
- Per-user isolation: every row carries the owner's id and every query is
  filtered by the signed-in user.

Not here yet (the Node version has them): roommates, bills, savings goals,
reminders, and history charts. Sessions live in the browser's page state, so
refreshing the page signs you out - a cookie-based session is the next step.

## Run it locally

Needs Python 3.10 or newer.

```
pip install -r requirements.txt
streamlit run streamlit_app.py
```

With no `DATABASE_URL` set it uses a SQLite file, `budget_planner.db`, next to
the script - handy for trying it out, but do not use that in the Cloud.

## Deploy on Streamlit Community Cloud

1. Get a free Postgres from [Neon](https://neon.tech) or
   [Supabase](https://supabase.com) and copy its connection string. Change the
   scheme to `postgresql+psycopg://` so SQLAlchemy picks the right driver.
2. Push this repository to GitHub.
3. Go to [share.streamlit.io](https://share.streamlit.io) and choose
   **New app**, then pick the repository and branch.
4. Set **Main file path** to `streamlit_app.py`.
5. Open **Advanced settings > Secrets** and add:

   ```toml
   DATABASE_URL = "postgresql+psycopg://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require"
   ```

6. Click **Deploy**. The tables are created on first boot.

`.streamlit/secrets.toml.example` shows the same value for local use; copy it to
`.streamlit/secrets.toml`, which is git-ignored.

## How this differs from the Node version

- **One database, not one per user.** A hosted Postgres is a single database, so
  isolation is enforced by a `user_id` column on every row rather than a separate
  file. Queries always filter on the signed-in user.
- **A different look.** Streamlit draws its own widgets, so this is a data-style
  dashboard, not the mobile layout in `web/`.
