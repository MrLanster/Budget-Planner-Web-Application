// Budget Planner - the widget kit.
// Mirrors app/src/main/java/com/budgetplanner/ui/Kit.kt.
//
// Every page builds itself by calling these on a Screen, exactly as the Kotlin
// fragments do. The method names are the same on purpose: s.card { }, s.row(),
// s.chips(), s.kpi(), s.button() all mean what they mean in the app, so a change
// here is easy to copy across.
//
// One difference from Android: a colour is passed as its name ("ok", "muted",
// "brand") rather than a R.color id, because those names are already the CSS
// custom properties in app.css. tone("ok") -> "var(--ok)".

import { Fmt } from "../util/Fmt.js";
import { Anim } from "./Anim.js";

/** "ok" -> "var(--ok)". Unknown names fall back to the ink colour. */
export function tone(name) {
  return name ? `var(--${name})` : "var(--ink)";
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export const h = (tag, cls, text) => el(tag, cls, text);

/**
 * The page body builder. One of these is created per page render.
 */
export class Screen {
  constructor() {
    this.root = el("div", "page");
  }

  add(v) {
    this.root.appendChild(v);
    return v;
  }

  /** Finds something in the page being built, so a page can reach its own bits. */
  querySelector(sel) {
    return this.root.querySelector(sel);
  }

  /** Detaches a node the page already owns, so it can be moved into a card. */
  adopt(v) {
    v?.remove();
    return v;
  }

  spacer(hPx = 8) {
    const s = el("div", "vspacer");
    if (hPx !== 8) s.style.height = `${hPx}px`;
    return this.add(s);
  }

  section(title) {
    return this.add(el("div", "section", title));
  }

  // ---------------- cards ----------------

  card(build) {
    return this.add(this._card(false, build));
  }

  heroCard(build) {
    return this.add(this._card(true, build));
  }

  _card(hero, build) {
    const card = el("div", hero ? "card hero" : "card");
    build(new CardScope(card));
    return card;
  }

  listCard(build) {
    const card = el("div", "card");
    card.style.padding = "0";
    // the same builders the page has, so a row inside a list looks like a row
    // built anywhere else
    build({
      card,
      add: (v) => {
        card.appendChild(v);
        return v;
      },
      row: (o) => rowFor(o),
      divider: () => {
        const d = el("div", "divider");
        card.appendChild(d);
        return d;
      },
    });
    return this.add(card);
  }

  // ---------------- text ----------------

  label(text, size = 13, color = "ink", bold = false) {
    const n = el("div", "label" + (bold ? " bold" : ""), text);
    n.style.fontSize = `${size}px`;
    if (color !== "ink") n.style.color = tone(color);
    return n;
  }

  big(text, size = 30, color = "ink") {
    const n = el("div", "big", text);
    n.style.fontSize = `${size}px`;
    n.style.color = tone(color);
    return n;
  }

  sub(text, size = 12, color = "muted") {
    const n = el("div", "sub", text);
    n.style.fontSize = `${size}px`;
    if (color !== "muted") n.style.color = tone(color);
    return n;
  }

  hstack(align = "center") {
    const n = el("div", "row-h");
    n.style.alignItems = align;
    return n;
  }

  vstack() {
    return el("div", "stack");
  }

  // ---------------- kpi tile ----------------

  kpi(k, v, hint = "", valueColor = "ink", onClick = null) {
    const card = el(onClick ? "button" : "div", "kpi");
    if (onClick) {
      card.setAttribute("role", "button");
      card.addEventListener("click", () => {
        Anim.dip(card);
        onClick();
      });
    }
    card.appendChild(el("div", "k", k));
    const value = el("div", "v", v);
    value.style.color = tone(valueColor);
    card.appendChild(value);
    if (hint) card.appendChild(el("div", "hint", hint));
    // the caller animates this when it wants a count-up
    card.valueEl = value;
    return this.add(card);
  }

  // ---------------- rows ----------------

  /** A list row: optional avatar, a title and subtitle, and a right-hand amount. */
  row(o = {}) {
    return rowFor(o);
  }

  divider(container) {
    const d = el("div", "divider");
    if (container) container.appendChild(d);
    return d;
  }

  pill(text, pillTone = "soft", textColor = "brand") {
    const n = el("span", "pill", text);
    n.style.background = tone(pillTone);
    n.style.color = tone(textColor);
    return n;
  }

  // ---------------- chips ----------------

  /**
   * A scrollable row of chips. `items` is a list of [key, label] pairs, the same
   * shape as the Kotlin version, so the call sites read identically.
   */
  chips(items, selected, onSelect) {
    const scroll = el("div", "chipscroll");
    for (const [key, text] of items) {
      const chip = el("button", "chip" + (key === selected ? " on" : ""), text);
      chip.type = "button";
      chip.addEventListener("click", (ev) => {
        Anim.press(chip, ev);
        // move the highlight on the chips themselves first, so the tap reads
        // as answered straight away even if the page takes a moment to redraw
        for (const other of scroll.children) other.classList.remove("on");
        chip.classList.add("on");
        onSelect(key);
      });
      scroll.appendChild(chip);
    }
    return this.add(scroll);
  }

  // ---------------- buttons ----------------

  /** Builds a button, adds it to the page, and returns it. */
  button(text, { primary = false, danger = false, ghost = false, onClick } = {}) {
    const b = this.buildButton(text, { primary, danger, ghost, onClick });
    return this.add(b);
  }

  /** Builds a button without attaching it to a parent. */
  buildButton(text, { primary = false, danger = false, ghost = false, onClick } = {}) {
    const b = el("button", "btn" + (primary ? " primary" : "") + (danger ? " danger" : "") + (ghost ? " ghost" : ""), text);
    b.type = "button";
    if (onClick) {
      b.addEventListener("click", (ev) => {
        Anim.press(b, ev);
        onClick();
      });
    }
    return b;
  }

  /** Lays several buttons out side by side. */
  buttonRow(...views) {
    const row = el("div", "btn-row");
    for (const v of views) {
      v.style.flex = "1";
      v.style.width = "auto";
      v.style.margin = "0";
      v.style.display = "flex";
      v.style.alignItems = "center";
      v.style.justifyContent = "center";
      row.appendChild(v);
    }
    return this.add(row);
  }

  /** A labelled row with a small "Change" button on the right. */
  tapRow(title, value, actionLabel, onClick) {
    const row = el("div", "taprow");
    const col = el("div", "stack");
    col.appendChild(this.label(title, 14.5));
    col.appendChild(this.sub(value, 12));
    row.appendChild(col);
    const b = this.buildButton(actionLabel, { ghost: true, onClick });
    b.classList.add("sm");
    b.style.flex = "0 0 92px";
    b.style.textAlign = "center";
    row.appendChild(b);
    return row;
  }

  // ---------------- misc ----------------

  note(text) {
    return this.add(el("div", "note", text));
  }

  empty(title, message, actionText = null, onAction = null) {
    const box = el("div", "empty");
    box.appendChild(el("h3", null, title));
    box.appendChild(el("p", null, message));
    if (actionText && onAction) {
      box.appendChild(this.buildButton(actionText, { primary: true, onClick: onAction }));
    }
    return this.add(box);
  }

  // ---------------- bars ----------------

  bar(fraction, { danger = false, marker = -1, ok = false } = {}) {
    const b = el("div", "bar" + (danger ? " bad" : ok ? " ok" : ""));
    const fill = el("div", "fill");
    fill.style.width = "0%";
    b.appendChild(fill);
    if (marker >= 0) {
      const m = el("div", "marker");
      m.style.left = `${Math.min(100, marker * 100)}%`;
      b.appendChild(m);
    }
    b.set = (f, animate = true) => {
      const pct = Math.max(0, Math.min(1, f || 0)) * 100;
      if (animate) requestAnimationFrame(() => (fill.style.width = `${pct}%`));
      else fill.style.width = `${pct}%`;
    };
    b.set(fraction, true);
    b.style.height = "10px";
    return b;
  }

  heroBar(fraction) {
    return this.bar(fraction);
  }

  // ---------------- the daily pace card ----------------

  /**
   * "How much can I spend each day for the rest of this month" - the number the
   * user actually wants on screen, so it gets its own card.
   */
  dailyCard(v, animated = true) {
    const card = this.card((c) => {
      const head = c.hstack();
      const k = c.label("DAILY SPENDABLE", 10.5, "muted", true);
      k.style.flex = "1";
      head.appendChild(k);
      head.appendChild(c.pill(v.isPast ? "month finished" : `${v.daysLeft} day${v.daysLeft === 1 ? "" : "s"} left`));
      c.add(head);

      const toneName = v.isOver ? "bad" : v.daily <= 0 ? "muted" : v.usedFraction >= 0.9 ? "warn" : "ok";
      const num = c.big("", 34, toneName);
      c.add(num);
      c.add(
        c.sub(
          v.isOver
            ? "per day · you are over the limit"
            : v.daysLeft === 0
            ? "per day · this month is finished"
            : v.daysLeft === 1
            ? "per day for today"
            : `per day for the next ${v.daysLeft} days`,
          12
        )
      );

      const b = c.bar(v.usedFraction, { danger: v.isOver, marker: v.limit > 0 ? 0.8 : -1 });
      b.style.marginTop = "12px";
      b.style.height = "8px";
      c.add(b);

      const foot = c.hstack();
      const left = c.sub(v.isOver ? `Over by ${Fmt.money(-v.inHand)}` : `${Fmt.money(v.inHand)} in hand`, 12, v.isOver ? "bad" : "muted");
      left.style.flex = "1";
      foot.appendChild(left);
      if (!v.isPast) foot.appendChild(c.sub(`day ${Fmt.dayOfMonth()} of ${v.daysTotal}`, 12));
      foot.style.marginTop = "10px";
      c.add(foot);

      if (animated) Anim.countUp(num, 0, v.daily, 850, Fmt.money);
      else num.textContent = Fmt.money(v.daily);
    });
    if (v.isOver) Anim.pulse(card, 1.02);
    return card;
  }
}

/**
 * The receiver inside a card builder. It exposes the card itself as `add` and
 * forwards everything else to the Screen, so `s.card { add(x) }` and
 * `s.add(x)` read the same way.
 */
export class CardScope {
  constructor(card) {
    this.card = card;
  }

  add(v) {
    this.card.appendChild(v);
    return v;
  }

  divider() {
    this.card.appendChild(el("div", "divider"));
    return this;
  }

  spacer(hPx = 8) {
    const s = el("div", "vspacer");
    if (hPx !== 8) s.style.height = `${hPx}px`;
    this.card.appendChild(s);
    return this;
  }

  hstack(align = "center") {
    const n = el("div", "row-h");
    n.style.alignItems = align;
    return n;
  }

  vstack() {
    return el("div", "stack");
  }

  label(text, size = 13, color = "ink", bold = false) {
    const n = el("div", "label" + (bold ? " bold" : ""), text);
    n.style.fontSize = `${size}px`;
    if (color !== "ink") n.style.color = tone(color);
    return n;
  }

  big(text, size = 30, color = "ink") {
    const n = el("div", "big", text);
    n.style.fontSize = `${size}px`;
    n.style.color = tone(color);
    return n;
  }

  sub(text, size = 12, color = "muted") {
    const n = el("div", "sub", text);
    n.style.fontSize = `${size}px`;
    if (color !== "muted") n.style.color = tone(color);
    return n;
  }

  pill(text, pillTone = "soft", textColor = "brand") {
    const n = el("span", "pill", text);
    n.style.background = tone(pillTone);
    n.style.color = tone(textColor);
    return n;
  }

  /** Adds the note to this card, not to the page behind it. */
  note(text) {
    const n = el("div", "note", text);
    this.card.appendChild(n);
    return n;
  }

  bar(fraction, opts) {
    const b = new Screen().bar(fraction, opts);
    this.card.appendChild(b);
    return b;
  }

  /** Builds a button without adding it anywhere. */
  button(text, opts) {
    return new Screen().buildButton(text, opts);
  }
}

// ---------------- shared row builder ----------------

/**
 * The one list row, built outside a Screen as well as inside one, so a row in a
 * list card is identical to a row built on the page.
 *
 * avatar / title / subtitle / amount / amountColor / avatarTone /
 * avatarTextColor / onClick
 */
export function rowFor({
  avatar = null,
  title,
  subtitle = "",
  amount = "",
  amountColor = "ink",
  avatarTone = "soft",
  avatarTextColor = "brand",
  onClick = null,
  trailing = null,
} = {}) {
  // a row that carries its own button cannot itself be a button - two controls
  // inside one control is invalid, and taps on the inner one stop reaching the
  // row on some browsers. The row is a div that behaves like a button instead.
  const hasOwnButton = !!trailing && trailing.tagName === "BUTTON";
  const tappable = !!onClick;
  const outer = el(tappable && !hasOwnButton ? "button" : "div", "lrow" + (tappable ? " tappable" : ""));
  if (tappable) {
    if (outer.tagName === "BUTTON") outer.type = "button";
    else {
      outer.setAttribute("role", "button");
      outer.tabIndex = 0;
      outer.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          Anim.press(outer, null);
          onClick();
        }
      });
    }
    outer.addEventListener("click", (e) => {
      // let the row's own button handle its own tap
      if (hasOwnButton && e.target.closest("button")) return;
      Anim.press(outer, e);
      onClick();
    });
  }
  if (avatar != null) {
    const av = el("div", "av", avatar);
    av.style.background = tone(avatarTone);
    av.style.color = tone(avatarTextColor);
    outer.appendChild(av);
  }
  const mid = el("div", "mid");
  mid.appendChild(el("div", "t", title));
  if (subtitle) mid.appendChild(el("div", "s", subtitle));
  outer.appendChild(mid);
  if (amount) {
    const a = el("div", "amt", amount);
    a.style.color = tone(amountColor);
    outer.appendChild(a);
  }
  if (trailing) outer.appendChild(trailing);
  return outer;
}

/**
 * The small cross on a row that removes it.
 *
 * It is on the row rather than hidden inside the detail sheet on purpose: a
 * mistake should cost one tap, not a tap, a scroll and a hunt for the button.
 * Deleting still asks first, because the whole point is undoing an accident.
 */
export function deleteButton(onClick, label = "Delete") {
  const b = el("button", "rowx", "✕");
  b.type = "button";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.addEventListener("click", (e) => {
    // the row itself is a button too, and must not open the detail sheet
    e.stopPropagation();
    e.preventDefault();
    Anim.tapFeedback(b);
    onClick();
  });
  return b;
}

/** A 1px rule between rows in a list. */
export function dividerNode() {
  return el("div", "divider");
}

/** A small vertical gap, for spacing stacked kpi tiles. */
export function gap(px = 8) {
  const g = el("div");
  g.style.height = `${px}px`;
  return g;
}

/**
 * A tick row built on its own, for settings that live on a card rather than in
 * a form. Reads its state back from row.formState, the same as Form.toggle.
 */
export function toggleRow(title, desc = "", on = false, onChange = null) {
  const row = el("div", "toggle" + (on ? " on" : ""));
  const col = el("div", "stack");
  col.style.flex = "1";
  col.appendChild(el("div", "t", title));
  if (desc) col.appendChild(el("div", "d", desc));
  row.appendChild(col);
  const tick = el("div", "tick", on ? "\u2713" : "");
  row.appendChild(tick);
  row.formState = { value: !!on };
  row.addEventListener("click", () => {
    row.formState.value = !row.formState.value;
    Anim.tapFeedback(row);
    tick.textContent = row.formState.value ? "\u2713" : "";
    row.classList.toggle("on", row.formState.value);
    onChange?.(row.formState.value);
  });
  return row;
}
