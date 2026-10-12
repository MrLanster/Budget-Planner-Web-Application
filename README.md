# Budget Planner

A budget planner with an Android app, an iOS app, and a web app. **This
repository deploys the web app**, which has real accounts and one private
database per user.

## What actually gets deployed

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
