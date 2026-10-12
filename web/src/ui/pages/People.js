// Budget Planner - People.
// Mirrors app/src/main/java/com/budgetplanner/ui/PeopleFragment.kt.
//
// Every person the app knows, with what they owe you and what you owe them,
// across all months. Gifts get their own line and their own filter, because a
// gift is money that changed hands but is never owed.

import { Repo } from "../../data/Repo.js";
import { Fmt } from "../../util/Fmt.js";
import { Anim } from "../Anim.js";
import * as Dialogs from "../Dialogs.js";
import { ChipGroup, Form, amountOf, ask, formDialog, toast } from "../Form.js";
import { deleteButton, Screen, rowFor } from "../Kit.js";
import { Pages } from "../Pages.js";

let filter = "all";

export function build(ctx) {
  const s = new Screen();
  const sums = Repo.pendingPeople();
  const recv = Repo.openReceivable();
  const pay = Repo.openPayable();

  s.heroCard((c) => {
    c.add(c.label("TO GET BACK", 11, "ink", true));
    const num = c.big("", 32, "ink");
    num.style.marginTop = "4px";
    c.add(num);
    Anim.countUp(num, 0, recv, 850, Fmt.money);
    const owed = c.sub(
      `You owe ${Fmt.money(pay)} · ${sums.length} ${sums.length === 1 ? "person" : "people"}`,
      14
    );
    owed.style.marginTop = "2px";
    c.add(owed);
  });

  s.chips(
    [
      ["all", "Everyone"],
      ["owe_me", "They owe me"],
      ["owe_them", "I owe them"],
      ["net", "To settle"],
      ["gift", "Gifts"],
    ],
    filter,
    (k) => {
      filter = k;
      ctx.refresh();
    }
  );

  const shown = sums
    .filter((p) => {
      switch (filter) {
        case "owe_me":
          return p.theyOweMe > 0;
        case "owe_them":
          return p.iOweThem > 0;
        case "net":
          return p.net !== 0;
        case "gift":
          return p.giftTotal > 0;
        default:
          return true;
      }
    })
    .sort((a, b) => b.net - a.net || a.person.name.localeCompare(b.person.name));

  if (shown.length === 0) {
    s.empty(
      sums.length === 0 ? "Nobody owes you anything" : "Nothing here",
      sums.length === 0
        ? "Add someone the moment you give them money or borrow from them. " +
          "When the last entry with a person is settled, their name comes off this page " +
          "by itself - the old entries stay in History."
        : "No one matches this filter.",
      sums.length === 0 ? "Add money with a person" : null,
      () => ctx.open(Pages.ADD)
    );
  }

  for (const p of shown) {
    s.card((c) => {
      // ---- head: who they are, and the one number that matters ----
      const head = c.hstack();
      const av = document.createElement("div");
      av.className = "av";
      av.style.width = "42px";
      av.style.height = "42px";
      av.style.flex = "0 0 42px";
      av.style.borderRadius = "13px";
      av.textContent = Fmt.initials(p.person.name);
      av.style.color = p.net > 0 ? "var(--ok)" : p.net < 0 ? "var(--bad)" : "var(--muted)";
      av.style.background = p.net > 0 ? "var(--soft)" : "var(--card2)";
      head.appendChild(av);
      const nm = c.vstack();
      nm.style.flex = "1";
      nm.appendChild(c.label(p.person.name, 16.5, "ink", true));
      nm.appendChild(
        c.sub(
          p.net > 0
            ? `must pay you ${Fmt.money(p.net)}`
            : p.net < 0
            ? `you must pay ${Fmt.money(-p.net)}`
            : p.entries > 0
            ? "All settled up"
            : "No entries yet",
          12.5,
          p.net > 0 ? "ok" : p.net < 0 ? "bad" : "muted"
        )
      );
      head.appendChild(nm);
      const plus = c.button("+", { onClick: () => addFor(p.person.id, ctx) });
      plus.style.cssText = "width:44px;flex:0 0 44px;margin:0;padding:0;font-size:20px";
      head.appendChild(plus);
      c.add(head);

      // Both sides stay on show so the net figure can be checked.
      if (p.theyOweMe > 0 || p.iOweThem > 0) {
        const parts = [];
        if (p.theyOweMe > 0) parts.push(`they owe you ${Fmt.money(p.theyOweMe)}`);
        if (p.iOweThem > 0) parts.push(`you owe them ${Fmt.money(p.iOweThem)}`);
        c.add(c.sub(parts.join("   ·   "), 11.5), 8);
        if (p.net !== 0) {
          const b = c.button(`Settle up ${Fmt.money(Math.abs(p.net))}`, {
            primary: true,
            onClick: () => confirmSettle(p.person.name, p.net, ctx),
          });
          b.style.marginTop = "8px";
          c.add(b);
        }
      }

      // ---- the running totals, gifts included ----
      if (p.gaveTotal > 0 || p.receivedTotal > 0 || p.giftTotal > 0) {
        const stats = c.hstack();
        stats.style.marginTop = "12px";
        if (p.gaveTotal > 0) stat(stats, "gave them", Fmt.money(p.gaveTotal), "ink");
        if (p.receivedTotal > 0) stat(stats, "got from", Fmt.money(p.receivedTotal), "ink");
        if (p.giftTotal > 0) stat(stats, "gifted", Fmt.money(p.giftTotal), "muted");
        c.add(stats);
      }

      // ---- what is still open ----
      const open = Repo.txAll().filter((t) => t.personId === p.person.id && !t.settled);
      if (open.length > 0) {
        c.add(sep(), 10);
        for (const t of open.slice(0, 4)) {
          c.add(
            rowFor({
              avatar: Fmt.initials(p.person.name),
              title: entryTitle(t),
              subtitle: [Fmt.dayLabel(t.date), t.note].filter(Boolean).join(" · "),
              amount: Fmt.money(t.amount),
              amountColor: t.type === "gave" ? "warn" : "bad",
              avatarTone: "card2",
              avatarTextColor: "muted",
              onClick: () => Dialogs.txDetail(t.id),
              trailing: deleteButton(() => confirmDeleteEntry(t.id, ctx)),
            })
          );
        }
        if (open.length > 4) c.add(c.sub(`+ ${open.length - 4} more open`, 11.5), 6);
      }
    });
  }

  s.button("Add money with a person", { onClick: () => ctx.open(Pages.ADD) });

  return s;
}

/** "You gave", "You got", or the two gift words. */
function entryTitle(t) {
  if (t.type === "personal") return "Spent on them";
  if (t.type === "gave") return t.returnable ? "You gave" : "Gift given";
  return t.returnable ? "You got" : "Gift received";
}

function stat(parent, title, value, color) {
  const col = document.createElement("div");
  col.className = "stat";
  const k = document.createElement("div");
  k.className = "k";
  k.textContent = title;
  col.appendChild(k);
  const v = document.createElement("div");
  v.className = "v";
  v.textContent = value;
  v.style.color = color === "ink" ? "var(--ink)" : "var(--muted)";
  col.appendChild(v);
  parent.appendChild(col);
}

function sep() {
  const d = document.createElement("div");
  d.style.cssText = "height:1px;background:var(--line);margin:10px 0 4px";
  return d;
}

function confirmSettle(name, net, ctx) {
  const dir = net > 0 ? `${name} hands you ${Fmt.money(net)}` : `you hand ${name} ${Fmt.money(-net)}`;
  ask(`Settle up with ${name}?`, `${dir}\n\nBoth sides are added up first, so this is the only amount left to change hands. Every open entry between you, and any room bill you share, is closed, and the money is recorded as ${net > 0 ? "coming back to you" : "paid out"}.`, {
    okLabel: "Settle up",
    onOk: () => {
      Repo.settleAllWith(name);
      toast(`Settled up with ${name}`);
      ctx.refresh();
    },
  });
}

/** A quick add for somebody already on the list. */
function addFor(personId, ctx) {
  const f = new Form();
  const amt = f.money("Amount");
  const dir = f.chips("Direction", ["I gave", "I borrowed"], 0, () => {});
  f.setDate(Fmt.today());
  f.dateField("Date");
  f.note('"I gave" means they owe you. "I borrowed" means you owe them.');
  formDialog(`Add with ${Repo.personName(personId)}`, f, () => {
    const a = amountOf(amt);
    if (a <= 0) return "Enter an amount";
    const type = dir.value === 0 ? "gave" : "borrowed";
    Repo.addTx({
      id: Fmt.uid(),
      type,
      amount: a,
      personId,
      date: f.date,
      returnable: type === "borrowed",
    });
    ctx.refresh();
    return null;
  });
}

/** Asks once, then removes. Same wording as the other lists. */
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
