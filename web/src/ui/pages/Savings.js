// Budget Planner - Savings.
// Mirrors app/src/main/java/com/budgetplanner/ui/SavingsFragment.kt.
//
// Anything unspent at the end of a month lands here on its own, and the target
// from the profile shows how close the balance is to it.

import { Repo } from "../../data/Repo.js";
import { Fmt } from "../../util/Fmt.js";
import { Anim } from "../Anim.js";
import * as Dialogs from "../Dialogs.js";
import { ask, toast } from "../Form.js";
import { Screen, rowFor, tone } from "../Kit.js";
import { monthView } from "../MonthView.js";
import { Pages } from "../Pages.js";

export function build(ctx) {
  const s = new Screen();
  const m = ctx.month;
  const v = monthView(m);
  const entries = Repo.savingsAll();
  const balance = Repo.savingsBalance();
  const target = v.savingsTarget > 0 ? v.savingsTarget : Repo.defaultSavings();
  const progress = target > 0 ? Math.max(0, Math.min(1, balance / target)) : 0;

  s.heroCard((c) => {
    c.add(c.label("IN SAVINGS", 11, "ink", true));
    const num = c.big("", 36, "ink");
    num.style.marginTop = "4px";
    c.add(num);
    Anim.countUp(num, 0, balance, 900, Fmt.money);
    c.add(
      c.sub(target > 0 ? `Target ${Fmt.money(target)} a month` : "No monthly target set yet", 12)
    );
  });

  if (target > 0) {
    s.card((c) => {
      const head = c.hstack();
      const lbl = c.label("Towards this month's target", 13.5);
      lbl.style.flex = "1";
      head.appendChild(lbl);
      head.appendChild(c.big(`${Math.floor(progress * 100)}%`, 15, progress >= 1 ? "ok" : "brand"));
      c.add(head);
      const bar = c.bar(progress);
      bar.style.marginTop = "10px";
      bar.style.height = "8px";
      c.add(bar);
      const gapLeft = target - balance;
      c.add(
        c.sub(
          gapLeft > 0 ? `${Fmt.money(gapLeft)} short of your target` : "Target reached",
          12,
          gapLeft > 0 ? "muted" : "ok"
        ),
        8
      );
    });
  }

  s.buttonRow(
    s.buildButton("Move in", {
      primary: true,
      onClick: () => Dialogs.savingsMove("in"),
    }),
    s.buildButton("Take out", {
      onClick: () => {
        if (balance <= 0) return toast("There is nothing in savings to take out");
        Dialogs.savingsMove("out");
      },
    })
  );

  // ---- month-end leftover ----
  s.section("Month-end leftover");
  const carried = Repo.carriedAmount(m);
  s.card((c) => {
    const row = c.hstack();
    const av = document.createElement("div");
    av.className = "alert-ico";
    av.style.background = tone(carried > 0 ? "ok" : "muted");
    av.textContent = "✓";
    row.appendChild(av);
    const col = c.vstack();
    col.style.marginLeft = "12px";
    col.appendChild(c.label(Fmt.monthLabel(m), 15, "ink", true));
    col.appendChild(
      c.sub(
        v.isPast && carried > 0
          ? `${Fmt.money(carried)} left over and added to savings.`
          : "Anything you don't spend this month is added here automatically at month end.",
        12.5
      )
    );
    row.appendChild(col);
    c.add(row);
    if (v.isPast) {
      const b = c.button(carried > 0 ? "Recalculate" : "Check leftover", {
        onClick: () => {
          const now = Repo.carryOverToSavings(m);
          toast(now > 0 ? `${Fmt.money(now)} added to savings` : "Nothing was left over");
          ctx.refresh();
        },
      });
      b.style.marginTop = "12px";
      c.add(b);
    }
  });

  s.section("History");
  if (entries.length === 0) {
    s.empty(
      "Nothing in savings yet",
      "Move money in, or just leave some unspent - the app moves the leftover into savings for you at the end of every month.",
      "Move money in",
      () => Dialogs.savingsMove("in")
    );
  } else {
    s.listCard((lc) => {
      entries.slice(0, 40).forEach((e, i) => {
        if (i > 0) lc.divider();
        lc.add(savingRow(e, ctx));
      });
    });
    s.note("Saving a fixed amount each month is the default. Whatever is left at month end is added on top of that.");
  }

  s.button("Change monthly savings target", { onClick: () => ctx.open(Pages.PROFILE) });

  return s;
}

function savingRow(e, ctx) {
  const into = e.dir === "in";
  const carry = e.note.startsWith("Left over from");
  const title = carry
    ? `Leftover from ${Fmt.monthLabel(e.note.replace("Left over from ", "").trim())}`
    : into
    ? "Moved into savings"
    : "Taken out of savings";
  return rowFor({
    avatar: carry ? "✓" : into ? "↑" : "↓",
    title,
    subtitle: [Fmt.dayLabel(e.date) || null, carry ? "auto at month end" : null]
      .filter(Boolean)
      .join(" · "),
    amount: (into ? "+" : "-") + Fmt.money(e.amount),
    amountColor: into ? "ok" : "bad",
    avatarTone: into ? "soft" : "card2",
    avatarTextColor: into ? "ok" : "bad",
    onClick: () => detail(e, ctx),
  });
}

function detail(e, ctx) {
  ask(
    e.dir === "in" ? "Into savings" : "Out of savings",
    [Fmt.money(e.amount), Fmt.dayLabel(e.date) || e.date, e.note].filter(Boolean).join("\n"),
    {
      okLabel: "Delete",
      danger: true,
      onOk: () => {
        Repo.deleteSaving(e.id);
        ctx.refresh();
      },
    }
  );
}
