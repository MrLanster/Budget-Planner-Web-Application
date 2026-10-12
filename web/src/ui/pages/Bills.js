// Budget Planner - Bills.
// Mirrors app/src/main/java/com/budgetplanner/ui/BillsFragment.kt.
//
// Recurring bills, each one due on the same day every month until it is marked
// paid. The common payments section at the top is the new bit: the bills that
// land early in the month, gathered together so they are handled in one go
// rather than one reminder at a time.

import { Prefs } from "../../notify/Prefs.js";
import { Repo } from "../../data/Repo.js";
import { Fmt } from "../../util/Fmt.js";
import * as Dialogs from "../Dialogs.js";
import { Scheduler } from "../../notify/Scheduler.js";
import { gap, h, rowFor, Screen, tone } from "../Kit.js";
import { toast } from "../Form.js";

export function build(ctx) {
  const s = new Screen();
  const m = ctx.month;
  const day = ctx.dayOfMonth();
  const all = Repo.bills();
  const active = all.filter((b) => b.active);
  const inactive = all.filter((b) => !b.active);
  const unpaid = active.filter((b) => !b.isPaidThis(m));
  const dueTotal = unpaid.reduce((a, b) => a + b.amount, 0);

  s.kpi("To pay", Fmt.money(dueTotal), `${unpaid.length} pending`, "bad");
  s.add(gap());
  s.kpi(
    "Paid",
    Fmt.money(active.filter((b) => b.isPaidThis(m)).reduce((a, b) => a + b.amount, 0)),
    `${active.filter((b) => b.isPaidThis(m)).length} done`,
    "ok"
  );

  s.spacer(4);
  s.button("+ Add a monthly bill", { primary: true, onClick: () => Dialogs.billEdit() });

  // ---- the early-month common payments ----
  commonSection(s, ctx);

  s.section(`Pending for ${Fmt.monthLabel(m)}`);
  if (unpaid.length === 0) {
    s.empty(
      "Nothing pending",
      active.length === 0
        ? "Add the bills that repeat every month - wifi, rent, recharge - and the app will remind you on the due day."
        : `Every bill is marked paid for ${Fmt.monthLabel(m)}.`,
      active.length === 0 ? "+ Add a monthly bill" : null,
      () => Dialogs.billEdit()
    );
  } else {
    s.listCard((lc) => {
      unpaid.forEach((b, i) => {
        if (i > 0) lc.divider();
        lc.add(billRow(b, m, day));
      });
    });
  }

  const paid = active.filter((b) => b.isPaidThis(m));
  if (paid.length > 0) {
    s.section(`Paid for ${Fmt.monthLabel(m)}`);
    s.listCard((lc) => {
      paid.forEach((b, i) => {
        if (i > 0) lc.divider();
        lc.add(billRow(b, m, day));
      });
    });
  }

  if (inactive.length > 0) {
    s.section("Paused");
    s.listCard((lc) => {
      inactive.forEach((b, i) => {
        if (i > 0) lc.divider();
        lc.add(billRow(b, m, day));
      });
    });
  }

  s.section("All bills");
  s.listCard((lc) => {
    all.forEach((b, i) => {
      if (i > 0) lc.divider();
      lc.add(
        rowFor({
          avatar: Fmt.initials(b.name),
          title: b.name,
          subtitle:
            allStatus(b, m, day) + (b.amount > 0 ? ` · ${Fmt.money(b.amount)}` : ""),
          amount: b.isPaidThis(m) ? "✓" : "",
          amountColor: b.isPaidThis(m) ? "ok" : "muted",
          avatarTone: "card2",
          avatarTextColor: "muted",
          onClick: () => Dialogs.billDetail(b),
        })
      );
    });
  });

  s.note(
    "Each bill is due on the same day every month, capped at day 28. You are reminded on the morning of the due day, and again if it is still unpaid."
  );
  s.button("Recheck reminders now", {
    onClick: () => {
      Scheduler.run();
      toast("Reminders rechecked");
    },
  });
  if (!Prefs.commonOn()) {
    s.note("The early-month common payments nudge is switched off. Turn it on in your profile.");
  }

  return s;
}

/**
 * The bills that fall due in the first N days of the month, all in one card
 * with a single button to mark them paid. The window comes from the profile,
 * and defaults to the 10th.
 */
function commonSection(s, ctx) {
  const m = ctx.month;
  if (Fmt.isPastMonth(m)) return;
  const until = Prefs.commonUntilDay();
  const all = Repo.commonBills(m, until);
  if (all.length === 0) return;

  const day = ctx.dayOfMonth();
  const due = Repo.commonDue(m, day, until);
  const upcoming = all.filter((b) => !b.isPaidThis(m) && b.dueDay > day);
  const total = all.reduce((a, b) => a + b.amount, 0);

  s.section("Common payments this month");
  s.card((c) => {
    const head = c.hstack();
    const lbl = c.label(`Due in the first ${until} days`, 13.5, "ink", true);
    lbl.style.flex = "1";
    head.appendChild(lbl);
    if (total > 0) head.appendChild(c.label(Fmt.money(total), 13.5, "muted", true));
    c.add(head);

    if (due.length > 0) {
      c.add(
        c.sub(
          due.length === 1
            ? `1 still to pay: ${due[0].name}${due[0].amount > 0 ? ` · ${Fmt.money(due[0].amount)}` : ""}`
            : `${due.length} still to pay · ${Fmt.money(due.reduce((a, b) => a + b.amount, 0))} in all`,
          12,
          "bad"
        ),
        6
      );
    } else {
      c.add(c.sub("All marked paid", 12, "ok"), 6);
    }

    // every bill in the window, so the whole month is visible at once
    const list = h("div", "stack");
    list.style.marginTop = "8px";
    all.forEach((b) => {
      const paidNow = b.isPaidThis(m);
      const r = h("div", "flexrow");
      const tick = h("div", "tickbox");
      if (paidNow) {
        tick.classList.add("on");
        tick.textContent = "✓";
      }
      r.appendChild(tick);
      const nm = h("div");
      nm.style.flex = "1";
      const t = h("div", "label");
      t.textContent = b.name;
      if (paidNow) t.style.color = tone("muted");
      nm.appendChild(t);
      const sb = h("div", "sub");
      sb.textContent = paidNow
        ? `paid for ${Fmt.monthLabel(m)}`
        : b.dueDay === day
        ? "due today"
        : `due on day ${b.dueDay}`;
      nm.appendChild(sb);
      r.appendChild(nm);
      if (b.amount > 0) {
        const a = h("div", "label bold", Fmt.money(b.amount));
        if (paidNow) a.style.color = tone("muted");
        r.appendChild(a);
      }
      list.appendChild(r);
    });
    c.add(list);

    if (due.length > 0) {
      const b = c.button(
        due.length === 1 ? `Mark ${due[0].name} paid` : `Mark all ${due.length} as paid`,
        {
          primary: true,
          onClick: () => {
            due.forEach((b2) => Repo.markBillPaid(b2.id, m));
            toast(
              due.length === 1
                ? `${due[0].name} marked paid`
                : `${due.length} bills marked paid`
            );
            ctx.refresh();
          },
        }
      );
      b.style.marginTop = "12px";
      c.add(b);
    }

    if (upcoming.length > 0) {
      c.add(
        c.sub(
          `Still to come: ${upcoming.map((b) => `${b.name} on day ${b.dueDay}`).join(", ")}.`,
          12
        ),
        10
      );
    }
  });

  s.note(
    "Bills due on or before the " +
      String(until) +
      " are treated as common payments. Change the day in your profile."
  );
}

function allStatus(b, m, day) {
  if (!b.active) return "paused";
  if (b.isPaidThis(m)) return `paid for ${Fmt.monthLabel(m)}`;
  if (b.isOverdue(m, day)) return "overdue";
  if (b.isDueSoon(m, day)) return `due day ${b.dueDay}`;
  return `day ${b.dueDay}`;
}

function billRow(b, m, day) {
  const paid = b.isPaidThis(m);
  const color = paid ? "ok" : b.isOverdue(m, day) ? "bad" : b.isDueSoon(m, day) ? "warn" : "muted";
  const whenTxt = paid
    ? `Paid for ${Fmt.monthLabel(m)} · tap to undo`
    : b.isOverdue(m, day)
    ? `Overdue since day ${b.dueDay} · tap to mark paid`
    : b.isDueSoon(m, day)
    ? `Due on day ${b.dueDay}`
    : `Due day ${b.dueDay}`;
  return rowFor({
    avatar: Fmt.initials(b.name),
    title: b.name,
    subtitle: whenTxt + (b.amount > 0 ? ` · ${Fmt.money(b.amount)}` : ""),
    amount: paid ? "✓" : "PAID",
    amountColor: color,
    avatarTone: paid ? "soft" : "card2",
    avatarTextColor: color,
    onClick: () => Dialogs.billDetail(b),
  });
}
