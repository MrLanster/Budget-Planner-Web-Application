// Budget Planner - the payday conversation.
//
// The rule this file exists to enforce: a salary is a ceiling, not money. Typing
// one in never puts anything in the account and never creates an entry. A month
// only starts spending money when the user says the salary actually arrived.
//
// The conversation, in the order it is asked:
//   1. "Did your salary land?"
//        No, not today  -> pick the expected date in a calendar,
//                          then "only this month or always?"
//        Yes            -> "was any of it lost to unpaid leave?"
//                             Yes -> enter the reduced amount, this month only
//                             No  -> start the month
// A pushed date clears the "already asked" mark, so the reminder comes back on
// the new day instead of staying quiet until the usual one.
//
// It lives in its own file because Home, Profile and Balance all need the same
// questions and the same numbers.

import { Repo } from "../data/Repo.js";
import { Prefs } from "../notify/Prefs.js";
import { Scheduler } from "../notify/Scheduler.js";
import { Fmt } from "../util/Fmt.js";
import { amountOf, choose, Form, formDialog, toast } from "./Form.js";
import { h } from "./Kit.js";
import { monthView } from "./MonthView.js";

/**
 * The month whose salary is still to be confirmed, and what starting it would
 * mean. `waiting` is the one thing the UI needs: true only when the month is set
 * up but has not been given its salary yet.
 */
export function pendingSalary() {
  const m = Repo.monthAwaitingSalary();
  const view = monthView(m);
  return {
    month: m,
    view,
    cut: Repo.salaryCutFor(m),
    dueOn: Repo.salaryDueOn(m),
    pushed: Repo.isSalaryDuePushed(m),
    waiting: !view.isStarted && view.salary > 0,
  };
}

/**
 * The one entry point. Asks whether the salary landed, and takes it from there.
 */
export function askAboutSalary(ctx, m = null) {
  const month = m || Repo.monthAwaitingSalary();
  const cfg = Repo.monthCfg(month);
  const due = Repo.salaryDueOn(month);
  const late = Fmt.today() > due;

  choose(
    "Did your salary land?",
    `${Fmt.monthLabel(month)} · expected ${Fmt.dayLabel(due)}${
      late ? " · that date has passed" : ""
    }`,
    [
      {
        label: "Yes, it has landed",
        desc: `Start ${Fmt.monthLabel(month)} on ${Fmt.money(cfg.salary)}`,
        onPick: () => askAboutLeave(ctx, month),
      },
      {
        label: "Not today, it is coming later",
        desc: "Pick the date you expect it, and I will ask again then",
        onPick: () => pickNewPayday(ctx, month),
      },
      {
        label: "Nothing yet this month",
        desc: "I have not had a salary yet, so leave this month alone",
        onPick: () => {
          Prefs.setLastSalaryAlert("");
          toast("No problem, ask again on " + Fmt.dayLabel(due));
        },
      },
    ]
  );
}

/**
 * Leave without pay. Asked only after the user says the salary arrived, because
 * a cut is meaningless before the money exists. Always this month only: the
 * stored amount becomes that month's own salary, so nothing else is affected.
 */
function askAboutLeave(ctx, m) {
  const base = Repo.monthCfg(m).salary;
  const cut = Repo.salaryCutFor(m);
  choose(
    "Was any of it lost to leave?",
    cut > 0
      ? `${Fmt.money(cut)} is already off ${Fmt.monthLabel(m)} for unpaid leave.`
      : `If you took unpaid leave, ${Fmt.monthLabel(m)} runs on less than ${Fmt.money(base)}.`,
    [
      {
        label: "Yes, it was reduced",
        desc: "Enter the amount you are actually getting this month",
        onPick: () => enterLeaveCut(ctx, m, base),
      },
      {
        label: "No, full salary",
        desc: `${Fmt.money(base)} for ${Fmt.monthLabel(m)}`,
        onPick: () => {
          if (cut > 0) Repo.clearSalaryCutFor(m);
          startMonth(ctx, m, Repo.monthCfg(m).salary, Repo.monthCfg(m).savings);
        },
      },
    ]
  );
}

/** Asks for the salary actually received after leave, and starts the month. */
function enterLeaveCut(ctx, m, base) {
  const f = new Form();
  const got = f.moneyPlain("Salary you are getting this month", Fmt.moneyPlain(base));
  const sav = f.moneyPlain("Savings to set aside", Fmt.moneyPlain(Repo.monthCfg(m).savings));
  f.note(
    `Usually ${Fmt.money(base)}, so ${Fmt.money(Math.max(0, base))} is being lost to leave. ` +
      "This applies to this month only; your usual salary stays as it is."
  );
  formDialog(`Leave without pay · ${Fmt.monthLabel(m)}`, f, () => {
    const amount = amountOf(got);
    const keep = amountOf(sav);
    if (amount <= 0) return "Enter the salary you are getting";
    if (keep > amount) return "Savings cannot be more than your salary";
    const lost = Math.max(0, base - amount);
    Repo.setSalaryCutFor(m, lost, keep);
    startMonth(ctx, m, amount, keep);
    return null;
  });
}

/**
 * Pushes the payday. After a date is chosen the user has to say whether it is
 * for this month only or for good, because those are different changes: one
 * touches a single month, the other changes the recurring rule.
 */
function pickNewPayday(ctx, m) {
  const f = new Form();
  const current = Repo.salaryDueOn(m);
  const df = f.dateField("Expected salary date");
  f.setDate(current < Fmt.today() ? Fmt.today() : current);
  f.note(
    `Your usual payday is ${Prefs.salaryDayLabel().toLowerCase()}. ` +
      "I will ask again on the date you pick."
  );
  formDialog("When is it coming?", f, () => {
    const date = f.date;
    if (!date) return "Pick a date";
    if (date < Fmt.today()) return "That date has already passed";
    scopeOfNewPayday(ctx, m, date);
    return null;
  });
}

/** "Only this month, or from now on?" - the question that follows a new date. */
function scopeOfNewPayday(ctx, m, date) {
  const usual = Prefs.salaryDayLabel();
  choose(
    "This payday date is...",
    `Pushed to ${Fmt.dayLabel(date)} from ${usual.toLowerCase()}.`,
    [
      {
        label: "Only for this month",
        desc: `${Fmt.monthLabel(m)} only, then back to ${usual.toLowerCase()}`,
        onPick: () => {
          Repo.pushSalaryDue(m, date);
          toast(`I will ask again on ${Fmt.dayLabel(date)}`);
          ctx.refresh();
        },
      },
      {
        label: "Always from now on",
        desc: `Every payday becomes ${Fmt.dayLabel(date)}`,
        onPick: () => {
          Repo.pushSalaryDue(m, date);
          const day = parseInt(date.slice(8, 10), 10);
          const isLast = day >= Fmt.daysInMonth(date.slice(0, 7));
          Prefs.setSalaryDay(isLast ? 0 : day);
          Prefs.setLastSalaryAlert("");
          toast(`Payday is now ${Prefs.salaryDayLabel().toLowerCase()}`);
          ctx.refresh();
        },
      },
    ]
  );
}

/**
 * Records the confirmed month. This is the only thing that makes money
 * spendable, and it deliberately writes no transaction.
 */
function startMonth(ctx, m, salary, savings) {
  Repo.setMonthCfg(m, salary, savings);
  Repo.markSalaryPaid(m, Fmt.today());
  const spendable = Math.max(0, salary - savings);
  toast(`${Fmt.monthLabel(m)} started · ${Fmt.money(spendable)} to spend`);
  // the moment fresh money arrives is the moment worth saying who is waiting
  // for a repayment, so the list goes out now as well as mid-month
  Scheduler.checkPayablesOnSalary(m);
  ctx.refresh();
}

/**
 * The Home card for a month that is waiting. It explains that nothing is
 * spendable yet and offers the one button that changes that.
 */
export function salaryPrompt(s, ctx) {
  const p = pendingSalary();
  if (!p.waiting) return false;
  const v = p.view;
  const due = p.dueOn;
  const isToday = due === Fmt.today();
  // Once this month is running, the only month left waiting is next month, and
  // next month's salary is not due yet. Saying so on the last day of this month
  // reads as the app having forgotten the confirmation, so stay quiet until the
  // date actually arrives - unless the month already has entries, which means
  // money is being spent against a limit that was never confirmed.
  if (p.month !== Fmt.thisMonth() && !Repo.monthHasEntries(p.month)) return false;
  const lines = [`${Fmt.money(v.salary)} salary · ${Fmt.money(v.savingsTarget)} set aside`];
  if (p.cut > 0) {
    lines.push(`${Fmt.money(p.cut)} lost to leave this month`);
  } else {
    lines.push(`${Fmt.money(Math.max(0, v.salary - v.savingsTarget))} to spend`);
  }

  s.card((c) => {
    c.add(
      c.label(
        p.month === Fmt.thisMonth() ? "Waiting for your salary" : `Waiting for ${Fmt.monthLabel(p.month)}'s salary`,
        15,
        "ink",
        true
      )
    );
    c.add(
      c.sub(
        p.pushed
          ? `You are expecting it on ${Fmt.dayLabel(due)}.`
          : `Expected ${Fmt.dayLabel(due)}${isToday ? " - today" : ""}.`,
        12.5
      ),
      6
    );
    c.add(h("div", "sub", lines.join(" · ")), 8);
    const b = c.button("Did your salary land?", {
      primary: true,
      onClick: () => askAboutSalary(ctx, p.month),
    });
    b.style.marginTop = "12px";
    c.add(b);
  });
  s.note(
    "Your salary is a limit, not money in the account. Nothing counts against it until you confirm it arrived."
  );
  return true;
}

/** The small line shown on a month that is already running. */
export function salaryBadge(v, m = v.month) {
  if (!v.isStarted) return null;
  const cut = Repo.salaryCutFor(m);
  const bits = [];
  if (v.salaryPaidOn) bits.push(`Salary confirmed on ${Fmt.dayLabel(v.salaryPaidOn)}`);
  else bits.push("Started from entries");
  if (cut > 0) bits.push(`${Fmt.money(cut)} lost to leave`);
  return bits.join(" · ");
}
