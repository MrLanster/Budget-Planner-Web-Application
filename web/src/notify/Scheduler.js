// Budget Planner - the browser's stand-in for AlarmManager.
//
// Android arms one-shot alarms that re-arm themselves; iOS books monthly
// calendar triggers. A web page can do neither: it is closed most of the day and
// browsers throttle background timers, so a repeating alarm is not reliable.
//
// So the web runs the same checks on a timer while the page is open, plus once
// on every load, and posts through the Notification API when the tab has been
// granted permission. Same messages, same conditions, same once-a-day guards -
// only the delivery differs. That is why the message text all lives in
// Notifier.js and nothing here decides what to say.

import { Notifier } from "./Notifier.js";
import { Prefs } from "./Prefs.js";
import { Repo } from "../data/Repo.js";
import { Fmt } from "../util/Fmt.js";

const TICK_MS = 60_000;      // how often the open page re-checks
const DAILY_MS = 15 * 60_000; // fall back to this if the tab has been idle

let timer = null;
let lastRun = 0;
let onOpenPage = () => {};

export const Scheduler = {
  /**
   * Starts checking. `openPage` is the page id a notification should jump to,
   * which is what the native builds put in the intent extra.
   */
  start(openPage) {
    if (openPage) onOpenPage = openPage;
    if (timer) return;
    this.run();
    timer = setInterval(() => {
      // skip the cheap tick when the page has only just been checked
      if (Date.now() - lastRun < DAILY_MS) return;
      this.run();
    }, TICK_MS);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) this.run();
    });
  },

  stop() {
    clearInterval(timer);
    timer = null;
  },

  /** One pass of every check. Safe to call at any time. */
  run() {
    lastRun = Date.now();
    // whatever was left unspent in a finished month goes into savings
    Repo.closeFinishedMonths();
    this.checkSalary();
    this.checkPayablesMidMonth();
    this.checkLowBudget();
    this.checkCommonPayments();
    this.checkBillsWeekly();
    this.checkBills();
    this.checkPending();
  },

  /**
   * Payday. The salary is only a limit, so this asks the user to confirm it
   * landed rather than adding anything. Once a day, and it stays askable until
   * it is answered.
   */
  checkSalary() {
    if (!Notifier.salaryIsDue()) return;
    if (Prefs.lastSalaryAlert() === Fmt.today()) return;
    Prefs.setLastSalaryAlert(Fmt.today());
    const r = Notifier.salaryText();
    post("monthly-reminders", r.title, r.body, "home");
  },

  /**
   * The mid-month half of the twice-a-month "what you owe" reminder. The other
   * half goes out the moment the salary is confirmed.
   *
   * It waits until the 15th so it cannot fire in the same few days as the
   * payday one, and it only speaks when the month has actually started, since
   * there is no point listing repayments for a month nobody has begun.
   */
  checkPayablesMidMonth() {
    const m = Fmt.thisMonth();
    if (!Repo.isMonthStarted(m)) return;
    if (Fmt.dayOfMonth() < 15) return;
    if (Prefs.payableMidMonth() === m) return;
    const r = Notifier.payablesText();
    if (!r) {
      // nothing owed: mark it, so it does not keep re-checking
      Prefs.setPayableMidMonth(m);
      return;
    }
    Prefs.setPayableMidMonth(m);
    post("money-people", r.title, r.body, "people");
  },

  /**
   * The payday half of the same reminder, fired from the salary confirmation
   * rather than from a timer, because the user is right there at that moment.
   */
  checkPayablesOnSalary(m) {
    if (Prefs.payableOnSalaryMonth() === m) return;
    const r = Notifier.payablesText();
    Prefs.setPayableOnSalaryMonth(m);
    if (!r) return;
    post("money-people", r.title, r.body, "people");
  },

  /**
   * The weekly bill check. Once a week, not once a day: the point is to notice
   * the month going by with rent or electricity still unpaid, and repeating that
   * every morning is how a reminder gets turned off.
   */
  checkBillsWeekly() {
    if (!Prefs.billWeeklyOn()) return;
    const last = Prefs.lastBillWeekly();
    if (last && Fmt.daysBetween(last, Fmt.today()) < 7) return;
    const r = Notifier.unpaidBillsText();
    if (!r) {
      // all paid: stamp it, so it does not keep re-checking
      Prefs.setLastBillWeekly(Fmt.today());
      return;
    }
    Prefs.setLastBillWeekly(Fmt.today());
    post("monthly-reminders", r.title, r.body, "bills");
  },

  checkLowBudget() {
    const r = Notifier.lowBudgetText();
    if (!r) return;
    if (Prefs.lastLowAlert() === Fmt.today()) return;
    Prefs.setLastLowAlert(Fmt.today());
    post("budget-alerts", r.title, r.body, "home");
  },

  /**
   * The early-month common payments nudge. Guarded once a day so it does not
   * repeat every time the page re-checks.
   */
  checkCommonPayments() {
    const r = Notifier.commonPaymentsText();
    if (!r) return;
    const stamp = Fmt.today();
    if (Prefs.lastCommonAlert() === stamp) return;
    Prefs.setLastCommonAlert(stamp);
    post("monthly-reminders", r.title, r.body, "bills");
  },

  checkBills() {
    const m = Fmt.thisMonth();
    const day = Fmt.dayOfMonth();
    const overdue = Repo.activeBills().filter((b) => b.isOverdue(m, day));
    if (overdue.length === 0) return;
    const names = overdue.map((b) => (b.amount > 0 ? `${b.name} (${Fmt.money(b.amount)})` : b.name));
    post(
      "monthly-reminders",
      `${overdue.length} bill${overdue.length === 1 ? "" : "s"} not paid yet`,
      `Still to pay this month: ${names.join(", ")}.`,
      "bills"
    );
  },

  checkPending() {
    if (!Prefs.pendingOn()) return;
    const r = Notifier.pendingText();
    if (!r) return;
    post("money-people", r.title, r.body, "people");
  },

  /** Fired the moment a new expense pushes the month into the danger zone. */
  checkLowBudgetNow(added) {
    const m = Fmt.monthKey(added.date);
    if (!Repo.isMonthStarted(m)) return;
    const cfg = Repo.monthCfg(m);
    const spendable = cfg.salary - cfg.savings;
    if (spendable <= 0) return;
    const left = spendable - Repo.monthSum(m).personal;
    const th = Prefs.threshold();
    const fires = left < 0 ? th <= 1.0 : (spendable - left) / spendable >= th;
    if (!fires) return;
    if (Prefs.lastLowAlert() === Fmt.today()) return;
    Prefs.setLastLowAlert(Fmt.today());
    const r = Notifier.lowBudgetText();
    if (r) post("budget-alerts", r.title, r.body, "home");
  },
};

/** Posts a notification if the browser has been allowed to. */
export function post(channel, title, body, open) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, {
      body,
      tag: `bp-${channel}-${open || ""}`,
      icon: ICON,
      requireInteraction: false,
    });
    n.onclick = () => {
      window.focus();
      onOpenPage(open);
      n.close();
    };
  } catch (e) {
    console.debug("Notification skipped", e);
  }
}

/** Asks for permission, resolving to whether it was granted. */
export async function askPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

// A tiny inline mark so the notification has an icon without another file.
const ICON =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#4F46E5"/><text x="32" y="43" font-family="sans-serif" font-size="34" font-weight="bold" fill="#fff" text-anchor="middle">₹</text></svg>`
  );
