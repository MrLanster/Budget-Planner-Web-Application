// Budget Planner - Room.
// Mirrors app/src/main/java/com/budgetplanner/ui/RoomFragment.kt.
//
// Shared household bills, kept completely separate from personal spending. The
// roommate list here is the same list the Profile page edits, and the same one
// the Add page offers when picking a person.

import { Cats } from "../../data/Models.js";
import { Repo } from "../../data/Repo.js";
import { Fmt } from "../../util/Fmt.js";
import { Anim } from "../Anim.js";
import * as Dialogs from "../Dialogs.js";
import { ask, toast } from "../Form.js";
import { Screen, gap, rowFor } from "../Kit.js";

export function build(ctx) {
  const s = new Screen();
  const m = ctx.month;
  const bills = Repo.roomInMonth(m);
  const total = bills.reduce((a, b) => a + b.amount, 0);
  const paidByMe = bills.filter((b) => b.paidBy === Cats.ME).reduce((a, b) => a + b.amount, 0);
  const myShare = bills.reduce((a, b) => a + Repo.share(b), 0);

  // Balance what each roommate owes you against what you owe them, so there is
  // one figure per person and that is all there is to settle.
  const nets = Repo.roomNets();
  const theyOweMe = nets.filter((n) => n.net > 0).reduce((a, n) => a + n.net, 0);
  const iOweThem = nets.filter((n) => n.net < 0).reduce((a, n) => a - n.net, 0);

  s.heroCard((c) => {
    c.add(c.label(`ROOM TOTAL · ${Fmt.monthLabel(m).toUpperCase()}`, 11, "ink", true));
    const num = c.big("", 34, "ink");
    num.style.marginTop = "4px";
    c.add(num);
    Anim.countUp(num, 0, total, 800, Fmt.money);
    c.add(
      c.sub(
        `${bills.length} shared bill${bills.length === 1 ? "" : "s"} · your share ${Fmt.money(myShare)}`,
        12
      )
    );
  });

  s.section("Summary");
  s.kpi("You paid", Fmt.money(paidByMe), "this month", "ok");
  s.add(gap());
  s.kpi("Owes you", Fmt.money(theyOweMe), "after balancing both ways", "warn");
  s.add(gap());
  s.kpi("You owe", Fmt.money(iOweThem), "after balancing both ways", "bad");

  s.section("Who owes whom");
  if (nets.length === 0) {
    s.note(
      "Add a roommate and this will show what each of them still owes you, with what you owe them already taken off."
    );
    s.button("+ Add roommate", { primary: true, onClick: () => Dialogs.roomPeople(() => ctx.refresh()) });
  } else {
    s.card((c) => {
      nets.forEach((n, i) => {
        if (i > 0) c.add(divider());
        const row = c.vstack();
        if (i > 0) row.style.marginTop = "12px";
        const top = c.hstack();
        const who = c.vstack();
        who.style.flex = "1";
        who.appendChild(c.label(n.name, 14.5, "ink", true));
        who.appendChild(
          c.sub(
            n.net > 0
              ? "must pay you back"
              : n.net < 0
              ? "you must pay them"
              : "all square with each other",
            11.5
          )
        );
        top.appendChild(who);
        top.appendChild(
          c.big(n.net === 0 ? Fmt.money(0) : Fmt.money(Math.abs(n.net)), 16, n.net > 0 ? "ok" : n.net < 0 ? "bad" : "muted")
        );
        row.appendChild(top);

        // both sides on show, so the net figure can be checked
        const parts = [];
        if (n.theyOweMe > 0) parts.push(`they owe you ${Fmt.money(n.theyOweMe)}`);
        if (n.iOweThem > 0) parts.push(`you owe them ${Fmt.money(n.iOweThem)}`);
        row.appendChild(c.sub(parts.length === 0 ? "nothing open" : parts.join("  ·  "), 11.5), 4);
        c.add(row);
      });
    });
    s.button("+ Add roommate", { onClick: () => Dialogs.roomPeople(() => ctx.refresh()) });
    s.note(
      "Each room bill is split equally, so only your roommate's share is counted. What they owe you and what you owe them are totalled up and the larger one is what is left to settle."
    );
  }

  s.section("People in the room");
  s.card((c) => {
    const row = c.hstack();
    const names = c.vstack();
    names.style.flex = "1";
    const people = Repo.roomPeople();
    names.appendChild(c.label(people.join(", "), 14.5, "ink", true));
    names.appendChild(
      c.sub(`${people.length} ${people.length === 1 ? "person" : "people"} sharing`, 11.5)
    );
    row.appendChild(names);
    const edit = c.button("Edit", { ghost: true, onClick: () => Dialogs.roomPeople(() => ctx.refresh()) });
    edit.style.width = "auto";
    edit.style.flex = "0 0 auto";
    edit.style.padding = "10px 18px";
    row.appendChild(edit);
    c.add(row);
  });
  s.button("+ Add room bill", { primary: true, onClick: () => Dialogs.roomBill() });

  s.section("Bills this month");
  if (bills.length === 0) {
    s.empty(
      "No room bills yet",
      "Add electricity, rent, water or groceries here. They stay separate from your personal spending, and the app works out each person's share.",
      "+ Add room bill",
      () => Dialogs.roomBill()
    );
  } else {
    s.listCard((lc) => {
      bills.forEach((r, i) => {
        if (i > 0) lc.divider();
        const n = r.splitWith.length;
        const others = r.splitWith.filter((x) => x !== r.paidBy);
        const bits = [Fmt.dayLabel(r.date), `paid by ${r.paidBy}`, `each ${Fmt.money(Repo.share(r))}`];
        if (r.paidBy !== Cats.ME && others.length > 0) {
          bits.push(`${others.join(", ")} owe you`);
        }
        lc.add(
          rowFor({
            avatar: n > 1 ? `${n}x` : "1",
            title: r.note || "Shared bill",
            subtitle: bits.join(" · "),
            amount: Fmt.money(r.amount),
            amountColor: r.paidBy === Cats.ME ? "ok" : "warn",
            avatarTone: "soft",
            avatarTextColor: "brand",
            onClick: () => Dialogs.roomDetail(r),
          })
        );
      });
    });
  }

  const unsettled = nets.filter((n) => !n.settledUp);
  if (unsettled.length > 0) {
    s.section("Settle up");
    s.card((c) => {
      unsettled.forEach((n, i) => {
        const b = c.button(`Mark settled with ${n.name} (${Fmt.money(Math.abs(n.net))})`, {
          primary: i === 0,
          onClick: () => confirmSettle(n.name, n.net, ctx),
        });
        if (i > 0) b.style.marginTop = "8px";
        c.add(b);
      });
    });
    s.note(
      "Settling closes off the open room bills with that person. It records that the money changed hands, it does not move any."
    );
  }

  return s;
}

function divider() {
  const d = document.createElement("div");
  d.style.cssText = "height:1px;background:var(--line);margin:10px 0";
  return d;
}

function confirmSettle(name, net, ctx) {
  const dir = net > 0 ? `${name} pays you ${Fmt.money(net)}` : `You pay ${name} ${Fmt.money(-net)}`;
  ask(`Settle with ${name}?`, `${dir}. Every open room bill you share with ${name} will be marked settled.`, {
    okLabel: "Mark settled",
    onOk: () => {
      Repo.settleRoomWith(name);
      toast(`Settled with ${name}`);
      ctx.refresh();
    },
  });
}
