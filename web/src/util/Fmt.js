// Budget Planner - formatting and date helpers.
// Mirrors app/src/main/java/com/budgetplanner/util/Fmt.kt.

import { Repo } from "../data/Repo.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const int0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const dec2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const Fmt = {
  money(v) {
    const n = Number(v) || 0;
    const neg = n < 0;
    const a = Math.abs(n);
    const body = Number.isInteger(a) ? int0.format(a) : dec2.format(a);
    return (neg ? "-" : "") + Fmt.currency() + body;
  },

  moneyPlain(v) {
    return dec2.format(Number(v) || 0);
  },

  currency() {
    return Repo.currency();
  },

  uid() {
    // 18 chars, like the app. Not security sensitive, just a row key.
    return (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)).replace(/-/g, "").slice(0, 18);
  },

  // ---------- dates ----------

  today() {
    return toYmd(new Date());
  },

  monthKey(date) {
    return date && date.length >= 7 ? date.slice(0, 7) : date;
  },

  thisMonth() {
    return Fmt.monthKey(Fmt.today());
  },

  monthLabel(m) {
    const p = String(m || "").split("-");
    if (p.length < 2) return m;
    const i = (parseInt(p[1], 10) || 1) - 1;
    return `${MONTHS[i] ?? ""} ${p[0]}`;
  },

  dayLabel(date) {
    if (!date) return "";
    const today = Fmt.today();
    if (date === today) return "Today";
    if (date === Fmt.shiftDay(today, -1)) return "Yesterday";
    const p = date.split("-");
    const mi = (parseInt(p[1], 10) || 1) - 1;
    const base = `${p[2] ?? ""} ${MONTHS[mi] ?? ""}`;
    return p[0] !== today.slice(0, 4) ? `${base} ${p[0]}` : base;
  },

  daysInMonth(m) {
    const p = String(m).split("-");
    const y = parseInt(p[0], 10);
    const mo = parseInt(p[1], 10);
    if (!y || !mo) return 30;
    return new Date(y, mo, 0).getDate();
  },

  dayOfMonth() {
    return new Date().getDate();
  },

  /** "YYYY-MM-DD" of the last day of the month. */
  lastDayOf(m) {
    const p = String(m).split("-");
    return `${pad4(p[0])}-${pad2(p[1])}-${pad2(Fmt.daysInMonth(m))}`;
  },

  /**
   * "YYYY-MM-DD" for a day inside a month. A day past the end of a short month
   * is pulled back to that month's last day, so day 31 in February gives the 28th
   * or 29th instead of rolling into March.
   */
  dateOn(m, day) {
    const p = String(m).split("-");
    const last = Fmt.daysInMonth(m);
    const d = Math.min(Math.max(1, parseInt(day, 10) || 1), last);
    return `${pad4(p[0])}-${pad2(p[1])}-${pad2(d)}`;
  },

  /** True for a month that has already finished. "YYYY-MM" sorts correctly. */
  isPastMonth(m) {
    return m < Fmt.thisMonth();
  },

  /** Days still to use the budget, counting today. 0 for a finished month. */
  /**
   * Whole days from one YYYY-MM-DD to another, negative when the first is later.
   * Both are read at midday so a daylight-saving shift cannot shave a day off.
   */
  daysBetween(from, to) {
    if (!from || !to) return 0;
    const a = Date.parse(`${from}T12:00:00`);
    const b = Date.parse(`${to}T12:00:00`);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    return Math.round((b - a) / 86400000);
  },

  daysLeftIn(m) {
    if (Fmt.isPastMonth(m)) return 0;
    if (m > Fmt.thisMonth()) return 0;
    return Math.max(0, Fmt.daysInMonth(m) - Fmt.dayOfMonth() + 1);
  },

  shiftMonth(m, delta) {
    const p = String(m).split("-");
    const y = parseInt(p[0], 10);
    const mo = parseInt(p[1], 10);
    if (!y || !mo) return m;
    const d = new Date(y, mo - 1 + delta, 1);
    return `${pad4(d.getFullYear())}-${pad2(d.getMonth() + 1)}`;
  },

  // ---------- date ranges ----------

  /** "YYYY-MM-DD" of the given date shifted by whole days. */
  shiftDay(date, days) {
    const p = String(date).split("-");
    const d = new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1);
    d.setDate(d.getDate() + days);
    return toYmd(d);
  },

  /**
   * "YYYY-MM-DD" of the first day of a month.
   *
   * Takes either a month key or a full date, because a caller holding today's
   * date should not have to remember to shorten it first - and a mistake here
   * silently produces a range nothing can fall inside.
   */
  startOfMonth(m) {
    return `${String(m).slice(0, 7)}-01`;
  },

  endOfMonth(m) {
    return Fmt.lastDayOf(m);
  },

  /** "YYYY-MM-DD" of day 1 of the month n months back from this date. */
  startOfMonthsAgo(date, n) {
    return Fmt.startOfMonth(Fmt.shiftMonth(Fmt.monthKey(date), -n));
  },

  startOfYear(date) {
    return `${String(date).slice(0, 4)}-01-01`;
  },

  /** True when the date falls inside the range. Blank bounds mean "open". */
  inRange(date, from, to) {
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  },

  /**
   * The form a name is compared in.
   *
   * Every typed word - a person's name, a roommate, a category - is folded to
   * lower case with the spaces tidied up, so "Arun", " arun " and "ARUN" are one
   * person and "Rent", "rent" and "RENT " are one category. The user's own
   * spelling is kept wherever the name is shown; this is only for matching.
   */
  key(s) {
    return String(s ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  },

  /** True when two typed words mean the same thing, whatever their case. */
  same(a, b) {
    const x = Fmt.key(a);
    return !!x && x === Fmt.key(b);
  },

  /**
   * How a person's name is written anywhere the app shows it: every word
   * starting with a capital, the rest small. Typed once, then kept, so
   * "RAHUL", "rahul " and "Rahul" are all shown as "Rahul" - and stay one
   * person rather than three.
   */
  name(raw) {
    return String(raw ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[^\s]+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  },

  initials(name) {
    return String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0].toUpperCase())
      .join("") || "?";
  },
};

// ---------------- small local date helpers ----------------

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function pad4(n) {
  return String(n).padStart(4, "0");
}

export function toYmd(d) {
  return `${pad4(d.getFullYear())}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseYmd(date) {
  const p = String(date || "").split("-");
  return new Date(+p[0] || 1970, (+p[1] || 1) - 1, +p[2] || 1);
}
