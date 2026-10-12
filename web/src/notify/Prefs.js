// Budget Planner - reminder preferences.
// Mirrors the Prefs object at the bottom of
// app/src/main/java/com/budgetplanner/notify/Notifier.kt.
//
// The native apps keep these in SharedPreferences and UserDefaults. The browser
// only has localStorage, so the same keys live in the app's own key/value table
// with the "_" prefix, which keeps the names identical across all three.

import { Db } from "../data/Db.js";
import { Fmt } from "../util/Fmt.js";

const k = (name) => "_notif." + name;

const bool = (name, def) => Db.getKv(k(name), def ? "1" : "0") === "1";
const setBool = (name, v) => Db.setKv(k(name), v ? "1" : "0");
const int = (name, def) => {
  const v = parseInt(Db.getKv(k(name), String(def)), 10);
  return Number.isFinite(v) ? v : def;
};
const setInt = (name, v) => Db.setKv(k(name), String(v));

export const Prefs = {
  salaryOn: () => bool("salary_on", true),
  setSalaryOn: (v) => setBool("salary_on", v),

  /**
   * Which day the salary lands. 0 means the last day of the month, which is the
   * usual case and the default. Anything else is a fixed day, capped at 28 so
   * every month has that date.
   */
  salaryDay: () => {
    const v = int("salary_day", 0);
    return v === 0 ? 0 : Math.min(28, Math.max(1, v));
  },
  setSalaryDay: (v) => {
    const n = parseInt(v, 10);
    setInt("salary_day", !Number.isFinite(n) || n === 0 ? 0 : Math.min(28, Math.max(1, n)));
  },

  /** The real day number for a given month, resolving "the last day". */
  salaryDayIn(m = Fmt.thisMonth()) {
    return Prefs.salaryDay() === 0 ? Fmt.lastDayOf(m) : Prefs.salaryDay();
  },

  salaryDayLabel() {
    return Prefs.salaryDay() === 0
      ? "The last day of the month"
      : `Day ${Prefs.salaryDay()} of every month`;
  },

  monthEndOn: () => bool("monthend_on", true),
  setMonthEndOn: (v) => setBool("monthend_on", v),

  dailyOn: () => bool("daily_on", true),
  setDailyOn: (v) => setBool("daily_on", v),
  dailyTime: () => parseTime(Db.getKv(k("daily_time"), "20:00"), 20, 0),
  setDailyTime: (h, m) => Db.setKv(k("daily_time"), fmtTime(h, m)),

  pendingOn: () => bool("pending_on", true),
  setPendingOn: (v) => setBool("pending_on", v),

  threshold: () => Math.min(1, Math.max(0.1, parseFloat(Db.getKv(k("threshold"), "0.8")) || 0.8)),
  setThreshold: (v) => Db.setKv(k("threshold"), String(Math.min(1, Math.max(0.1, v)))),

  // ---------------- new: common payments in the first 10 days ----------------

  /** On by default: the early-month nudge is the whole point of the feature. */
  commonOn: () => bool("common_on", true),
  setCommonOn: (v) => setBool("common_on", v),

  /** The window closes on this day of the month. The user asked for the 10th. */
  commonUntilDay: () => Math.min(28, Math.max(1, int("common_until", 10))),
  setCommonUntilDay: (v) => setInt("common_until", Math.min(28, Math.max(1, v))),

  // ---------------- new: device unlock ----------------

  /** keeps the last low-budget alert to one per day */
  lastLowAlert: () => Db.getKv(k("last_low"), ""),
  setLastLowAlert: (v) => Db.setKv(k("last_low"), v),

  /** stops the common-payment nudge repeating on the same day */
  lastCommonAlert: () => Db.getKv(k("last_common"), ""),
  setLastCommonAlert: (v) => Db.setKv(k("last_common"), v),

  /** stops the payday question repeating on the same day */
  lastSalaryAlert: () => Db.getKv(k("last_salary"), ""),
  /**
   * Which month the "what you owe" list was last put in front of the user, for
   * each of its two moments: the day the salary lands, and the middle of the
   * month. Two stamps, because both have to fire and each only once.
   */
  payableOnSalaryMonth: () => Db.getKv(k("payable_on_salary"), ""),
  setPayableOnSalaryMonth: (m) => Db.setKv(k("payable_on_salary"), String(m || "")),
  payableMidMonth: () => Db.getKv(k("payable_mid"), ""),
  setPayableMidMonth: (m) => Db.setKv(k("payable_mid"), String(m || "")),
  setLastSalaryAlert: (v) => Db.setKv(k("last_salary"), v),
  /**
   * The weekly "you have not paid these yet" list. A stamp of the last day it
   * was shown keeps it to once a week instead of once a day, which is the
   * difference between a useful nudge and something the user switches off.
   */
  billWeeklyOn: () => Db.getKv(k("bill_weekly_on"), "1") !== "0",
  setBillWeeklyOn: (v) => Db.setKv(k("bill_weekly_on"), v ? "1" : "0"),
  lastBillWeekly: () => Db.getKv(k("bill_weekly_last"), ""),
  setLastBillWeekly: (v) => Db.setKv(k("bill_weekly_last"), String(v || "")),
};

function fmtTime(h, m) {
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseTime(s, dh, dm) {
  const p = String(s || "").split(":");
  const h = parseInt(p[0], 10);
  const m = parseInt(p[1], 10);
  return [Math.min(23, Number.isFinite(h) ? h : dh), Math.min(59, Number.isFinite(m) ? m : dm)];
}
