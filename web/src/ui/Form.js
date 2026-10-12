// Budget Planner - the small form builder.
// Mirrors app/src/main/java/com/budgetplanner/ui/Form.kt.
//
// Used in the same two places as the Android version, the Add page and the
// dialogs, so the two cannot drift apart. The method names are identical:
// f.money(), f.text(), f.toggle(), f.chips(), f.choice(), f.dateField(),
// f.isOn(field).
//
// One fix against the Android original: Form.kt stores a toggle's state in the
// view's `tag` but only assigns it once at build time, so Form.isOn() kept
// returning the value the toggle started with. Here the state lives on the node
// and is updated on every tap, so isOn() is always right.

import { Fmt } from "../util/Fmt.js";
import { Anim } from "./Anim.js";
import { openCalendar } from "./Calendar.js";
import { tone } from "./Kit.js";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** Parses what a money field holds. Blanks and junk both read as 0. */
export function amountOf(input) {
  const raw = typeof input === "string" ? input : input?.value ?? "";
  const v = parseFloat(String(raw).replace(/[,₹\s]/g, ""));
  return Number.isFinite(v) ? v : 0;
}

export function textOf(input) {
  return (typeof input === "string" ? input : input?.value ?? "").trim();
}

export class Form {
  constructor() {
    this.root = el("div", "form");
    this.dateValue = Fmt.today();
    this.timeValue = [20, 0];
    this._dateViews = [];
  }

  get date() {
    return this.dateValue;
  }

  label(text) {
    this.add(el("div", "flabel", String(text).toUpperCase()));
    return this;
  }

  add(v, top = 0) {
    if (top) v.style.marginTop = `${top}px`;
    this.root.appendChild(v);
    return v;
  }

  // ---------------- amounts ----------------

  money(title, hint = "0") {
    this.label(title);
    return this.add(named(mkMoneyField(hint), title));
  }

  moneyPlain(title, initial = "") {
    this.label(title);
    // initial is often blank for an optional amount, so never parse blindly
    const start = parseFloat(String(initial).trim());
    const e = mkMoneyField(Number.isFinite(start) && start > 0 ? Fmt.moneyPlain(start) : "", 16);
    return this.add(named(e, title));
  }

  // ---------------- text ----------------

  text(title, hint, initial = "") {
    this.label(title);
    return this.add(named(mkField(hint, initial), title));
  }

  area(title, hint) {
    this.label(title);
    return this.add(named(mkField(hint, "", true), title));
  }

  /** Multi-line plain text box, for the things a single input is too small for. */
  search(title, hint = "Search") {
    this.label(title);
    return this.add(mkField(hint, "", false, "search"));
  }

  // ---------------- date and time ----------------

  dateField(title = "Date") {
    this.label(title);
    const t = this.picker("");
    // the row itself is the button that opens the calendar, so it is what gets
    // the label rather than the hidden input
    named(t, title);
    t.addEventListener("click", () => this.pickDate(t));
    this._dateViews.push(t);
    this._refreshDateViews();
    this.add(t);
    return t;
  }

  setDate(d) {
    this.dateValue = d;
    this._refreshDateViews();
  }

  _refreshDateViews() {
    const txt = `${Fmt.dayLabel(this.dateValue)}  ·  ${this.dateValue}`;
    for (const v of this._dateViews) v.textContent = txt;
  }

  pickDate() {
    // the app's own calendar, so it looks like the rest of the app and stops at
    // today: an entry is dated when it happened, not when it is typed
    openCalendar({ value: this.dateValue, onPick: (d) => this.setDate(d) });
  }
  timeField(title, initial) {
    this.label(title);
    this.timeValue = [initial[0], initial[1]];
    const t = this.picker(fmtTime(initial[0], initial[1]));
    const input = document.createElement("input");
    input.type = "time";
    input.className = "time-input";
    input.value = fmtTime(initial[0], initial[1]);
    input.addEventListener("change", () => {
      const p = input.value.split(":");
      if (p.length === 2) {
        this.timeValue = [parseInt(p[0], 10), parseInt(p[1], 10)];
        t.textContent = input.value;
      }
    });
    t.appendChild(input);
    t.addEventListener("click", () => {
      try {
        input.showPicker?.();
      } catch {
        input.style.cssText = "opacity:1;pointer-events:auto;position:static";
      }
    });
    this.add(t);
    return t;
  }

  setTimeValue(h, m) {
    this.timeValue = [h, m];
  }

  getTime() {
    return this.timeValue;
  }

  picker(text) {
    const n = el("div", "picker");
    n.appendChild(el("span", "picker-text", text));
    return n;
  }

  // ---------------- choices ----------------

  /** A tappable field that opens a single-choice list. */
  choice(title, options, selected = 0, onPick = null) {
    this.label(title);
    const t = this.picker(options[selected] ?? "");
    const c = new Choice(options, selected, t, onPick);
    t.addEventListener("click", () => c.open());
    this.add(t);
    return c;
  }

  /**
   * A tick row. Returns the row, which the form remembers, so f.isOn(row) tells
   * you what it is set to right now - not what it was set to when it was built.
   */
  toggle(title, desc = "", on = false, onChange = null) {
    const row = el("div", "toggle" + (on ? " on" : ""));
    const col = el("div", "stack");
    col.style.flex = "1";
    col.appendChild(el("div", "t", title));
    if (desc) col.appendChild(el("div", "d", desc));
    row.appendChild(col);
    const check = el("div", "tick", on ? "✓" : "");
    row.appendChild(check);

    // the state lives here, and is kept in step with what is on screen
    row.formState = { value: !!on };
    row.addEventListener("click", () => {
      row.formState.value = !row.formState.value;
      Anim.tapFeedback(row);
      check.textContent = row.formState.value ? "✓" : "";
      row.classList.toggle("on", row.formState.value);
      onChange?.(row.formState.value);
    });
    this.add(row);
    return row;
  }

  /** The current value of a toggle built by f.toggle(). */
  isOn(row) {
    return !!row?.formState?.value;
  }

  // ---------------- chips ----------------

  /** Horizontal chips, nicer than a dropdown for short lists. */
  chips(title, options, selected = 0, onPick) {
    this.label(title);
    const g = new ChipGroup(options, selected, onPick);
    // the group holds its chips in .row; the group itself is not a node, so
    // adding it straight to the form is what left every dialog that used this
    // throwing "parameter 1 is not of type Node" the moment it opened
    this.add(g.row);
    return g;
  }

  note(text) {
    this.add(el("div", "note", text), 12);
  }
}

function fmtTime(h, m) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** The single-choice dropdown opened by Form.choice(). */
export class Choice {
  constructor(options, index, view, onPick = null) {
    this.options = options;
    this.index = index;
    this.view = view;
    this.onPick = onPick;
  }

  get value() {
    return this.options[this.index] ?? "";
  }

  select(i) {
    this.index = i;
    this.view.querySelector(".picker-text").textContent = this.value;
    this.onPick?.(i);
  }

  open() {
    // a list of big tappable rows, which is what a <select> looks like anyway
    openSheet("Choose one", (s) => {
      const card = el("div", "card");
      card.style.padding = "0";
      this.options.forEach((opt, i) => {
        const b = el("button", "lrow tappable");
        b.type = "button";
        const mid = el("div", "mid");
        mid.appendChild(el("div", "t", opt));
        if (i === this.index) {
          const tick = el("div", "amt", "✓");
          tick.style.color = tone("brand");
          b.appendChild(mid);
          b.appendChild(tick);
        } else {
          b.appendChild(mid);
        }
        b.addEventListener("click", () => {
          this.select(i);
          closeSheet();
        });
        card.appendChild(b);
      });
      s.add(card);
    });
  }
}

export class ChipGroup {
  constructor(options, selected = 0, onPick = () => {}) {
    this.row = el("div", "chiprow");
    this.chips = [];
    this.options = options;
    this.selected = selected;
    this.onPick = onPick;
    options.forEach((name, i) => {
      const c = el("button", "chip" + (i === selected ? " on" : ""), name);
      c.type = "button";
      c.addEventListener("click", () => {
        Anim.tapFeedback(c);
        this.select(i);
        this.onPick(i);
      });
      this.row.appendChild(c);
      this.chips.push(c);
    });
  }

  get value() {
    return this.selected;
  }

  select(i) {
    this.selected = i;
    this.chips.forEach((c, idx) => c.classList.toggle("on", idx === i));
  }

  /** Replaces the option list, e.g. when the categories change. */
  build(options, selectedIndex, callback) {
    this.options = options;
    this.selected = selectedIndex;
    this.onPick = callback;
    this.row.textContent = "";
    this.chips = [];
    options.forEach((name, i) => {
      const c = el("button", "chip" + (i === selectedIndex ? " on" : ""), name);
      c.type = "button";
      c.addEventListener("click", () => {
        Anim.tapFeedback(c);
        this.select(i);
        this.onPick(i);
      });
      this.row.appendChild(c);
      this.chips.push(c);
    });
    return this;
  }
}

// ---------------- fields ----------------

/**
 * Ties a field to the label above it, so the same title can be used to find it
 * later - by a screen reader, or by the browser tests.
 */
function named(node, title) {
  node.setAttribute("data-field", title);
  node.setAttribute("aria-label", title);
  return node;
}

export function mkField(hint, initial = "", multi = false, extra = "") {
  const e = document.createElement(multi || extra === "search" ? "textarea" : "input");
  e.className = "field" + (extra ? " " + extra : "");
  e.placeholder = hint;
  e.value = initial;
  if (!multi && extra !== "search") e.type = "text";
  if (multi) e.rows = 2;
  e.autocomplete = extra === "search" ? "off" : "name";
  e.spellcheck = false;
  return e;
}

/**
 * Keeps a box to figures.
 *
 * Letters, spaces and symbols are dropped while they are typed, rather than
 * being allowed in and then refused at save time, which is the part that
 * confuses people. type="number" is not used on purpose: it throws away leading
 * zeros, fights with the right-aligned money styling and scrolls the value
 * sideways on a phone.
 */
export function onlyNumbers(input, { whole = false } = {}) {
  const clean = (raw) => {
    let out = String(raw).replace(whole ? /[^0-9]/g : /[^0-9.]/g, "");
    if (!whole) {
      // one dot only, and it has to be followed by figures
      const i = out.indexOf(".");
      if (i >= 0) {
        out = out.slice(0, i + 1) + out.slice(i + 1).replace(/\./g, "");
        if (out === "." || out.endsWith(".")) out = out.slice(0, -1);
      }
    }
    return out;
  };
  const tidy = () => {
    if (clean(input.value) === input.value) return;
    const at = input.selectionStart ?? input.value.length;
    const head = clean(input.value.slice(0, at));
    // every dot that was dropped above the caret shifts it one place left
    const shift = head.length - at + (input.value.slice(0, at).match(/\./g) || []).length;
    const next = clean(input.value);
    input.value = next;
    const pos = Math.max(0, Math.min(next.length, shift));
    try {
      input.setSelectionRange(pos, pos);
    } catch {
      // some input types do not allow a caret to be set; harmless
    }
  };
  input.addEventListener("input", tidy);
  // and a paste of "12,000" or "50/-" lands as "12000" / "50"
  input.addEventListener("paste", () => setTimeout(tidy, 0));
  return input;
}

export function mkMoneyField(hint = "0", size = 22) {
  const e = mkField(hint);
  e.classList.add("money");
  e.type = "text";
  e.inputMode = "decimal";
  e.style.fontSize = `${size}px`;
  e.style.textAlign = "right";
  // keeps the cursor at the end as the amount is typed
  e.addEventListener("click", () => e.setSelectionRange(e.value.length, e.value.length));
  onlyNumbers(e);
  return e;
}

// ---------------- the sheet / dialog plumbing ----------------

/**
 * True while a dialog is up, so the app knows to hold off redrawing a page
 * underneath one.
 */
export const Dialogs = {
  get open() {
    return !!document.querySelector(".modal-root .sheet");
  },
};

/**
 * Opens a bottom sheet on a phone. Same shape as a MaterialAlertDialog on
 * Android and a .sheet on iOS: a scrim, a handle, a title, a body.
 *
 * `build` gets { add, body, sheet, close } so a dialog can be written in the
 * same style as a page.
 */
/**
 * The element every popup lives in. It starts hidden so the page is not covered
 * by an empty scrim, and is shown only while something is open.
 */
function modalHost() {
  const host = document.getElementById("modal");
  if (!host) return document.body;
  return host;
}

export function openSheet(title, build) {
  const host = modalHost();
  // the host carries the scrim, so the sheet itself does not need another one
  const root = host;
  const sheet = el("div", "sheet");
  sheet.appendChild(el("div", "sheet-handle"));

  const head = el("div", "sheet-head");
  head.appendChild(el("h2", null, title));
  const x = el("button", "icon-btn sheet-x", "✕");
  x.type = "button";
  x.setAttribute("aria-label", "Close");
  head.appendChild(x);
  sheet.appendChild(head);

  const body = el("div", "sheet-body");
  sheet.appendChild(body);
  root.appendChild(sheet);
  // shown only now that there is something to show
  host.hidden = false;
  host.classList.add("on");
  host.style.animation = "";
  if (getComputedStyle(host).display === "none") host.style.display = "flex";

  const close = () => {
    if (root.dataset.closing === "1") return;
    root.dataset.closing = "1";
    sheet.style.animation = "sheetOut 0.18s ease-in forwards";
    setTimeout(() => {
      sheet.remove();
      // the scrim only stays while another sheet is still open
      if (!root.querySelector(".sheet")) {
        root.classList.remove("on");
        root.hidden = true;
        root.style.display = "";
        root.style.animation = "";
      }
      delete root.dataset.closing;
    }, 180);
    document.removeEventListener("keydown", onKey);
    root.removeEventListener("click", onScrim);
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  const onScrim = (e) => {
    if (e.target === root) close();
  };
  root.addEventListener("click", onScrim);
  x.addEventListener("click", close);
  document.addEventListener("keydown", onKey);

  build({
    add: (v, top = 0) => {
      if (top) v.style.marginTop = `${top}px`;
      body.appendChild(v);
      return v;
    },
    body,
    sheet,
    close,
  });
  // the body can be long, so start it scrolled to the top
  body.scrollTop = 0;
  return sheet;
}

/** Closes the topmost sheet, if one is open. */
export function closeSheet() {
  const sheets = document.querySelectorAll("#modal .sheet");
  const top = sheets[sheets.length - 1];
  if (!top) return false;
  top.querySelector(".sheet-x")?.click();
  return true;
}

/** True while any sheet is open. */
export function sheetOpen() {
  return !!document.querySelector("#modal .sheet");
}

/** A row of buttons pinned to the bottom of a sheet. */
function sheetFoot(...views) {
  const foot = el("div", "sheet-foot");
  for (const v of views) foot.appendChild(v);
  return foot;
}

function btn(text, cls, onClick) {
  const b = el("button", "btn " + cls, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

/**
 * Opens a titled popup whose Save button validates first: onSave returns a
 * message to stay open and complain, or null to close.
 */
export function formDialog(title, form, onSave) {
  return openSheet(title, (s) => {
    s.add(form.root);
    const save = btn("Save", "primary", () => {
      const err = onSave(form);
      if (err == null) closeSheet();
      else {
        Anim.shake(save);
        toast(err);
      }
    });
    const cancel = btn("Cancel", "ghost", closeSheet);
    // the foot sits outside the scrolling body so Save is always reachable
    s.sheet.appendChild(sheetFoot(cancel, save));
  });
}

export function confirmDelete(what, onYes) {
  const sheet = openSheet(`Delete ${what}?`, (s) => {
    s.add(el("div", "sub", "This cannot be undone."));
    s.sheet.appendChild(
      sheetFoot(btn("Cancel", "ghost", closeSheet), btn("Delete", "danger", () => {
        closeSheet();
        onYes();
      }))
    );
  });
  return sheet;
}

export function ask(title, message, { okLabel = "OK", danger = false, onOk = null } = {}) {
  return openSheet(title, (s) => {
    s.add(el("div", "sub", message));
    s.sheet.appendChild(
      sheetFoot(
        btn("Cancel", "ghost", closeSheet),
        btn(okLabel, danger ? "danger" : "primary", () => {
          closeSheet();
          onOk?.();
        })
      )
    );
  });
}

/**
 * A question with a fixed set of answers, each of which does something different.
 * Used where a plain yes/no would be wrong, like "only this month, or always?".
 * `options` is [{ label, desc, onPick }].
 */
export function choose(title, message, options) {
  return openSheet(title, (s) => {
    if (message) s.add(el("div", "sub", message));
    const card = el("div", "card");
    card.style.padding = "8px 0";
    options.forEach((o, i) => {
      if (i > 0) card.appendChild(divider());
      const row = el("button", "lrow tappable");
      row.type = "button";
      const mid = el("div", "mid");
      mid.appendChild(el("div", "t", o.label));
      if (o.desc) mid.appendChild(el("div", "d", o.desc));
      row.appendChild(mid);
      const chev = el("div", "amt", "›");
      chev.style.color = tone("muted");
      row.appendChild(chev);
      row.addEventListener("click", () => {
        closeSheet();
        o.onPick?.();
      });
      card.appendChild(row);
    });
    s.add(card);
    s.sheet.appendChild(sheetFoot(btn("Cancel", "ghost", closeSheet)));
  });
}

/** The hairline between two rows in a list card. */
function divider() {
  const d = el("div");
  d.style.cssText = "height:1px;background:var(--line);margin:0 16px";
  return d;
}

let toastTimer = null;

/** The short message at the bottom, the same job as Toast on Android. */
export function toast(msg, { good = false } = {}) {
  const host = document.getElementById("toasts") || document.body;
  document.getElementById("toast")?.remove();
  const t = el("div", "toast");
  t.id = "toast";
  if (good) {
    // a save that worked earns a tick that pops in, so good news is visible
    // without reading it
    const tick = el("span", "toast-tick", "\u2713");
    t.appendChild(tick);
    Anim.popCheck(tick);
    t.appendChild(el("span", null, msg));
  } else {
    t.textContent = msg;
  }
  host.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.style.opacity = "0";
    t.style.transition = "opacity .25s";
    setTimeout(() => t.remove(), 250);
  }, 2400);
}
