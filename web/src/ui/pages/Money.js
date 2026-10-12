// Budget Planner - Money.
// Mirrors app/src/main/java/com/budgetplanner/ui/MoneyFragment.kt.
//
// Every money entry in one list: spending, lending and borrowing. A gift is
// labelled as one, so it never gets mistaken for something still owed.

import { Repo } from "../../data/Repo.js";
import { Fmt } from "../../util/Fmt.js";
import { deleteButton, gap, Screen, rowFor } from "../Kit.js";
import { ask, toast } from "../Form.js";
import * as Dialogs from "../Dialogs.js";
import { Pages } from "../Pages.js";

let filter = "month";

export function build(ctx) {
  const s = new Screen();
  const m = ctx.month;

  s.chips(
    [
      ["month", Fmt.monthLabel(m)],
      ["all", "All months"],
      ["personal", "Spending"],
      ["gave", "Gave"],
      ["borrowed", "Borrowed"],
      ["room", "Room"],
      ["open", "Still open"],
      ["gift", "Gifts"],
    ],
    filter,
    (k) => {
      filter = k;
      ctx.refresh();
    }
  );

  const sum = Repo.monthSum(m);
  s.kpi("Spent", Fmt.money(sum.personal), "this month", "ink");
  s.add(gap());
  s.kpi("Given out", Fmt.money(sum.gaveAll), "this month", "warn");
  s.add(gap());
  s.kpi(
    "To settle",
    Fmt.money(Repo.openReceivable() + Repo.openPayable()),
    "all months",
    "brand"
  );

  const list = Repo.txAll().filter((t) => {
    switch (filter) {
      case "all":
        return true;
      case "personal":
      case "gave":
      case "borrowed":
        return t.type === filter;
      case "room":
        return Repo.isRoomTx(t);
      case "open":
        return t.type !== "personal" && !t.settled;
      case "gift":
        return Repo.isGiftTx(t);
      default:
        return Fmt.monthKey(t.date) === m;
    }
  });
  const monthFiltered = filter === "month";
  const total = list.filter((t) => t.type === "personal").reduce((a, t) => a + t.amount, 0);

  s.section(monthFiltered ? Fmt.monthLabel(m) : "All entries");
  if (list.length === 0) {
    s.empty(
      "Nothing here yet",
      "Everything you add - spending, money you gave and money you borrowed - shows up in this list.",
      "Add an entry",
      () => ctx.open(Pages.ADD)
    );
    return s;
  }

  s.listCard((lc) => {
    list.slice(0, 60).forEach((t, i) => {
      if (i > 0) lc.divider();
      lc.add(
        rowFor({
          avatar: Fmt.initials(
            t.type === "personal" ? t.category || "?" : Repo.personName(t.personId)
          ),
          title: entryName(t),
          subtitle: entryBits(t, monthFiltered),
          amount: Fmt.money(t.amount),
          amountColor: t.type === "gave" ? "warn" : t.type === "borrowed" ? "bad" : "ink",
          avatarTone: t.type === "personal" ? "soft" : "card2",
          avatarTextColor: t.type === "personal" ? "brand" : "muted",
          onClick: () => Dialogs.txDetail(t.id),
          trailing: deleteButton(() => confirmDeleteEntry(t.id, ctx)),
        })
      );
    });
  });

  s.note(
    `${list.length} ${list.length === 1 ? "entry" : "entries"}` +
      (total > 0 ? ` · ${Fmt.money(total)} of spending here` : "")
  );
  if (list.length > 60) s.note("Showing the first 60. Use the filters above to narrow it down.");

  s.button("Add an entry", { onClick: () => ctx.open(Pages.ADD) });

  // ---- spending by category ----
  const byCat = Object.entries(
    Repo.txInMonth(m)
      .filter((t) => t.type === "personal")
      .reduce((acc, t) => {
        const k = t.category || "Other";
        acc[k] = (acc[k] || 0) + t.amount;
        return acc;
      }, {})
  ).sort((a, b) => b[1] - a[1]);
  if (byCat.length > 0) {
    s.section("Spending by category");
    const top = byCat[0][1];
    s.listCard((lc) => {
      byCat.forEach(([cat, amt], i) => {
        if (i > 0) lc.divider();
        const row = document.createElement("div");
        const col = document.createElement("div");
        col.style.flex = "1";
        const lbl = document.createElement("div");
        lbl.className = "label";
        lbl.textContent = cat;
        col.appendChild(lbl);
        const bar = new Screen().bar(amt / top);
        bar.style.margin = "5px 0 3px";
        col.appendChild(bar);
        row.appendChild(col);
        const v = document.createElement("div");
        v.className = "big";
        v.style.fontSize = "14.5px";
        v.style.paddingLeft = "10px";
        v.textContent = Fmt.money(amt);
        row.appendChild(v);
        row.style.display = "flex";
        row.style.alignItems = "center";
        lc.add(row);
      });
    });
  }

  s.section("Room and savings");
  s.kpi("Room paid by you", Fmt.money(sum.roomPaidByMe), Fmt.monthLabel(m), "ok", () =>
    ctx.open(Pages.ROOM)
  );
  s.add(gap());
  s.kpi("Room owes you", Fmt.money(sum.roomOwedToMe), Fmt.monthLabel(m), "warn", () =>
    ctx.open(Pages.ROOM)
  );
  s.add(gap());
  s.kpi("Saved", Fmt.money(sum.saved), Fmt.monthLabel(m), "brand", () => ctx.open(Pages.SAVINGS));

  return s;
}

function entryName(t) {
  if (t.type === "gave") {
    return t.returnable ? `Gave ${Repo.personName(t.personId)}` : `Gift to ${Repo.personName(t.personId)}`;
  }
  if (t.type === "borrowed") {
    return t.returnable
      ? `Borrowed from ${Repo.personName(t.personId)}`
      : `Gift from ${Repo.personName(t.personId)}`;
  }
  // spending that was for somebody carries the person, so name them
  if (t.personId) return `${t.category || "Spending"} · for ${Repo.personName(t.personId)}`;
  return t.category || "Spending";
}

function entryBits(t, monthFiltered) {
  const bits = [];
  if (!monthFiltered) bits.push(Fmt.monthLabel(Fmt.monthKey(t.date)));
  bits.push(Fmt.dayLabel(t.date));
  if (t.note) bits.push(t.note);
  if (t.fromSavings) bits.push("from savings");
  // the gift label, whichever way it went
  if (t.type === "gave" && !t.returnable) bits.push("gift");
  if (t.type === "borrowed" && !t.returnable) bits.push("gift");
  if (t.type === "personal" && t.personId) bits.push("gift to them");
  if (t.type !== "personal" && t.settled) bits.push("settled");
  return bits.filter(Boolean).join(" · ");
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
