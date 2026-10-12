// Budget Planner - the message behind each reminder.
// Mirrors app/src/main/java/com/budgetplanner/notify/Notifier.kt.
//
// Every function here returns { title, body } or null when there is nothing
// worth saying, so the same text can be reused by the Android notifications, the
// iOS notifications and the web ones without being rewritten.

import { Repo } from "../data/Repo.js";
import { Fmt } from "../util/Fmt.js";
import { Prefs } from "./Prefs.js";

const month = () => Fmt.thisMonth();

export const Channels = {
  ALERT: "budget_alerts",     // low budget / overspent
  MONTH: "monthly_reminders", // payday, month end
  PEOPLE: "money_people",     // pending money
};

export const Notifier = {
  /**
   * Payday. The salary is a limit, not money in the account, so this asks the
   * question rather than telling the user to add anything: confirming is what
   * gives the month its spending allowance.
   */
  salaryText() {
    const m = Repo.monthAwaitingSalary();
    const cfg = Repo.monthCfg(m);
    const cut = Repo.salaryCutFor(m);
    const bits = [`Confirm it to set up ${Fmt.monthLabel(m)}`];
    if (cut > 0) {
      bits.push(`${Fmt.money(cfg.salary)} after ${Fmt.money(cut)} lost to leave.`);
    } else {
      bits.push(`Limit ${Fmt.money(cfg.salary)}, ${Fmt.money(Math.max(0, cfg.salary - cfg.savings))} to spend.`);
    }
    return { title: "Did your salary land?", body: bits.join(" ") };
  },

  /**
   * Whether payday has arrived for the month waiting on a salary.
   *
   * This compares against the real expected date rather than a day of the month,
   * so a payday that was pushed to a later date waits until that date, and the
   * question stays available until it is answered.
   */
  salaryIsDue() {
    if (!Prefs.salaryOn()) return false;
    const due = Repo.nextSalaryQuestionOn();
    if (!due) return false;
    return Fmt.today() >= due;
  },

  monthEndText(carriedOver = 0) {
    const m = month();
    const cfg = Repo.monthCfg(m);
    const s = Repo.monthSum(m);
    const spendable = Math.max(0, cfg.salary - cfg.savings);
    const bits = [`Spent ${Fmt.money(s.personal)}`];
    if (spendable > 0) {
      const left = spendable - s.personal;
      bits.push(left >= 0
        ? `of ${Fmt.money(spendable)} — ${Fmt.money(left)} left.`
        : `— over by ${Fmt.money(-left)}.`);
    }
    if (carriedOver > 0) bits.push(`${Fmt.money(carriedOver)} left over and added to your savings.`);
    bits.push(`Saved ${Fmt.money(s.saved)} of ${Fmt.money(cfg.savings)}.`);
    if (s.gaveOpen > 0) bits.push(`${Fmt.money(s.gaveOpen)} to get back.`);
    if (s.borrowedOpen > 0) bits.push(`${Fmt.money(s.borrowedOpen)} to return.`);
    return { title: `${Fmt.monthLabel(m)} summary`, body: bits.join(" ") };
  },

  lowBudgetText() {
    const m = month();
    // no allowance until the salary is confirmed, so there is nothing to warn about
    if (!Repo.isMonthStarted(m)) return null;
    const cfg = Repo.monthCfg(m);
    if (cfg.salary <= 0) return null;
    const spendable = Math.max(0, cfg.salary - cfg.savings);
    if (spendable <= 0) return null;
    const s = Repo.monthSum(m);
    const left = spendable - s.personal;
    const pct = s.personal / spendable;
    if (left < 0) {
      return {
        title: "Over your budget",
        body: `You are ${Fmt.money(-left)} over the ${Fmt.money(spendable)} limit for ${Fmt.monthLabel(m)}.`,
      };
    }
    if (pct >= Prefs.threshold()) {
      return {
        title: "Budget getting low",
        body: `Only ${Fmt.money(left)} left to spend this month (${Math.floor(pct * 100)}% used). Slow down or adjust what is left.`,
      };
    }
    return null;
  },

  pendingText() {
    const recv = Repo.openReceivable();
    const pay = Repo.openPayable();
    const room = Repo.roomNetTotal();
    if (recv <= 0 && pay <= 0 && room <= 0) return null;
    const bits = [];
    if (recv > 0) bits.push(`${Fmt.money(recv)} to get back`);
    if (room > 0) bits.push(`${Fmt.money(room)} from room`);
    if (pay > 0) bits.push(`${Fmt.money(pay)} to return`);
    return { title: "Money to settle", body: "Still open: " + bits.join(", ") + "." };
  },

  /**
   * Everything the user still has to hand back, named person by person.
   *
   * This is the message that goes out twice a month - once when the salary
   * lands and again in the middle of the month - because knowing the total is
   * not the same as remembering who is waiting. Returns null when nothing is
   * owed, so it is safe to ask for at any time.
   */
  payablesText() {
    const owed = Repo.peopleSums()
      .filter((p) => p.iOweThem > 0)
      .sort((a, b) => b.iOweThem - a.iOweThem)
      .map((p) => `${p.person.name} ${Fmt.money(p.iOweThem)}`);
    const room = Repo.roomAll()
      .map(Repo.rowToRoom)
      .reduce((a, b) => a + Repo.owedOn(b), 0);
    if (owed.length === 0 && room <= 0) return null;
    const total = Repo.openPayable() + Math.max(0, room);
    const lines = owed.slice(0, 4).join(" · ");
    const more = owed.length > 4 ? ` · and ${owed.length - 4} more` : "";
    return {
      title: `You have ${Fmt.money(total)} to give back`,
      body: `Pay back: ${lines}${more}${room > 0 ? ` · room ${Fmt.money(room)}` : ""}.`,
    };
  },

  /**
   * The early-month common payments nudge.
   *
   * Returns null outside the window, when everything in the window is already
   * paid, or when there are no common payments set up at all. That means the
   * scheduler can call it freely without ever showing an empty reminder.
   */
  /**
   * The weekly look at the bills that have not been marked paid this month.
   *
   * The names come from what the user has actually written: "rent, electricity
   * bill, wifi" in the note of a room entry teaches the app those three exist,
   * and from then on this list is what reminds them when one is missing.
   *
   * Returns null when there is nothing unpaid, so the scheduler can call it
   * freely without ever posting an empty reminder.
   */
  unpaidBillsText() {
    const m = month();
    const due = Repo.unpaidBills(m);
    if (due.length === 0) return null;
    const mLabel = Fmt.monthLabel(m);
    const names = due.map((b) => b.name);
    if (names.length === 1) {
      return {
        title: "One bill still to pay",
        body: `Your ${names[0]} is not marked paid for ${mLabel}. Add it when you pay it.`,
      };
    }
    return {
      title: `${names.length} bills still to pay`,
      body: `Not marked paid for ${mLabel}: ${names.join(", ")}.`,
    };
  },

  commonPaymentsText() {
    if (!Prefs.commonOn()) return null;
    const m = month();
    const until = Prefs.commonUntilDay();
    const day = Fmt.dayOfMonth();
    if (day > until) return null;

    const all = Repo.commonBills(m, until);
    if (all.length === 0) return null;

    const due = Repo.commonDue(m, day, until);
    if (due.length === 0) return null;

    const mLabel = Fmt.monthLabel(m);
    const withAmount = due.map((b) => (b.amount > 0 ? `${b.name} (${Fmt.money(b.amount)})` : b.name));
    const total = due.reduce((a, b) => a + b.amount, 0);

    // one item reads much better as a plain sentence
    if (due.length === 1) {
      const b = due[0];
      const amt = b.amount > 0 ? ` (${Fmt.money(b.amount)})` : "";
      const verb = day === b.dueDay ? "is due today" : day > b.dueDay ? "was due on day " + b.dueDay : "is due on day " + b.dueDay;
      return {
        title: `Common payment · ${b.name}`,
        body: `Your ${b.name}${amt} ${verb}. Tap to mark it paid for ${mLabel}.`,
      };
    }

    return {
      title: `${due.length} common payments to handle`,
      body: `Still to pay for ${mLabel}: ${withAmount.join(", ")}${total > 0 ? ` — ${Fmt.money(total)} in all` : ""}. Tap to mark them paid.`,
    };
  },
};
