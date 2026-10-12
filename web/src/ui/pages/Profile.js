// Budget Planner - Profile.
// Mirrors app/src/main/java/com/budgetplanner/ui/ProfileFragment.kt, plus three
// things that are new here:
//   * the roommate list, which is the same list the Room page and the Add page
//     use, and which also makes somebody selectable as a person
//   * the early-month common payments reminder and the day its window closes
//   * the account panel, which is yours alone even though the app is shared

import { Auth } from "../../data/Auth.js";
import { Repo } from "../../data/Repo.js";
import { Prefs } from "../../notify/Prefs.js";
import { Scheduler, askPermission } from "../../notify/Scheduler.js";
import { Fmt } from "../../util/Fmt.js";
import { editDefaults, editOpening } from "../Defaults.js";
import * as Dialogs from "../Dialogs.js";
import { amountOf, ask, Form, formDialog, openSheet, textOf, toast } from "../Form.js";
import { h, Screen, toggleRow, tone } from "../Kit.js";
import { monthView } from "../MonthView.js";
import { askAboutSalary, pendingSalary } from "../Salary.js";
import { Pages } from "../Pages.js";
import { Theme } from "../Theme.js";

export function build(ctx) {
  const s = new Screen();
  const m = ctx.month;
  const v = monthView(m);
  const overridden = Repo.monthsSet().has(m);

  // ---- who you are ----
  s.card((c) => {
    const row = c.hstack();
    const av = h("div", "av", (Auth.name()[0] || "B").toUpperCase());
    av.style.cssText = "width:54px;height:54px;flex:0 0 54px;border-radius:999px;background:var(--brand);color:#fff;font-size:22px";
    row.appendChild(av);
    const col = c.vstack();
    col.style.marginLeft = "14px";
    col.appendChild(c.label(Auth.name() || "Your profile", 18, "ink", true));
    col.appendChild(c.sub("Private to your account", 12.5));
    row.appendChild(col);
    c.add(row);
  });
  s.button("Change name", { onClick: () => editName(ctx) });

  // ---- salary and savings ----
  s.section("Salary and savings");
  s.card((c) => {
    const rows = c.vstack();
    c.add(rows);
    field(rows, "Monthly salary", Fmt.money(v.salary), "What you get each month", c);
    rows.appendChild(divider(10));
    field(rows, "Savings target", Fmt.money(v.savingsTarget), "Kept aside before spending", c);
    rows.appendChild(divider(10));
    field(rows, "Safe to spend", Fmt.money(v.limit), "Salary minus savings", c);
  });
  s.button("Edit salary and savings", { primary: true, onClick: () => editDefaults(ctx) });

  // ---- what you have, and what you owe ----
  // Both of these move for reasons the app cannot see: a bank transfer, a
  // correction, money that was already there. So both get an edit button here
  // rather than making the figure something you can only change by inventing
  // a transaction to get there.
  s.section("Your money");
  s.card((c) => {
    const rows = c.vstack();
    c.add(rows);
    const inHand = v.salary + v.opening - v.spent;
    rows.appendChild(
      tapRow(
        "Money in hand",
        `${Fmt.money(inHand)} in ${Fmt.monthLabel(m)}`,
        "Edit",
        () => editOpening(ctx, m)
      )
    );
    rows.appendChild(divider(10));
    rows.appendChild(
      tapRow(
        "Total savings",
        Fmt.money(Repo.savingsBalance()),
        "Correct",
        () => Dialogs.adjustSavings(() => ctx.refresh())
      )
    );
  });
  s.note(
    "Money in hand is this month's salary, plus anything you had already, minus " +
      "what you have spent. Savings is tracked on its own page; the button above " +
      "is for putting the figure right when it is out."
  );

  s.button("Add an older entry in someone's name", {
    onClick: () => Dialogs.oldEntry(() => ctx.refresh()),
  });
  s.note(
    "For money that changed hands before you were using the app - something you " +
      "borrowed in March and never wrote down, for instance."
  );

  // A salary here is a ceiling, not money: say so where the number is set, so
  // nobody expects typing it to put anything in the account.
  s.note(
    "Your salary is only your spending limit. No money is added to the account, " +
      "and nothing is spendable until you confirm the salary landed."
  );
  paydayCard(s, ctx);

  s.card((c) => {
    if (overridden) {
      c.add(c.label("This month has its own values", 14.5, "ink", true));
      c.add(
        c.sub(
          `${Fmt.monthLabel(m)} was set separately, so changing your default will not change it.`,
          12.5
        ),
        4
      );
      const b = c.button(`Go back to my default for ${Fmt.monthLabel(m)}`, {
        onClick: () => {
          Repo.clearMonthOverride(m);
          const d = Repo.defaults();
          Repo.setMonthCfg(m, d.salary, d.savings);
          toast("Back to your default");
          ctx.refresh();
        },
      });
      b.style.marginTop = "12px";
      c.add(b);
    } else {
      c.add(c.label("Every month starts from these numbers", 14.5, "ink", true));
      c.add(
        c.sub(
          "You can still change a single month from the Balance page, for example when your salary changes.",
          12.5
        ),
        4
      );
    }
  });

  // ---- roommates ----
  s.section("Roommates");
  const mates = Repo.roomNets();
  s.card((c) => {
    if (mates.length === 0) {
      c.add(c.label("No roommate added yet", 14.5, "ink", true));
      c.add(
        c.sub(
          "Add the people you share rent and bills with. Room bills are split equally between everyone you tick, and what each of them owes you is shown here.",
          12.5
        )
      );
    } else {
      const rows = c.vstack();
      c.add(rows);
      mates.forEach((n, i) => {
        if (i > 0) rows.appendChild(divider(10));
        const row = h("div", "flexrow");
        const who = h("div", "stack");
        who.style.flex = "1";
        who.appendChild(h("div", "label", n.name));
        const parts = [];
        if (n.theyOweMe > 0) parts.push(`owes you ${Fmt.money(n.theyOweMe)}`);
        if (n.iOweThem > 0) parts.push(`you owe ${Fmt.money(n.iOweThem)}`);
        who.appendChild(h("div", "sub", parts.length === 0 ? "all square" : parts.join("  ·  ")));
        row.appendChild(who);
        const vEl = h(
          "div",
          "big",
          n.net === 0 ? Fmt.money(0) : Fmt.money(Math.abs(n.net))
        );
        vEl.style.fontSize = "16px";
        vEl.style.color = n.net > 0 ? "var(--ok)" : n.net < 0 ? "var(--bad)" : "var(--muted)";
        row.appendChild(vEl);
        rows.appendChild(row);
      });
    }
  });
  s.button("Add or change roommates", {
    primary: true,
    onClick: () => Dialogs.roomPeople(() => ctx.refresh()),
  });
  s.note(
    "Anyone here can also be picked as the person when you add money, so a roommate's name is already in the list."
  );

  // ---- currency ----
  s.section("Currency");
  s.card((c) => {
    const row = c.hstack();
    const lbl = c.label("Symbol", 14.5);
    lbl.style.flex = "1";
    row.appendChild(lbl);
    row.appendChild(c.label(Repo.currency(), 17, "brand", true));
    c.add(row);
    const symbols = ["₹", "$", "€", "£"];
    const bar = h("div", "btn-row");
    for (const sym of symbols) {
      const b = h("button", "btn", sym);
      b.type = "button";
      if (sym === Repo.currency()) b.classList.add("primary");
      b.addEventListener("click", () => {
        Repo.set("currency", sym);
        toast(`Currency set to ${sym}`);
        ctx.refresh();
      });
      bar.appendChild(b);
    }
    c.add(bar);
  });

  // ---- light or dark ----
  s.section("Appearance");
  s.card((c) => {
    const row = c.hstack();
    const lbl = c.label("Theme", 14.5);
    lbl.style.flex = "1";
    row.appendChild(lbl);
    row.appendChild(c.label(Theme.label(Theme.get()), 14.5, "brand", true));
    c.add(row);
    c.add(c.sub("Follow the device, or keep one theme", 11.5), 6);
    const bar = h("div", "btn-row");
    for (const choice of Theme.choices) {
      const b = h("button", "btn", Theme.label(choice));
      b.type = "button";
      if (choice === Theme.get()) b.classList.add("primary");
      b.addEventListener("click", () => {
        Theme.set(choice);
        toast(`Theme: ${Theme.label(choice)}`);
        ctx.refresh();
      });
      bar.appendChild(b);
    }
    c.add(bar);
  });

  // ---- reminders ----
  s.section("Reminders");
  s.card((c) => {
    const col = c.vstack();
    c.add(col);
    col.appendChild(
      toggleRow(
        "Payday question",
        "Asks whether your salary landed, so the month can start",
        Prefs.salaryOn(),
        (on) => {
          Prefs.setSalaryOn(on);
          if (on) Prefs.setLastSalaryAlert("");
        }
      )
    );
    col.appendChild(divider(10));
    col.appendChild(
      tapRow(
        "Usual payday",
        Prefs.salaryDayLabel(),
        "Change",
        () => pickDay(1, 28, Prefs.salaryDay(), "Salary day", (v) => Prefs.setSalaryDay(v), ctx, true)
      )
    );
    col.appendChild(divider(10));
    col.appendChild(
      toggleRow(
        "Month-end summary",
        "Shows what you spent and moves the leftover into savings",
        Prefs.monthEndOn(),
        (on) => Prefs.setMonthEndOn(on)
      )
    );
    col.appendChild(divider(10));
    col.appendChild(
      toggleRow(
        "Daily budget check",
        "Tells you when your spending gets close to the limit",
        Prefs.dailyOn(),
        (on) => Prefs.setDailyOn(on)
      )
    );
    col.appendChild(divider(10));
    const [dh, dm] = Prefs.dailyTime();
    col.appendChild(
      tapRow("Daily check time", timeLabel(dh, dm), "Change", () => pickTime(ctx))
    );
    col.appendChild(divider(10));
    col.appendChild(
      toggleRow(
        "Pending money reminder",
        "Every Monday, if money is still to settle",
        Prefs.pendingOn(),
        (on) => Prefs.setPendingOn(on)
      )
    );
    col.appendChild(divider(10));
    col.appendChild(
      toggleRow(
        "Weekly bill check",
        "Once a week, lists rent, electricity, wifi and the rest you have not marked paid",
        Prefs.billWeeklyOn(),
        (on) => {
          Prefs.setBillWeeklyOn(on);
          if (on) Prefs.setLastBillWeekly("");
        }
      )
    );
    col.appendChild(divider(10));
    const pct = Math.round(Prefs.threshold() * 100);
    col.appendChild(
      tapRow("Warn me at", `${pct}% of the limit used`, "Change", () => pickThreshold(ctx))
    );
  });
  s.button("Allow browser notifications", {
    onClick: async () => {
      const ok = await askPermission();
      toast(ok ? "Notifications allowed" : "Notifications not allowed");
      if (ok) Scheduler.run();
    },
  });
  s.button("Turn all reminders off", {
    danger: true,
    onClick: () => {
      Prefs.setSalaryOn(false);
      Prefs.setMonthEndOn(false);
      Prefs.setDailyOn(false);
      Prefs.setPendingOn(false);
      Prefs.setCommonOn(false);
      Prefs.setBillWeeklyOn(false);
      toast("All reminders off");
      ctx.refresh();
    },
  });

  // ---- the early-month common payments nudge ----
  s.section("Common payments");
  s.card((c) => {
    const col = c.vstack();
    c.add(col);
    col.appendChild(
      toggleRow(
        "Remind me about common payments",
        "One nudge in the first few days of the month, instead of a reminder for each bill",
        Prefs.commonOn(),
        (on) => {
          Prefs.setCommonOn(on);
          Scheduler.run();
        }
      )
    );
    col.appendChild(divider(10));
    const until = Prefs.commonUntilDay();
    const inWindow = Repo.commonBills(Fmt.thisMonth(), until);
    col.appendChild(
      tapRow(
        "Window closes on day",
        inWindow.length > 0
          ? `${inWindow.length} ${inWindow.length === 1 ? "bill" : "bills"} fall on or before day ${until}: ${inWindow.map((b) => b.name).join(", ")}`
          : `Bills due on or before day ${until}`,
        "Change",
        () => pickDay(1, 28, until, "Window closes on day", (v) => Prefs.setCommonUntilDay(v), ctx)
      )
    );
  });
  s.note(
    "A bill counts as a common payment when it is due on or before that day. The reminder only appears if something in the window is still unpaid."
  );

  // ---- room ----
  s.section("Room");
  s.card((c) => {
    const names = Repo.roomPeople();
    c.add(c.label("People sharing", 14.5, "ink", true));
    c.add(c.sub(names.join(", "), 12.5), 4);
  });
  s.button("Go to the Room page", { onClick: () => ctx.open(Pages.ROOM) });

  // ---- categories ----
  s.section("Spending categories");
  s.card((c) => c.add(c.sub(Repo.cats().join(" · "), 12.5)));
  s.button("Manage categories", { onClick: () => Dialogs.manageCats(() => ctx.refresh()) });

  // ---- account ----
  s.section("Account");
  s.card((c) => {
    const row = c.hstack();
    const lbl = c.label("Signed in as", 14.5);
    lbl.style.flex = "1";
    row.appendChild(lbl);
    row.appendChild(c.label(Auth.email() || "—", 13.5, "brand", true));
    c.add(row);
    c.add(
      c.sub(
        "Your budget is kept in its own database on the server. Only this account can open it.",
        11.5
      ),
      6
    );
  });
  s.button("Change password", { onClick: () => changePassword(ctx) });
  s.button("Sign out", { onClick: () => signOut() });
  s.spacer(6);
  s.button("Delete my account", { danger: true, onClick: () => deleteAccount() });
  s.note(
    "Deleting removes the account and every entry, savings figure, person and bill with it. This cannot be undone."
  );

  // ---- data ----
  s.section("Your data");
  s.card((c) => {
    const txCount = Repo.txAll().length;
    const roomCount = Repo.roomAll().length;
    const peopleCount = Repo.people().length;
    c.add(
      c.sub(
        `${txCount} money entries · ${roomCount} room bills · ${peopleCount} people. Kept in your own database on the server.`,
        12.5
      )
    );
  });
  s.button("Erase everything", { danger: true, onClick: () => wipe() });
  s.note("Erasing removes all entries, savings, people and bills, but keeps your account. This cannot be undone.");
  s.spacer(10);
  s.note("Budget Planner · accounts on a shared server · version 1.0");

  return s;
}

// ------------------------------------------------------------------ small builders

/**
 * The payday panel: where the next month's salary is expected, what a leave
 * deduction did to it, and the one button that starts the month.
 */
function paydayCard(s, ctx) {
  const p = pendingSalary();
  const cut = p.cut;
  s.card((c) => {
    c.add(c.label("Next payday", 14.5, "ink", true));
    c.add(
      c.sub(
        p.pushed
          ? `${Fmt.monthLabel(p.month)} is expected on ${Fmt.dayLabel(p.dueOn)} - you changed this one month.`
          : `${Fmt.monthLabel(p.month)} is expected on ${Fmt.dayLabel(p.dueOn)}, your usual payday.`,
        12.5
      ),
      4
    );
    const bits = [`${Fmt.money(p.view.salary)} salary`];
    if (cut > 0) bits.push(`${Fmt.money(cut)} lost to leave this month only`);
    bits.push(`${Fmt.money(Math.max(0, p.view.salary - p.view.savingsTarget))} to spend`);
    c.add(c.sub(bits.join(" · "), 12), 8);
    if (p.waiting) {
      const b = c.button("Did your salary land?", {
        primary: true,
        onClick: () => askAboutSalary(ctx, p.month),
      });
      b.style.marginTop = "4px";
      c.add(b);
    } else {
      c.add(c.sub(`${Fmt.monthLabel(p.month)} started on ${Fmt.dayLabel(p.view.salaryPaidOn)}.`, 12), 8);
    }
  });
  if (p.pushed) {
    s.button("Go back to my usual payday", {
      onClick: () => {
        Repo.clearSalaryDue(p.month);
        Prefs.setLastSalaryAlert("");
        toast("Back to your usual payday");
        ctx.refresh();
      },
    });
  }
  if (cut > 0) {
    s.button("Remove this month's leave deduction", {
      onClick: () => {
        Repo.clearSalaryCutFor(p.month);
        toast("Back to your full salary for that month");
        ctx.refresh();
      },
    });
  }
}

function field(parent, title, value, hint, c) {
  const col = c.vstack();
  col.appendChild(c.label(title, 13.5));
  const v = c.big(value, 20, "brand");
  v.style.margin = "2px 0 1px";
  col.appendChild(v);
  col.appendChild(c.sub(hint, 11.5));
  parent.appendChild(col);
}

function divider(top) {
  const d = h("div");
  d.style.cssText = `height:1px;background:var(--line);margin-top:${top}px`;
  return d;
}

function tapRow(title, value, action, onClick) {
  const row = h("div", "flexrow");
  const col = h("div", "stack");
  col.style.flex = "1";
  col.appendChild(h("div", "label", title));
  col.appendChild(h("div", "sub", value));
  row.appendChild(col);
  const b = h("button", "btn ghost sm", action);
  b.type = "button";
  b.style.cssText = "flex:0 0 92px;text-align:center;margin:0";
  b.addEventListener("click", onClick);
  row.appendChild(b);
  return row;
}

// ------------------------------------------------------------------ actions


function editName(ctx) {
  const f = new Form();
  const n = f.text("Your name", "e.g. Arun", Auth.name());
  formDialog("Your name", f, async () => {
    const v = textOf(n);
    if (!v) return "Enter a name";
    try {
      await Auth.setName(v);
    } catch (e) {
      return e && e.message ? e.message : "Could not save your name";
    }
    ctx.refresh();
    return null;
  });
}


function changePassword(ctx) {
  const f = new Form();
  const cur = f.text("Current password", "the password you sign in with");
  const a = f.text("New password", "at least 8 characters");
  const b = f.text("Repeat password", "type it again");
  formDialog("Change password", f, async () => {
    if (!cur.value) return "Enter your current password";
    if (a.value.length < 8) return "Use at least 8 characters";
    if (a.value !== b.value) return "The two passwords don't match";
    try {
      await Auth.changePassword(cur.value, a.value);
    } catch (e) {
      return e && e.message ? e.message : "Could not change your password";
    }
    toast("Password changed");
    ctx.refresh();
    return null;
  });
}

/** Back to the sign-in screen. The shell owns the actual sign-out. */
function signOut() {
  window.BudgetPlanner?.signOut?.();
}

/** Ask the server to delete the account and its database, then start over. */
function deleteAccount() {
  ask(
    "Delete your account?",
    "Your account, every entry, savings figure, person and bill will be permanently removed. This cannot be undone.",
    {
      okLabel: "Delete",
      danger: true,
      onOk: async () => {
        try {
          const res = await fetch("/api/account", {
            method: "DELETE",
            credentials: "same-origin",
          });
          if (!res.ok) throw new Error();
        } catch {
          toast("Could not delete your account");
          return;
        }
        location.reload();
      },
    }
  );
}

/**
 * A numbered day picker, 1 to 28 so every month has the date.
 *
 * `withLastDay` adds "the last day of the month" as an option, which is what the
 * payday setting wants. The common-payments window does not, because a window
 * that closes at "the end of the month" is not something worth choosing.
 */
function pickDay(from, to, current, title, onPick, ctx, withLastDay = false) {
  // 0 stands for the last day, kept as its own value rather than a number
  const values = withLastDay ? [0] : [];
  for (let i = from; i <= to; i++) values.push(i);
  const label = (v) => (v === 0 ? "The last day of the month" : `Day ${v}`);
  let sel = Math.max(0, values.indexOf(current === 0 ? 0 : current));
  openSheet(title, (sh) => {
    const card = h("div", "card");
    card.style.padding = "0";
    values.forEach((v, i) => {
      const b = h("button", "lrow tappable");
      b.type = "button";
      const mid = h("div", "mid");
      mid.appendChild(h("div", "t", label(v)));
      if (v === 0) mid.appendChild(h("div", "s", "Changes length with the month"));
      b.appendChild(mid);
      if (i === sel) {
        const tick = h("div", "amt", "✓");
        tick.style.color = tone("brand");
        b.appendChild(tick);
      }
      b.addEventListener("click", () => {
        sel = i;
        onPick(v);
        Prefs.setLastSalaryAlert("");
        closeAll();
        ctx.refresh();
      });
      card.appendChild(b);
    });
    sh.add(card);
  });
}

function closeAll() {
  document.querySelector(".modal-root .sheet-x")?.click();
}

/** "9:30 am", the way the time is written everywhere else in the app. */
function timeLabel(h, m) {
  const ampm = h >= 12 ? "pm" : "am";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

/**
 * Half-hourly slots through the day, in a sheet that looks like the rest of the
 * app. A native time box brings up the browser's own panel, which is neither
 * themed nor reachable the same way on every device.
 */
function pickTime(ctx) {
  const [h0, m0] = Prefs.dailyTime();
  const values = [];
  for (let hour = 5; hour <= 23; hour++) {
    for (const minute of [0, 30]) values.push([hour, minute]);
  }
  let sel = Math.max(
    0,
    values.findIndex(([h, m]) => h === h0 && (m0 >= 30 ? m === 30 : m === 0))
  );
  openSheet("Daily check time", (sh) => {
    const card = h("div", "card");
    card.style.padding = "0";
    values.forEach(([hour, minute], i) => {
      const b = h("button", "lrow tappable");
      b.type = "button";
      const mid = h("div", "mid");
      mid.appendChild(h("div", "t", timeLabel(hour, minute)));
      b.appendChild(mid);
      if (i === sel) {
        const tick = h("div", "amt", "✓");
        tick.style.color = tone("brand");
        b.appendChild(tick);
      }
      b.addEventListener("click", () => {
        Prefs.setDailyTime(hour, minute);
        Prefs.setLastSalaryAlert("");
        closeAll();
        ctx.refresh();
      });
      card.appendChild(b);
    });
    sh.add(card);
  });
}

function pickThreshold(ctx) {
  const opts = [50, 60, 70, 75, 80, 85, 90, 95, 100];
  let sel = Math.max(0, opts.findIndex((x) => x >= Prefs.threshold() * 100));
  openSheet("Warn me when I reach", (sh) => {
    const card = h("div", "card");
    card.style.padding = "0";
    opts.forEach((pct, i) => {
      const b = h("button", "lrow tappable");
      b.type = "button";
      const mid = h("div", "mid");
      mid.appendChild(h("div", "t", `${pct}% used`));
      b.appendChild(mid);
      if (i === sel) {
        const tick = h("div", "amt", "✓");
        tick.style.color = tone("brand");
        b.appendChild(tick);
      }
      b.addEventListener("click", () => {
        Prefs.setThreshold(pct / 100);
        closeAll();
        toast(`Warn at ${pct}% used`);
        ctx.refresh();
      });
      card.appendChild(b);
    });
    sh.add(card);
  });
}

function wipe() {
  ask(
    "Erase everything?",
    "All entries, savings, people and bills will be deleted. Your account and password stay. This cannot be undone.",
    {
      okLabel: "Erase",
      danger: true,
      onOk: async () => {
        try {
          const res = await fetch("/api/account/wipe", {
            method: "POST",
            credentials: "same-origin",
          });
          if (!res.ok) throw new Error();
        } catch {
          toast("Could not erase your data");
          return;
        }
        location.reload();
      },
    }
  );
}
