// Budget Planner - History.
// Mirrors app/src/main/java/com/budgetplanner/ui/HistoryFragment.kt.
//
// Everything ever added, in one list that can be narrowed down. Filtering by
// kind, period, category, person or a free-text search, and the totals at the
// top always describe whatever actually matched.

import { Repo } from "../../data/Repo.js";
import { Fmt } from "../../util/Fmt.js";
import * as Dialogs from "../Dialogs.js";
import { deleteButton, gap, h, rowFor, Screen, toggleRow } from "../Kit.js";
import { ask, toast } from "../Form.js";
import { openCalendar } from "../Calendar.js";
import { Pages } from "../Pages.js";

/** Kept outside the page so narrowing the list does not lose the filters. */
const f = {
  kind: "all",
  // "none" | "person" | "category": which one of the two narrowing questions is
  // being asked, so the page only ever shows the list that means something
  narrow: "none",
  fromDate: "",
  toDate: "",
  // picking Custom asks for dates, so the chip stays lit even while both
  // bounds are still blank
  custom: false,
  category: "",
  person: "",
  text: "",
  matchCase: false,
  openOnly: false,
  show: 120,
};

const PRESETS = [
  ["any", "All time"],
  ["this", "Month to date"],
  ["last", "Last month"],
  ["3m", "Last 3 months"],
  ["6m", "Last 6 months"],
  ["year", "This year"],
  ["custom", "Custom"],
];

export function build(ctx) {
  const s = new Screen();
  const people = Repo.people().map((p) => p.name);
  const cats = Repo.cats();

  // A category filter only means something for spending, and a person filter
  // only for lending/borrowing/room. Drop the ones that cannot match instead of
  // keeping them and showing totals that are quietly wrong.
  if (f.category && !cats.includes(f.category)) f.category = "";
  if (f.person && !people.includes(f.person)) f.person = "";

  // ---- when ----
  s.section("Time period");
  s.chips(PRESETS, activePreset(), (k) => {
    applyPreset(k);
    f.show = 120;
    ctx.refresh();
  });
  if (activePreset() === "custom") {
    s.card((c) => {
      const row = c.hstack();
      row.appendChild(
        rangeButton("From", f.fromDate, () => {
          pickDate(true, ctx);
        })
      );
      row.appendChild(
        rangeButton("To", f.toDate, () => {
          pickDate(false, ctx);
        })
      );
      c.add(row);
      c.add(c.sub(`Showing ${Fmt.dayLabel(f.fromDate) || "the start"} to ${Fmt.dayLabel(f.toDate) || "today"}`, 12.5), 8);
    });
  }

  // ---- by whom, or by what ----
  // One question, not six. A person filter means nothing for ordinary spending,
  // and a category filter means nothing for lending, so only the one that is
  // actually in use is offered, and the other one is remembered for later.
  s.section("Narrow by");
  s.chips(
    [
      ["none", "Nothing"],
      ["person", "Person"],
      ["category", "Category"],
    ],
    f.narrow,
    (k) => {
      f.narrow = k;
      // these only mean something to the matching kind
      if (k !== "person") f.person = "";
      if (k !== "category") f.category = "";
      f.show = 120;
      ctx.refresh();
    }
  );

  if (f.narrow === "person" && people.length) {
    s.chips(
      [["", "Everyone"], ...people.map((p) => [p, p])],
      f.person,
      (k) => {
        f.person = k;
        f.show = 120;
        ctx.refresh();
      }
    );
  }
  if (f.narrow === "category" && cats.length) {
    s.chips(
      [["", "All categories"], ...cats.map((c) => [c, c])],
      f.category,
      (k) => {
        f.category = k;
        f.show = 120;
        ctx.refresh();
      }
    );
  }

  {
    s.spacer(4);
    s.chips(
      [
        ["all", "Everything"],
        ["personal", "Spending"],
        ["gave", "Gave"],
        ["borrowed", "Borrowed"],
        ["received", "Got back"],
        ["room", "Room"],
        ["savings", "Savings"],
        ["open", "Still open"],
      ],
      f.kind === "all" && !f.openOnly ? "all" : f.kind,
      (k) => {
        f.openOnly = k === "open";
        f.kind = k === "open" ? "all" : k;
        f.show = 120;
        ctx.refresh();
      }
    );
  }

  s.section("Search");
  const search = document.createElement("input");
  search.className = "field";
  search.placeholder = "e.g. petrol, rent, wifi";
  search.value = f.text;
  // filtered while typing: a separate Search button is one more tap for
  // something the page can do on its own
  let typing = null;
  search.addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      f.text = search.value.trim();
      f.show = 120;
      ctx.refresh();
    }, 250);
  });
  s.add(search);

  if (f.fromDate || f.toDate || f.category || f.person || f.text || f.kind !== "all" || f.openOnly || f.matchCase) {
    s.button("Clear filters", {
      onClick: () => {
        Object.assign(f, {
          fromDate: "",
          toDate: "",
          category: "",
          person: "",
          text: "",
          matchCase: false,
          openOnly: false,
          kind: "all",
          narrow: "none",
          show: 120,
        });
        ctx.refresh();
      },
    });
  }

  // ---------------- collect the lines ----------------
  const lines = [];

  {
    const wants = (t) => {
      if (f.kind === "room") return Repo.isRoomTx(t);
      if (f.kind === "all") return true;
      return t.type === f.kind;
    };
    for (const t of Repo.txAll()) {
      if (!wants(t)) continue;
      if (!Fmt.inRange(t.date, f.fromDate, f.toDate)) continue;
      if (f.category && !sameText(t.category, f.category)) continue;
      if (f.person && !Fmt.same(Repo.personName(t.personId), f.person)) continue;
      if (f.openOnly && (t.type === "personal" || t.type === "received" || t.settled)) continue;
      if (!matchesText(t.note, t.category, Repo.personName(t.personId))) continue;
      const room = f.kind === "room" && Repo.isRoomTx(t);
      lines.push({
        date: t.date,
        amount: t.amount,
        title: room ? roomTitle(t) : describeTx(t),
        amountText: Fmt.money(t.amount),
        color:
          t.type === "received" ? "ok"
          : t.type === "gave" ? "warn"
          : t.type === "borrowed" ? "bad"
          : "ink",
        avatar: room ? "⌂" : t.type === "received" ? "↓" : Fmt.initials(
          t.type === "personal" ? t.category || "Spending" : Repo.personName(t.personId)
        ),
        onClick: () => Dialogs.txDetail(t.id),
        del: () => confirmDeleteEntry(t.id, ctx),
      });
    }
  }

  if ((f.kind === "all" || f.kind === "room") && !Repo.hasRoomTx()) {
    for (const b of Repo.roomAll()) {
      if (!Fmt.inRange(b.date, f.fromDate, f.toDate)) continue;
      if (f.person && !b.splitWith.some((n) => Fmt.same(n, f.person)) && !Fmt.same(b.paidBy, f.person)) continue;
      if (f.openOnly && b.settled) continue;
      // a bill's name is the category its split entries were filed under
      if (f.category && !sameText(b.note, f.category)) continue;
      if (!matchesText(b.note, b.paidBy, b.splitWith.join(", "))) continue;
      lines.push({
        date: b.date,
        amount: b.amount,
        title: `Room · ${b.note || "bill"} · paid by ${b.paidBy} · ${Fmt.money(Repo.share(b))} each`,
        amountText: Fmt.money(b.amount),
        color: "warn",
        avatar: `${b.splitWith.length}x`,
        onClick: () => Dialogs.roomDetail(b),
      });
    }
  }

  if (f.kind === "all" || f.kind === "savings") {
    for (const e of Repo.savingsAll()) {
      if (!Fmt.inRange(e.date, f.fromDate, f.toDate)) continue;
      // savings moves are not filed under a spending category
      if (f.category) continue;
      // and they belong to nobody, so a person filter cannot match one
      if (f.person) continue;
      if (!matchesText(e.note)) continue;
      const carry = e.note.startsWith("Left over from");
      const title = carry
        ? `Savings · leftover from ${Fmt.monthLabel(e.note.replace("Left over from ", "").trim())}`
        : e.dir === "in"
        ? `Savings · moved in${e.note ? ` · ${e.note}` : ""}`
        : `Savings · taken out${e.note ? ` · ${e.note}` : ""}`;
      lines.push({
        date: e.date,
        amount: e.amount,
        title,
        amountText: (e.dir === "in" ? "+" : "-") + Fmt.money(e.amount),
        color: e.dir === "in" ? "ok" : "bad",
        avatar: e.dir === "in" ? "↑" : "↓",
        onClick: () => savingDetail(e, ctx),
        del: () => savingDetail(e, ctx),
      });
    }
  }

  const sorted = lines.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.title.toLowerCase().localeCompare(b.title.toLowerCase())));

  // ---------------- totals for what matched ----------------
  const inSum = sorted.filter((l) => isPositive(l)).reduce((a, l) => a + l.amount, 0);
  const outSum = sorted.filter((l) => !isPositive(l)).reduce((a, l) => a + l.amount, 0);
  const spendSum = sorted.filter((l) => countsAsSpending(l)).reduce((a, l) => a + l.amount, 0);
  s.section("Totals for this filter");
  s.kpi("Entries", String(sorted.length), "matching", "ink");
  s.add(gap());
  s.kpi("In", Fmt.money(inSum), "money received", "ok");
  s.add(gap());
  s.kpi("Out", Fmt.money(outSum), "money paid", "bad");
  s.add(gap());
  s.kpi("Spending", Fmt.money(spendSum), "counted as spend", "brand");

  s.section("All matching entries");
  if (sorted.length === 0) {
    s.empty(
      "Nothing matches",
      "Try a wider period, or clear the filters to see everything you have added.",
      "Clear filters",
      () => {
        Object.assign(f, { kind: "all", narrow: "none", fromDate: "", toDate: "", category: "", person: "", text: "", matchCase: false, openOnly: false, show: 120 });
        ctx.refresh();
      }
    );
    return s;
  }

  s.listCard((lc) => {
    sorted.slice(0, f.show).forEach((l, i) => {
      if (i > 0) lc.divider();
      lc.add(
        rowFor({
          avatar: l.avatar,
          title: l.title,
          subtitle: Fmt.dayLabel(l.date) || l.date,
          amount: l.amountText,
          amountColor: l.color,
          avatarTone: "card2",
          avatarTextColor: l.color,
          onClick: l.onClick,
          trailing: l.del ? deleteButton(l.del) : null,
        })
      );
    });
  });

  if (sorted.length > f.show) {
    s.button(`Show more (${sorted.length - f.show} left)`, {
      onClick: () => {
        f.show += 120;
        ctx.refresh();
      },
    });
  }

  s.note("Newest first. Tap any entry to edit, settle or delete it.");
  s.button("Add an entry", { onClick: () => ctx.open(Pages.ADD) });

  return s;
}

// ------------------------------------------------------------------ helpers

function isPositive(l) {
  return (
    l.title.startsWith("Savings · moved in") ||
    l.title.startsWith("Savings · leftover") ||
    l.title === "Money received" ||
    l.title.startsWith("Back from ") ||
    l.title.startsWith("Settled up with ")
  );
}

/**
 * Only the user's own spending counts against the month's limit. Money handed
 * to somebody is an outflow, not spending, so it must not be counted twice.
 */
function countsAsSpending(l) {
  if (isPositive(l)) return false;
  return !l.title.startsWith("Borrowed")
    && !l.title.startsWith("Gift from")
    && !l.title.startsWith("Gave ");
}

/** Resets the range and applies one of the quick presets. */
function applyPreset(key) {
  const today = Fmt.today();
  f.fromDate = "";
  f.toDate = "";
  f.custom = key === "custom";
  switch (key) {
    case "this":
      f.fromDate = Fmt.startOfMonth(today);
      f.toDate = Fmt.endOfMonth(today);
      break;
    case "last": {
      const m = Fmt.shiftMonth(Fmt.monthKey(today), -1);
      f.fromDate = Fmt.startOfMonth(m);
      f.toDate = Fmt.endOfMonth(m);
      break;
    }
    case "3m":
      f.fromDate = Fmt.startOfMonthsAgo(today, 3);
      break;
    case "6m":
      f.fromDate = Fmt.startOfMonthsAgo(today, 6);
      break;
    case "year":
      f.fromDate = Fmt.startOfYear(today);
      break;
    default:
      break;
  }
}

/** Which preset chip should look active for the current range. */
function activePreset() {
  if (!f.fromDate && !f.toDate) return f.custom ? "custom" : "any";
  const today = Fmt.today();
  const thisM = Fmt.startOfMonth(today);
  const lastM = Fmt.startOfMonth(Fmt.shiftMonth(Fmt.monthKey(today), -1));
  for (const [key] of PRESETS) {
    const match = {
      // the end of this month is the same as the end of the month to date,
      // because nothing after today can be recorded yet
      this: f.fromDate === thisM && (!f.toDate || f.toDate === Fmt.endOfMonth(today)),
      last: f.fromDate === lastM && f.toDate === Fmt.endOfMonth(lastM),
      "3m": f.fromDate === Fmt.startOfMonthsAgo(today, 3) && !f.toDate,
      "6m": f.fromDate === Fmt.startOfMonthsAgo(today, 6) && !f.toDate,
      year: f.fromDate === Fmt.startOfYear(today) && !f.toDate,
    }[key];
    if (match) return key;
  }
  return "custom";
}

/** A From / To button showing the current bound, or the placeholder. */
function rangeButton(placeholder, value, onPick) {
  const b = new Screen().buildButton(value ? Fmt.dayLabel(value) : placeholder, {
    primary: !!value,
    ghost: !value,
    onClick: onPick,
  });
  b.style.width = "auto";
  b.style.flex = "1";
  b.style.margin = "0";
  b.style.marginRight = "8px";
  return b;
}

function pickDate(isFrom, ctx) {
  const start = isFrom ? f.fromDate : f.toDate;
  // "To" may run past today, because it is asking how far back to look; "From"
  // cannot, and the calendar stops both at today for anything being entered
  openCalendar({
    title: isFrom ? "From date" : "To date",
    value: start || Fmt.today(),
    max: Fmt.today(),
    onPick: (picked) => {
      if (isFrom) {
        f.fromDate = picked;
        if (f.toDate && f.toDate < picked) f.toDate = "";
      } else {
        f.toDate = picked;
        if (f.fromDate && f.fromDate > picked) f.fromDate = "";
      }
      f.show = 120;
      ctx.refresh();
    },
  });
}
function matchesText(...fields) {
  if (!f.text) return true;
  return fields.some((x) => x != null && containsText(x));
}

function containsText(hay) {
  return f.matchCase ? hay.includes(f.text) : Fmt.key(hay).includes(Fmt.key(f.text));
}

/** Exact category matching, respecting the Match case setting. */
function sameText(a, b) {
  if (a == null) return false;
  return f.matchCase ? a === b : Fmt.same(a, b);
}

/**
 * A room entry reads better as two halves of one bill: what the user paid for
 * themselves, and what the roommate owes.
 */
function roomTitle(t) {
  const parent = Repo.roomGroupOf(t);
  const reason = (parent.note || "").split(" · ")[0] || "shared bill";
  if (t.type === "personal") return `Room · ${reason} · your share`;
  return `Room · ${reason} · ${Repo.personName(t.personId)}'s share`;
}

function describeTx(t) {
  if (t.type === "received") return t.note || "Money received";
  if (t.type === "gave") {
    return `Gave ${Repo.personName(t.personId)}${t.returnable ? "" : " · gift"}`;
  }
  if (t.type === "borrowed") {
    return t.returnable
      ? `Borrowed from ${Repo.personName(t.personId)}`
      : `Gift from ${Repo.personName(t.personId)}`;
  }
  if (t.personId) return `${t.category || "Spending"} for ${Repo.personName(t.personId)}`;
  return t.category || "Spending";
}

function savingDetail(e, ctx) {
  ask(e.dir === "in" ? "Into savings" : "Out of savings",
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
        toast("Entry deleted", { good: true });
        ctx.refresh();
      },
    }
  );
}
