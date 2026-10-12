// Budget Planner - Home.
// Mirrors app/src/main/java/com/budgetplanner/ui/HomeFragment.kt.
//
// The order is chosen to match the question the user opens the app with:
// how much can I spend, then how fast am I burning it, then what is left to do.

import { Prefs } from "../../notify/Prefs.js";
import { Repo } from "../../data/Repo.js";
import { Fmt } from "../../util/Fmt.js";
import { Anim } from "../Anim.js";
import * as Dialogs from "../Dialogs.js";
import { deleteButton, Screen, dividerNode as divider, gap as gap8, rowFor, tone } from "../Kit.js";
import { monthView } from "../MonthView.js";
import { Pages } from "../Pages.js";
import { salaryBadge, salaryPrompt } from "../Salary.js";
import { ask, toast } from "../Form.js";

/** Builds the Home page body into a new Screen. */
export function build(ctx) {
  const s = new Screen();
  const m = ctx.month;
  const cfg = Repo.monthCfg(m);
  const v = monthView(m);
  const over = v.isOver;
  const th = Prefs.threshold();

  // ---- first run guidance ----
  if (cfg.salary <= 0) {
    s.card((c) => {
      const box = c.vstack();
      box.style.textAlign = "center";
      box.appendChild(c.big("Set your salary & savings", 18, "ink"));
      const t = c.sub(
        "Tell the app what you earn and what you want to keep aside. " +
          "It will then tell you how much is safe to spend every month.",
        13.5
      );
      t.style.marginTop = "6px";
      t.style.lineHeight = "1.6";
      box.appendChild(t);
      const b = c.button("Open profile", {
        primary: true,
        onClick: () => ctx.open(Pages.PROFILE),
      });
      b.style.marginTop = "14px";
      box.appendChild(b);
      c.add(box);
    });
  }

  // ---- waiting for the salary: nothing is spendable until it is confirmed ----
  //
  // A salary is a limit, not money, so an unconfirmed month has no allowance at
  // all. Showing a hero full of zeroes would be worse than saying so plainly, so
  // the whole budget block is replaced by the payday question.
  const waiting = salaryPrompt(s, ctx);

  // ---- hero: safe to spend ----
  if (!waiting) {
    s.heroCard((c) => {
      c.add(c.label(`SAFE TO SPEND · ${Fmt.monthLabel(m).toUpperCase()}`, 11, "ink", true));
      const num = c.big("", 34, "ink");
      num.style.marginTop = "4px";
      c.add(num);
      Anim.countUp(num, 0, v.limit, 850, Fmt.money);
      if (cfg.salary > 0) c.add(c.sub(`of ${Fmt.money(cfg.salary)} salary`, 12));
    });

    // ---- the number to look at every day ----
    if (cfg.salary > 0) s.dailyCard(v);

    // ---- spending progress ----
    s.card((c) => {
      const line = c.hstack();
      const lbl = c.label("Spent this month", 13.5, "muted");
      lbl.style.flex = "1";
      line.appendChild(lbl);
      const spent = c.big("", 20, over ? "bad" : "ink");
      line.appendChild(spent);
      c.add(line);
      Anim.countUp(spent, 0, v.spent, 900, Fmt.money);

      const bar = c.bar(v.usedFraction, { danger: over });
      bar.style.marginTop = "12px";
      c.add(bar);

      const foot = c.hstack();
      const leftTxt = c.sub(
        over ? `Over by ${Fmt.money(-v.inHand)}` : `${Fmt.money(v.inHand)} left of ${Fmt.money(v.limit)}`,
        12,
        over ? "bad" : "muted"
      );
      leftTxt.style.flex = "1";
      foot.appendChild(leftTxt);
      foot.appendChild(c.sub(`${v.usedPercent}% used`, 12));
      foot.style.marginTop = "7px";
      c.add(foot);
    });

    // ---- low budget alert ----
    if (cfg.salary > 0 && v.limit > 0 && (over || v.usedFraction >= th)) {
      const alert = s.card((c) => {
        const row = c.hstack();
        const icon = document.createElement("div");
        icon.className = "alert-ico";
        icon.style.background = tone(over ? "bad" : "warn");
        icon.textContent = "!";
        row.appendChild(icon);
        const col = c.vstack();
        col.style.marginLeft = "12px";
        col.appendChild(
          c.label(over ? "You are over your limit" : "Your budget is getting low", 15, "ink", true)
        );
        col.appendChild(
          c.sub(
            over
              ? `You have spent ${Fmt.money(v.spent)} against a ${Fmt.money(v.limit)} limit. Nothing left for this month.`
              : `Only ${Fmt.money(v.inHand)} left. That is ${100 - v.usedPercent}% of your limit still unused.`,
            12
          )
        );
        row.appendChild(col);
        c.add(row);
      });
      Anim.pulse(alert, 1.03);
    }

    // ---- one line saying where the month's numbers came from ----
    const badge = salaryBadge(v);
    if (badge) s.note(badge);
  }

  // ---- month close: leftover goes to savings automatically ----
  if (v.isPast) {
    const amount = Repo.carriedAmount(m);
    s.card((c) => {
      const row = c.hstack();
      const av = document.createElement("div");
      av.className = "alert-ico";
      av.style.background = tone("ok");
      av.textContent = "✓";
      row.appendChild(av);
      const col = c.vstack();
      col.style.marginLeft = "12px";
      col.appendChild(c.label(`${Fmt.monthLabel(m)} is closed`, 15, "ink", true));
      col.appendChild(
        c.sub(
          amount > 0
            ? `${Fmt.money(amount)} was left over and moved into your savings.`
            : "Everything in the spending limit was used, so nothing was added to savings.",
          12.5
        )
      );
      row.appendChild(col);
      c.add(row);
      const b = c.button("Recalculate leftover", { onClick: () => carry(m, ctx) });
      b.style.marginTop = "12px";
      c.add(b);
    });
  }

  // ---- quick actions ----
  s.section("Quick add");
  s.buttonRow(
    s.buildButton("Spending", { onClick: () => ctx.open(Pages.ADD) }),
    s.buildButton("Gave", { onClick: () => Dialogs.addTx("gave") }),
    s.buildButton("Borrowed", { onClick: () => Dialogs.addTx("borrowed") })
  );

  // ---- the early-month common payments nudge, on the page as well as in the
  //      notification, because the notification only arrives while the tab is
  //      open and this is where the user actually is ----
  const common = commonCard(ctx);
  if (common) s.add(common);

  // ---- bills ----
  const bills = Repo.activeBills();
  if (bills.length > 0) {
    s.section("Bills this month");
    const day = ctx.dayOfMonth();
    const unpaid = bills.filter((b) => !b.isPaidThis(m));
    s.listCard((col) => {
      if (unpaid.length === 0) {
        col.add(
          rowFor({
            avatar: "✓",
            title: "All bills paid",
            subtitle: `Nothing pending for ${Fmt.monthLabel(m)}`,
            amount: "✓",
            amountColor: "ok",
            avatarTone: "soft",
            avatarTextColor: "ok",
          })
        );
      } else {
        unpaid.slice(0, 6).forEach((b, i) => {
          if (i > 0) col.divider();
          col.add(billRow(b, m, day, ctx));
        });
      }
    });
    s.button("Manage bills", { onClick: () => ctx.open(Pages.BILLS) });
  }

  // ---- money with people ----
  s.section("Money with people");
  s.kpi("To get back", Fmt.money(Repo.openReceivable()), "all months", "ok", () =>
    ctx.open(Pages.PEOPLE)
  );
  s.add(gap8());
  s.kpi("You owe", Fmt.money(Repo.openPayable()), "borrowed", "bad", () => ctx.open(Pages.PEOPLE));
  s.add(gap8());
  const roomNet = Repo.roomNetTotal();
  s.kpi(
    roomNet >= 0 ? "Room owes you" : "You owe the room",
    Fmt.money(Math.abs(roomNet)),
    "after balancing both ways",
    roomNet >= 0 ? "warn" : "bad",
    () => ctx.open(Pages.ROOM)
  );

  // ---- needs ----
  const needs = Repo.openNeeds();
  if (needs.length > 0) {
    s.section("Money I still need");
    s.listCard((col) => {
      needs.slice(0, 4).forEach((n, i) => {
        if (i > 0) col.divider();
        col.add(
          rowFor({
            avatar: "?",
            title: n.text,
            subtitle: [n.amount > 0 ? Fmt.money(n.amount) : null, n.fromWhom || "no source noted", Fmt.dayLabel(n.date)]
              .filter(Boolean)
              .join(" · "),
            amount: "GET",
            amountColor: "brand",
            avatarTone: "card2",
            avatarTextColor: "muted",
            onClick: () => Dialogs.needDetail(n.id),
          })
        );
      });
    });
  }

  // ---- recent spending ----
  const recent = Repo.txInMonth(m).filter((t) => t.type === "personal").slice(0, 6);
  if (recent.length > 0) {
    s.section("Recent spending");
    s.listCard((col) => {
      recent.forEach((t, i) => {
        if (i > 0) col.divider();
        col.add(
          rowFor({
            avatar: Fmt.initials(t.category || "?"),
            title: t.category || "Spending",
            subtitle: [Fmt.dayLabel(t.date), t.note].filter(Boolean).join(" · "),
            amount: Fmt.money(t.amount),
            amountColor: "ink",
            avatarTone: "soft",
            avatarTextColor: "brand",
            onClick: () => Dialogs.txDetail(t.id),
            trailing: deleteButton(() => confirmDeleteEntry(t.id, ctx)),
          })
        );
      });
    });
    s.button("See all money entries", { onClick: () => ctx.open(Pages.MONEY) });
  }

  return s;
}

function carry(m, ctx) {
  const moved = Repo.carryOverToSavings(m);
  toast(moved > 0 ? `${Fmt.money(moved)} moved into savings` : `Nothing left over in ${m}`);
  ctx.refresh();
}

/**
 * The common payments still to handle this month. Returns null when there is
 * nothing to say, so the caller can just skip it.
 */
export function commonCard(ctx) {
  const m = ctx.month;
  if (Fmt.isPastMonth(m)) return null;
  const until = Prefs.commonUntilDay();
  const all = Repo.commonBills(m, until);
  if (all.length === 0) return null;
  const due = Repo.commonDue(m, ctx.dayOfMonth(), until);
  if (due.length === 0) return null;

  const s = new Screen();
  const total = due.reduce((a, b) => a + b.amount, 0);
  s.card((c) => {
    const row = c.hstack();
    const icon = document.createElement("div");
    icon.className = "alert-ico";
    icon.style.background = tone("brand");
    icon.textContent = "₹";
    row.appendChild(icon);
    const col = c.vstack();
    col.style.marginLeft = "12px";
    col.style.flex = "1";
    col.appendChild(
      c.label(due.length === 1 ? due[0].name : `${due.length} common payments to handle`, 15, "ink", true)
    );
    col.appendChild(
      c.sub(
        due.length === 1
          ? due[0].dueDay === ctx.dayOfMonth()
            ? "Due today. Tap to mark it paid."
            : `Due on day ${due[0].dueDay}. Tap to mark it paid.`
          : `Still to pay for ${Fmt.monthLabel(m)}${total > 0 ? ` · ${Fmt.money(total)} in all` : ""}.`,
        12.5
      )
    );
    row.appendChild(col);
    c.add(row);

    const b = c.button(due.length === 1 ? "Mark it paid" : "Open bills", {
      primary: true,
      onClick: () => {
        if (due.length === 1) {
          Repo.markBillPaid(due[0].id, m);
          toast(`${due[0].name} marked paid`);
          ctx.refresh();
        } else {
          ctx.open(Pages.BILLS);
        }
      },
    });
    b.style.marginTop = "12px";
    c.add(b);
  });
  return s.root;
}

/** One line in the bills list, coloured by how close it is. */
export function billRow(b, m, day, ctx) {
  const due = b.isOverdue(m, day);
  const soon = b.isDueSoon(m, day);
  const color = due ? "bad" : soon ? "warn" : "muted";
  const whenTxt = due
    ? `Due since day ${b.dueDay} · tap to mark paid`
    : soon
    ? `Due on day ${b.dueDay}`
    : `Due day ${b.dueDay}`;
  return rowFor({
    avatar: Fmt.initials(b.name),
    title: b.name,
    subtitle: whenTxt + (b.amount > 0 ? ` · ${Fmt.money(b.amount)}` : ""),
    amount: "PAID",
    amountColor: color,
    avatarTone: "card2",
    avatarTextColor: color,
    onClick: () => Dialogs.billDetail(b),
  });
}

/**
 * Removes an entry after one short confirmation.
 *
 * Every list of entries asks the same way, so undoing a mistake costs the same
 * two taps wherever the entry was, and Repo.deleteTx puts savings and the shares
 * of a split back in step on its own.
 */
function confirmDeleteEntry(id, ctx) {
  ask(
    "Delete this entry?",
    "It goes for good. If it was paid out of savings, the amount goes back into savings.",
    {
      okLabel: "Delete",
      danger: true,
      onOk: () => {
        Repo.deleteTx(id);
        toast("Entry deleted");
        ctx.refresh();
      },
    }
  );
}
