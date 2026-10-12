// Budget Planner - More.
// The fourth tab. Everything that is not one of the three things you do most
// often lives here, so the tab bar stays at four and the app still has a home
// for every page.

import { Repo } from "../../data/Repo.js";
import { Prefs } from "../../notify/Prefs.js";
import { Fmt } from "../../util/Fmt.js";
import * as Dialogs from "../Dialogs.js";
import { editDefaults, editOpening } from "../Defaults.js";
import { toast } from "../Form.js";
import { h, Screen } from "../Kit.js";
import { Pages } from "../Pages.js";
import { askAboutSalary, pendingSalary } from "../Salary.js";

export function build(ctx) {
  const s = new Screen();
  const m = ctx.month;

  // ---- the one number worth seeing here ----
  const recv = Repo.openReceivable();
  const pay = Repo.openPayable();
  const room = Repo.roomNetTotal();
  s.card((c) => {
    c.add(c.label("Still to settle", 13.5, "muted"));
    const line = c.hstack();
    line.style.marginTop = "6px";
    const bits = [];
    if (recv > 0) bits.push([`${Fmt.money(recv)}`, "to get back", "ok"]);
    if (pay > 0) bits.push([`${Fmt.money(pay)}`, "to return", "bad"]);
    if (room !== 0) bits.push([Fmt.money(Math.abs(room)), room > 0 ? "room owes you" : "you owe room", room > 0 ? "warn" : "bad"]);
    if (bits.length === 0) {
      c.add(c.big("All square", 26, "ok"));
      c.add(c.sub("Nothing is waiting to be settled", 12.5), 4);
    } else {
      bits.forEach((b, i) => {
        if (i > 0) {
          const sep = h("div");
          sep.style.cssText = "width:1px;align-self:stretch;background:var(--line);margin:0 12px";
          line.appendChild(sep);
        }
        const col = h("div", "stack");
        col.style.flex = "1";
        const v = c.big(b[0], 18, b[2]);
        col.appendChild(v);
        col.appendChild(c.sub(b[1], 11.5));
        line.appendChild(col);
      });
      c.add(line);
    }
  });

  // ---- the payday, because it decides whether any of this matters yet ----
  const p = pendingSalary();
  if (p.waiting) {
    s.section("Payday");
    s.listCard((col) => {
      col.add(
        row({
          avatar: "?",
          title: `${Fmt.monthLabel(p.month)} is waiting`,
          subtitle: `Expected ${Fmt.dayLabel(p.dueOn)}`,
          amount: "SET UP",
          amountColor: "brand",
          onClick: () => askAboutSalary(ctx, p.month),
        })
      );
    });
  }

  // ---- everything else ----
  s.section("Money");
  s.listCard((col) => {
    const items = [
      {
        icon: "◧",
        title: "Current balance",
        subtitle: `${Fmt.money(Repo.spendableLimit(m))} safe to spend in ${Fmt.monthLabel(m)}`,
        page: Pages.BALANCE,
      },
      {
        icon: "↑",
        title: "Savings",
        subtitle: `${Fmt.money(Repo.savingsBalance())} saved`,
        page: Pages.SAVINGS,
      },
      {
        icon: "≡",
        title: "All money entries",
        subtitle: `${Repo.txAll().length} entries`,
        page: Pages.MONEY,
      },
      {
        icon: "?",
        title: "Money I need",
        subtitle: `${Repo.openNeeds().length} still to collect`,
        page: Pages.NEED,
      },
    ];
    items.forEach((it, i) => {
      if (i > 0) col.divider();
      col.add(
        row({
          avatar: it.icon,
          title: it.title,
          subtitle: it.subtitle,
          onClick: () => ctx.open(it.page),
        })
      );
    });
  });

  // ---- the numbers you put right by hand ----
  // A salary change, cash that was already in your pocket, savings, and
  // borrowing from before the app existed. All four are things you know and the
  // app does not, so all four get an edit button right here rather than
  // somewhere under Settings.
  s.section("Edit your numbers");
  const spent = Repo.monthSum(m).personal;
  const inHand = Repo.monthCfg(m).salary + Repo.monthCfg(m).opening - spent;
  const edits = [
    {
      title: "Current salary",
      value: `${Fmt.money(Repo.monthCfg(m).salary)} for ${Fmt.monthLabel(m)}`,
      action: "Edit",
      onClick: () => editDefaults(ctx),
    },
    {
      title: "Money in hand",
      value: `${Fmt.money(inHand)} after ${Fmt.money(spent)} spent`,
      action: "Edit",
      onClick: () => editOpening(ctx, m),
    },
    {
      title: "Savings",
      value: `${Fmt.money(Repo.savingsBalance())} saved`,
      action: "Add",
      onClick: () => Dialogs.savingsMove("in"),
    },
    {
      title: "Old borrowings",
      value: `${Fmt.money(Repo.openReceivable())} to get back`,
      action: "Add",
      onClick: () => Dialogs.oldEntry(() => ctx.refresh(), "borrowed"),
    },
  ];
  s.card((c) => {
    const rows = c.vstack();
    c.add(rows);
    edits.forEach((it, i) => {
      if (i > 0) {
        const d = h("div");
        d.style.cssText = "height:1px;background:var(--line);margin:10px 0";
        rows.appendChild(d);
      }
      rows.appendChild(editRow(it));
    });
  });
  s.note(
    "Use these when reality is different from the app: a new salary, cash you " +
      "already had, money moved into savings, or something you borrowed before " +
      "you started using Budget Planner."
  );

  s.section("Sharing");
  s.listCard((col) => {
    const items = [
      {
        icon: "⌂",
        title: "Room",
        subtitle: Repo.roomPeople().join(", "),
        page: Pages.ROOM,
      },
      {
        icon: "♻",
        title: "Bills",
        subtitle: `${Repo.activeBills().length} active`,
        page: Pages.BILLS,
      },
    ];
    items.forEach((it, i) => {
      if (i > 0) col.divider();
      col.add(
        row({
          avatar: it.icon,
          title: it.title,
          subtitle: it.subtitle,
          onClick: () => ctx.open(it.page),
        })
      );
    });
  });

  s.section("Settings");
  s.listCard((col) => {
    // History is a tab of its own now, so it is not repeated here
    const items = [
      { icon: "⚙", title: "Profile", subtitle: "Name, salary, reminders, app lock", page: Pages.PROFILE },
    ];
    items.forEach((it, i) => {
      if (i > 0) col.divider();
      col.add(
        row({
          avatar: it.icon,
          title: it.title,
          subtitle: it.subtitle,
          onClick: () => ctx.open(it.page),
        })
      );
    });
  });

  // ---- small things worth doing from here ----
  s.section("Quick actions");
  s.buttonRow(
    s.buildButton("Manage bills", { onClick: () => Dialogs.billEdit(null) }),
    s.buildButton("Categories", { onClick: () => Dialogs.manageCats(() => ctx.refresh()) })
  );
  s.button("Remind me about common payments", {
    onClick: () => {
      const on = !Prefs.commonOn();
      Prefs.setCommonOn(on);
      toast(on ? "Common payment reminder on" : "Common payment reminder off");
      ctx.refresh();
    },
  });

  s.spacer(10);
  s.note("Budget Planner · local only · nothing leaves this device");
  return s;
}

/**
 * A label, the value it currently holds, and a button that changes it. Not a
 * tappable row with a button inside it: the button is the whole point, so it
 * is the only thing that can be pressed.
 */
function editRow({ title, value, action, onClick }) {
  const wrap = h("div", "flexrow");
  const col = h("div", "stack");
  col.style.flex = "1";
  col.appendChild(h("div", "label", title));
  col.appendChild(h("div", "sub", value));
  wrap.appendChild(col);
  const b = h("button", "btn ghost sm", action);
  b.type = "button";
  b.style.cssText = "flex:0 0 92px;text-align:center;margin:0";
  b.addEventListener("click", onClick);
  wrap.appendChild(b);
  return wrap;
}

function row({ avatar, title, subtitle, amount, amountColor = "ink", onClick }) {
  const outer = h(onClick ? "button" : "div", "lrow" + (onClick ? " tappable" : ""));
  if (onClick) {
    outer.type = "button";
    outer.addEventListener("click", onClick);
  }
  if (avatar != null) {
    const av = h("div", "av", avatar);
    av.style.background = "var(--card2)";
    av.style.color = "var(--muted)";
    outer.appendChild(av);
  }
  const mid = h("div", "mid");
  mid.appendChild(h("div", "t", title));
  if (subtitle) mid.appendChild(h("div", "s", subtitle));
  outer.appendChild(mid);
  if (amount) {
    const a = h("div", "amt", amount);
    a.style.color = `var(--${amountColor})`;
    outer.appendChild(a);
  }
  return outer;
}
