// Budget Planner - one month, worked out in one place.
// Mirrors app/src/main/java/com/budgetplanner/ui/MonthView.kt.
//
// Home, Balance and Savings all read this, so they can never disagree about how
// much is left or how much is safe to spend per day. It is plain data, no DOM,
// which is what lets the same numbers be reused by a notification or a summary.

import { Repo } from "../data/Repo.js";
import { Fmt } from "../util/Fmt.js";

/**
 * @param {string} month "YYYY-MM"
 */
export function monthView(month) {
  const cfg = Repo.monthCfg(month);
  const started = Repo.isMonthStarted(month);
  const spent = Repo.monthSum(month).personal;
  const limit = started ? Math.max(0, cfg.salary - cfg.savings) : 0;
  // money already in hand for the month moves the balance but never the limit
  const inHand = limit + cfg.opening - spent;
  const daysTotal = Fmt.daysInMonth(month);
  const daysLeft = Fmt.daysLeftIn(month);
  const daily = inHand <= 0 || daysLeft === 0 ? 0 : inHand / daysLeft;
  return {
    month,
    salary: cfg.salary,
    savingsTarget: cfg.savings,
    opening: cfg.opening,
    spent,
    limit,
    inHand,
    daysTotal,
    daysLeft,
    daily,
    isCurrent: month === Fmt.thisMonth(),
    isPast: Fmt.isPastMonth(month),

    /**
     * False until the user has confirmed this month's salary landed. A salary is
     * only a ceiling, so nothing is spendable before that - the month has not
     * been given any money yet.
     */
    isStarted: started,
    salaryPaidOn: Repo.salaryPaidOn(month),

    /** True when the month is set up but still waiting for its payday. */
    get needsSalary() {
      return !started && cfg.salary > 0;
    },
    get isOver() {
      return this.inHand < 0;
    },
    get isEmpty() {
      return this.salary <= 0;
    },
    get usedFraction() {
      return this.limit > 0 ? Math.max(0, Math.min(1, this.spent / this.limit)) : 0;
    },
    get usedPercent() {
      return Math.floor(this.usedFraction * 100);
    },
    get carried() {
      return Repo.isCarried(month);
    },
    get closed() {
      return Repo.isClosed(month);
    },
  };
}

export const MonthView = {
  of: monthView,
};
