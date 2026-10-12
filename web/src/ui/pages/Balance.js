// Budget Planner - Current balance.
// Mirrors app/src/main/java/com/budgetplanner/ui/BalanceFragment.kt.
//
// Savings is deliberately not on this page: it has its own page, so this stays
// a plain "what have I got left".

import { Repo } from "../../data/Repo.js";
import { Fmt } from "../../util/Fmt.js";
import { Anim } from "../Anim.js";
import * as Dialogs from "../Dialogs.js";
import { Form, amountOf, formDialog, toast } from "../Form.js";
import { Screen, rowFor } from "../Kit.js";
import { monthView } from "../MonthView.js";
import { Pages } from "../Pages.js";

export function build(ctx) {
  const s = new Screen();
  const m = ctx.month;
  const v = monthView(m);
  const sum = Repo.monthSum(m);
  // "in hand" is before the fixed savings are set aside, so it is the real
  // money that arrived this month, plus anything already there to start with
  const inHand = v.salary + v.opening - v.spent;
  const over = inHand < 0;
  const borrowedIn = sum.borrowedOpen;

  s.heroCard((c) => {
    c.add(c.label("MONEY IN HAND", 11, "ink", true));
    const num = c.big("", 36, "ink");
    num.style.marginTop = "4px";
    c.add(num);
    Anim.countUp(num, 0, inHand, 900, Fmt.money);
    c.add(
      c.sub(
        `${Fmt.monthLabel(m)} · ${Fmt.money(v.salary)} received · ${Fmt.money(v.spent)} spent`,
        12
      )
    );
  });

  if (!v.isEmpty) s.dailyCard(v);

  s.section("Where it went");
  const spendCount = Repo.txInMonth(m).filter((t) => t.type === "personal").length;
  s.card((c) => {
    lineRow(c, "Spent", Fmt.money(v.spent), `${spendCount} ${spendCount === 1 ? "entry" : "entries"} this month`, "ink", true);
    sep(c);
    lineRow(
      c,
      "Given to others",
      Fmt.money(sum.gaveAll),
      sum.gaveOpen > 0 ? `${Fmt.money(sum.gaveOpen)} still to get back` : "all settled",
      "warn",
      true
    );
    sep(c);
    lineRow(
      c,
      "Borrowed in",
      Fmt.money(borrowedIn),
      borrowedIn > 0 ? `${Fmt.money(borrowedIn)} to return` : "nothing to return",
      "bad",
      true
    );
    sep(c);
    lineRow(c, "Total out", Fmt.money(v.spent + sum.gaveAll), "excluding savings", "ink", true);
  });

  s.section("This month");
  s.card((c) => {
    lineRow(c, "Salary", Fmt.money(v.salary), "set in your profile", "muted");
    sep(c);
    lineRow(
      c,
      "Savings target",
      Fmt.money(v.savingsTarget),
      "kept aside, tracked on the Savings page",
      "muted"
    );
    sep(c);
    lineRow(c, "Safe to spend", Fmt.money(v.limit), "salary minus savings", v.isOver ? "bad" : "ok");
  });

  if (v.isPast) {
    s.section("Month closed");
    const moved = Repo.carriedAmount(m);
    s.card((c) => {
      lineRow(
        c,
        "Moved to savings",
        Fmt.money(moved),
        moved > 0 ? `left over at the end of ${Fmt.monthLabel(m)}` : "nothing was left over",
        moved > 0 ? "ok" : "muted",
        true
      );
      const b = c.button("Recalculate", {
        onClick: () => {
          const now = Repo.carryOverToSavings(m);
          toast(now > 0 ? `${Fmt.money(now)} moved into savings` : "Nothing left over");
          ctx.refresh();
        },
      });
      b.style.marginTop = "12px";
      c.add(b);
    });
  }

  s.button("Add what you spent", { onClick: () => ctx.open(Pages.ADD) });
  s.spacer(6);
  s.button("Edit salary for this month", { onClick: () => editIncome(m, ctx) });

  const recent = Repo.txInMonth(m).filter((t) => t.type === "personal").slice(0, 10);
  if (recent.length > 0) {
    s.section("This month's spending");
    s.listCard((lc) => {
      recent.forEach((t, i) => {
        if (i > 0) lc.divider();
        lc.add(
          rowFor({
            avatar: Fmt.initials(t.category || "?"),
            title: t.category || "Spending",
            subtitle: [Fmt.dayLabel(t.date), t.note].filter(Boolean).join(" · "),
            amount: Fmt.money(t.amount),
            amountColor: "ink",
            avatarTone: t.fromSavings ? "soft" : "card2",
            avatarTextColor: "brand",
            onClick: () => Dialogs.txDetail(t.id),
          })
        );
      });
    });
  }

  return s;
}

/** A label and hint on the left, a number on the right. */
function lineRow(c, title, value, hint, color, big = false) {
  const row = c.hstack();
  const col = c.vstack();
  col.style.flex = "1";
  col.appendChild(c.label(title, 14));
  col.appendChild(c.sub(hint, 11.5));
  row.appendChild(col);
  const v = big ? c.big(value, 16, color) : c.label(value, 14.5, color, true);
  v.style.whiteSpace = "nowrap";
  row.appendChild(v);
  c.add(row, 10);
}

function sep(c) {
  const d = document.createElement("div");
  d.style.cssText = "height:1px;background:var(--line);margin-top:10px";
  c.add(d);
}

/** Edit this month's salary and savings target. */
export function editIncome(m, ctx) {
  const cfg = Repo.monthCfg(m);
  const f = new Form();
  const sal = f.moneyPlain(`Salary for ${Fmt.monthLabel(m)}`, Fmt.moneyPlain(cfg.salary));
  const sav = f.moneyPlain("Savings target for this month", Fmt.moneyPlain(cfg.savings));
  f.note(
    "Savings is set aside first, so your safe spending limit is salary minus savings. Savings is tracked on its own page."
  );
  formDialog("This month", f, () => {
    const a = amountOf(sal);
    const b = amountOf(sav);
    if (a <= 0) return "Enter your salary";
    if (b > a) return "Savings cannot be more than your salary";
    Repo.setMonthCfg(m, a, b);
    ctx.refresh();
    toast("Updated", { good: true });
    return null;
  });
}
