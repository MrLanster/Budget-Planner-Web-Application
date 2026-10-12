// Budget Planner - the data store the app talks to.
// Mirrors the shape of app/src/main/java/com/budgetplanner/data/Db.kt.
//
// This used to be localStorage: the whole store as one JSON blob in the browser.
// Now it is the server. The tables and the functions are exactly the same, so
// nothing above this file had to change; only *where* the bytes live did.
//
// How it works:
//   open()   fetches this user's data from /api/state, once, at sign-in.
//   changes  are applied to the in-memory copy immediately, so the screen is
//            never waiting on the network, and the whole store is then sent
//            back to the server, coalesced so a burst of edits is one write.
//
// The server keeps one database per user and never returns anyone else's rows,
// so the copy in memory is only ever your own data.

const EMPTY = () => ({
  kv: {},          // k, v
  months: [],      // m, salary, savings
  people: [],      // id, name
  tx: [],          // id, type, amount, category, person, date, note, ret, settled, from_sav
  room_bill: [],   // id, amount, note, date, paid_by, split_with ("|"), settled
  savings_tx: [],  // id, amount, date, note, dir
  need_item: [],   // id, text, amount, from_whom, date, done
  bill: [],        // id, name, amount, due_day, category, note, active, paid_month
});

export const TABLES = ["kv", "months", "people", "tx", "room_bill", "savings_tx", "need_item", "bill"];

let db = EMPTY();
/** False until open() has succeeded. Guards against saving over nothing. */
let loaded = false;
let saveTimer = null;
let saving = false;
let dirty = false;
let onSaveError = null;

/** Called when a save fails, so the shell can say so. */
export function setOnSaveError(fn) {
  onSaveError = fn;
}

function normalize(raw) {
  const next = { ...EMPTY(), ...(raw && typeof raw === "object" ? raw : {}) };
  // a table saved by an older build can be missing entirely
  for (const t of TABLES) if (next[t] == null) next[t] = Array.isArray(EMPTY()[t]) ? [] : {};
  if (next.kv == null || typeof next.kv !== "object") next.kv = {};
  return next;
}

/** Loads this user's whole store from the server, once, after sign-in. */
export async function open() {
  const res = await fetch("/api/state", { credentials: "same-origin" });
  if (res.status === 401) {
    // not signed in; the shell will show the sign-in screen
    db = EMPTY();
    loaded = false;
    return db;
  }
  if (!res.ok) throw new Error("Could not load your data");
  const body = await res.json();
  db = normalize(body.data);
  loaded = true;
  return db;
}

function flush() {
  if (!loaded) return;
  if (saveTimer) return;
  // A short hold so a burst of edits (adding a person creates several rows)
  // becomes one write rather than five.
  saveTimer = setTimeout(() => {
    saveTimer = null;
    save();
  }, 200);
}

/** Force a write, for the few places that edit a table array in place. */
export function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  return save();
}

/**
 * Send the whole store to the server. Runs at most one at a time; a change that
 * lands mid-flight is sent again once that one finishes, so nothing is dropped.
 */
async function save() {
  if (!loaded) return;
  if (saving) {
    dirty = true;
    return;
  }
  saving = true;
  try {
    const res = await fetch("/api/state", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: db }),
    });
    if (!res.ok) {
      const err = new Error(res.status === 401 ? "Your session has ended." : "Could not save.");
      err.status = res.status;
      throw err;
    }
  } catch (e) {
    console.warn("Could not save your data", e);
    if (onSaveError) onSaveError(e);
  } finally {
    saving = false;
    if (dirty) {
      dirty = false;
      flush();
    }
  }
}

/** Wait for anything queued to be written, e.g. before signing out. */
export async function flushNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await save();
}

/** Swaps a whole table, for the few filter-and-write-back operations. */
export function replaceTable(name, rows) {
  db[name] = rows;
  flush();
}

/** Every table by name, so the repo can query like it would with SQL. */
export function table(name) {
  return db[name];
}

/** Appends a row, matching INSERT INTO. */
export function insert(name, row) {
  db[name].push(row);
  flush();
  return row;
}

/** Replaces the row whose "id" matches, matching UPDATE ... WHERE id. */
export function updateById(name, id, patch) {
  const i = db[name].findIndex((r) => r.id === id);
  if (i < 0) return null;
  db[name][i] = { ...db[name][i], ...patch };
  flush();
  return db[name][i];
}

/** Deletes the row whose "id" matches, matching DELETE ... WHERE id. */
export function deleteById(name, id) {
  const i = db[name].findIndex((r) => r.id === id);
  if (i < 0) return;
  db[name].splice(i, 1);
  flush();
}

/** Deletes every row where col === value. */
export function deleteWhere(name, col, value) {
  db[name] = db[name].filter((r) => r[col] !== value);
  flush();
}

/** Removes every row of every table. */
export function wipe() {
  db = EMPTY();
  flush();
}

/**
 * The key/value settings table. Kept as an object rather than rows so the
 * settings behave like the SharedPreferences / UserDefaults maps the two
 * native apps use.
 */
export function getKv(key, def = "") {
  const v = db.kv[key];
  return v === undefined || v === null ? def : v;
}

export function setKv(key, value) {
  db.kv[key] = String(value);
  flush();
}

/** Whole-store export, used by the backup button on the Profile page. */
export function exportJson() {
  return JSON.stringify(db, null, 2);
}

/** Restores a whole-store export. Used by the restore button. */
export function importJson(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") throw new Error("Not a Budget Planner backup");
  for (const t of TABLES) {
    if (parsed[t] == null) continue;
    if (t === "kv" && typeof parsed[t] === "object" && !Array.isArray(parsed[t])) db.kv = parsed[t];
    else if (Array.isArray(parsed[t])) db[t] = parsed[t];
  }
  saveNow();
}

/**
 * The same functions gathered under one name.
 *
 * Repo.js uses `import * as Db`, which is the tidier form, but the settings
 * callers (Prefs) only ever want getKv and setKv, and a named object reads
 * better there than a namespace import. Both spellings hit the same code.
 */
export const Db = {
  open,
  saveNow,
  flushNow,
  replaceTable,
  table,
  insert,
  updateById,
  deleteById,
  deleteWhere,
  wipe,
  /** Same as wipe, named for the "Erase everything" button that calls it. */
  reset: wipe,
  getKv,
  setKv,
  exportJson,
  importJson,
  setOnSaveError,
  TABLES,
};
