// Budget Planner - the two numbers you correct by hand.
//
// Salary and the cash you already had both move for reasons the app cannot
// see: a raise, a new job, or money that was in your pocket before you
// started writing things down. They live here rather than inside a page so
// that More and Profile offer exactly the same editor, instead of one of them
// growing a private copy that quietly goes out of date.

import { Repo } from "../data/Repo.js";
import { Fmt } from "../util/Fmt.js";
import { amountOf, Form, formDialog, toast } from "./Form.js";

/**
 * The monthly salary, and the savings to keep aside from it. Both are the same
 * for every month going forward, which is why they live in the defaults and not
 * on a transaction. The current month is written too, so a change shows up on
 * the Home page straight away instead of after the next month rolls over.
 */
export function editDefaults(ctx) {
  const f = new Form();
  const sal = f.moneyPlain("Monthly salary", Fmt.moneyPlain(Repo.defaultSalary()));
  const sav = f.moneyPlain("Savings to set aside", Fmt.moneyPlain(Repo.defaultSavings()));
  f.note(
    "Savings is kept aside first. Your safe spending limit is salary minus savings, and anything you don't spend by month end is added to savings."
  );
  formDialog("Salary and savings", f, () => {
    const a = amountOf(sal);
    const b = amountOf(sav);
    if (a <= 0) return "Enter your salary";
    if (b > a) return "Savings cannot be more than your salary";
    Repo.setDefaults(a, b, Repo.currency());
    Repo.setMonthCfg(ctx.month, a, b);
    toast(`Salary set to ${Fmt.money(a)}`);
    ctx.refresh();
    return null;
  });
}

/**
 * Sets the money already in hand for a month. Kept out of the spending limit on
 * purpose: it is not new money for the month, it only moves the starting point.
 */
export function editOpening(ctx, m) {
  const f = new Form();
  const cur = Repo.monthCfg(m).opening;
  const v = f.moneyPlain("Money already in hand for " + Fmt.monthLabel(m), Fmt.moneyPlain(cur));
  const what = Repo.monthSum(m).personal;
  f.note(
    `This month: ${Fmt.money(Repo.monthCfg(m).salary)} salary, ${Fmt.money(what)} spent, ` +
      `so the balance shows ${Fmt.money(Repo.monthCfg(m).salary + cur - what)}. ` +
      "This does not change your spending limit."
  );
  formDialog("Money in hand", f, () => {
    Repo.setMonthOpening(m, amountOf(v));
    toast("Money in hand updated");
    ctx.refresh();
  });
}
