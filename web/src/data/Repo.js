// Budget Planner - every read and write for the app.
// Mirrors app/src/main/java/com/budgetplanner/data/Repo.kt.
//
// Rules that must stay identical in Android, iOS and the web:
//   returnable === true  means "a return is expected"
//   returnable === false means "this is a gift, nothing is pending"
//   settled only means "the expected return happened"
//
// The `ret` column is the shared meaning of the app's gift feature. The three
// cases are:
//   gave     + ret=1 -> they owe you
//   gave     + ret=0 -> gift you gave
//   borrowed + ret=0 -> gift you received
// Spending that was a gift to someone is a `personal` row that also carries a
// person, so it counts once as spending and shows once under that person.

import * as Db from "./Db.js";
import {
  Bill, Cats, MonthCfg, MonthSum, NeedItem, Person, RoomBill, RoomNet, SavEntry,
  billInWindow, personSumGiftTotal, personSumNet, round2, Tx,
} from "./Models.js";
import { billsInText } from "./BillWords.js";
import { Fmt } from "../util/Fmt.js";
import { Prefs } from "../notify/Prefs.js";

/**
 * A usable figure, or the fallback.
 *
 * Everything stored goes through this. One stray blank or a stray word in a
 * field turns into NaN, and NaN spreads through every total in the month and
 * then shows up on the screen as a blank with no explanation anywhere.
 */
const num = (v, d = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? (n < 0 ? 0 : n) : d;
};

export const Repo = {
  // ---------------- settings ----------------

  get(key, def = "") {
    return Db.getKv(key, def);
  },

  set(key, value) {
    Db.setKv(key, value);
  },

  currency() {
    return Repo.get("currency", "₹");
  },

  // ---------------- categories ----------------

  // A category name can contain spaces, commas and slashes, so the stored list
  // uses a unit separator rather than a comma. Same as Repo.kt's SEP.
  SEP: "\u001F",

  /**
   * Every category the user can pick: the built-in ones, anything they added,
   * and any category already used by an entry, so removing a custom category
   * never hides history.
   */
  cats() {
    const out = [...Cats.all];
    for (const c of Repo.customCats()) if (!out.includes(c)) out.push(c);
    for (const r of Db.table("tx")) {
      if (r.category && r.category !== "" && !out.includes(r.category)) out.push(r.category);
    }
    return out;
  },

  customCats() {
    return Repo.get("custom_cats", "").split(Repo.SEP).map((s) => s.trim()).filter(Boolean);
  },

  /** Adds a custom category. Blank or duplicate names are ignored. */
  addCat(name) {
    const n = String(name || "").trim();
    if (!n || Repo.cats().some((c) => Fmt.same(c, n))) return false;
    Repo.set("custom_cats", [...Repo.customCats(), n].join(Repo.SEP));
    return true;
  },

  removeCat(name) {
    Repo.set(
      "custom_cats",
      Repo.customCats().filter((c) => !Fmt.same(c, name)).join(Repo.SEP)
    );
  },

  isCustomCat(name) {
    return Repo.customCats().some((c) => Fmt.same(c, name));
  },

  defaultSalary() {
    return parseFloat(Repo.get("salary", "0")) || 0;
  },

  /** The figures a fresh month starts from, as one object. */
  defaults() {
    return MonthCfg(Repo.defaultSalary(), Repo.defaultSavings(), 0);
  },

  defaultSavings() {
    return parseFloat(Repo.get("savings", "0")) || 0;
  },

  setDefaults(salary, savings, cur) {
    Repo.set("salary", String(salary));
    Repo.set("savings", String(savings));
    Repo.set("currency", cur);
  },

  // ---------------- the salary cycle ----------------
  //
  // A salary in this app is a planning number, never money. Typing it in does
  // not add anything to the account and does not create an entry - it only sets
  // the ceiling for a month. Money becomes spendable when the month is started,
  // which is the user confirming on payday that the salary actually landed.
  //
  // The order at a month boundary is always:
  //   1. the closing month's leftover is swept into savings
  //   2. the new month's salary is confirmed
  //   3. the new month starts fresh at (salary - savings target)
  // The leftover becomes savings and stops being spendable, so a new month
  // never silently inherits last month's unspent money, and leftover is never
  // counted as spending.

  /** The day the user confirmed the salary for this month landed. */
  salaryPaidOn(m) {
    return Repo.get(`salary_paid_${m}`, "");
  },

  isSalaryPaid(m) {
    return Repo.salaryPaidOn(m) !== "";
  },

  /**
   * A month counts as started once its salary is confirmed. A month that already
   * holds entries counts too, so nothing existing is ever hidden, and a past
   * month always counts so its leftover can still be swept.
   */
  isMonthStarted(m) {
    if (Repo.isSalaryPaid(m)) return true;
    if (Fmt.isPastMonth(m)) return true;
    return Repo.monthHasEntries(m);
  },

  monthHasEntries(m) {
    return (
      Db.table("tx").some((t) => Fmt.monthKey(t.date) === m) ||
      Db.table("room_bill").some((b) => Fmt.monthKey(b.date) === m) ||
      Db.table("savings_tx").some((e) => Fmt.monthKey(e.date) === m)
    );
  },

  /**
   * Confirms the salary landed. Records the date only: no transaction is added,
   * because the salary is a limit and not money in the account.
   */
  markSalaryPaid(m, date = Fmt.today()) {
    Repo.set(`salary_paid_${m}`, date);
    // the question is answered, so the one-off date and the nudge are both spent
    Repo.clearSalaryDue(m);
    Prefs.setLastSalaryAlert("");
  },

  undoSalaryPaid(m) {
    Repo.set(`salary_paid_${m}`, "");
  },

  /**
   * The month whose salary is still to be confirmed. Usually next month, since
   * the salary lands on the last day of the one before it.
   */
  monthAwaitingSalary() {
    const now = Fmt.thisMonth();
    if (!Repo.isMonthStarted(now) && Repo.monthCfg(now).salary > 0) return now;
    return Fmt.shiftMonth(now, 1);
  },

  /**
   * When the salary for this month is expected.
   *
   * A date can be pushed for a single month, which wins over the usual rule.
   * "Not this month" and "not for this month only" are the same thing here: the
   * override belongs to one month and the recurring day is left alone.
   */
  salaryDueOn(m) {
    const oneOff = Repo.get(`salarydue_${m}`, "");
    if (oneOff) return oneOff;
    return Fmt.dateOn(Fmt.shiftMonth(m, -1), Prefs.salaryDayIn(Fmt.shiftMonth(m, -1)));
  },

  /** Puts this month's payday on a different date, leaving other months alone. */
  pushSalaryDue(m, date) {
    Repo.set(`salarydue_${m}`, date);
    // the reminder must be allowed to fire again on the new day
    Prefs.setLastSalaryAlert("");
  },

  clearSalaryDue(m) {
    Repo.set(`salarydue_${m}`, "");
  },

  isSalaryDuePushed(m) {
    return Repo.get(`salarydue_${m}`, "") !== "";
  },

  /**
   * How much was lost from the salary this month because of unpaid leave. This
   * is always for one month only, never a change to the usual salary, and it is
   * stored as that month's own salary so the limit works out correctly on its
   * own without any special case at read time.
   */
  salaryCutFor(m) {
    return parseFloat(Repo.get(`salarycut_${m}`, "0")) || 0;
  },

  /**
   * Records a leave deduction. `cut` is how much was lost, so the month runs on
   * the usual salary minus that.
   */
  setSalaryCutFor(m, cut, savings = null) {
    const base = Repo.monthCfg(Fmt.shiftMonth(m, -1)).salary || Repo.defaultSalary();
    const amount = Math.max(0, base - Math.max(0, cut));
    const keep = savings == null ? Repo.monthCfg(m).savings : savings;
    Repo.setMonthCfg(m, amount, Math.min(keep, amount));
    Repo.set(`salarycut_${m}`, String(Math.max(0, cut)));
    return amount;
  },

  /** Drops a leave deduction and puts the month back on the usual salary. */
  clearSalaryCutFor(m) {
    Repo.set(`salarycut_${m}`, "");
    const base = Repo.monthCfg(Fmt.shiftMonth(m, -1)).salary || Repo.defaultSalary();
    const keep = Math.min(Repo.monthCfg(m).savings, base);
    Repo.setMonthCfg(m, base, keep);
  },

  /**
   * The next day the app should ask about the salary: the pushed date when there
   * is one, otherwise the usual payday rule. Returns null once the month is
   * started, because there is nothing left to ask.
   */
  nextSalaryQuestionOn() {
    const m = Repo.monthAwaitingSalary();
    if (Repo.isMonthStarted(m)) return null;
    if (Repo.monthCfg(m).salary <= 0) return null;
    return Repo.salaryDueOn(m);
  },

  // ---------------- roommates ----------------

  /**
   * The household, "Me" first.
   *
   * Names are compared without case, so "rahul" and "Rahul" can never end up as
   * two different people sharing the same bills. The first spelling typed wins,
   * so the app never rewrites a name the user can see.
   */
  roomPeople() {
    const raw = Repo.get("room_people", Cats.ME);
    const byKey = new Map();
    for (const n of String(raw).split(",")) {
      const t = n.trim();
      if (!t) continue;
      // folded key, so "Arun" and "ARUN " cannot both get on the list
      const k = Fmt.key(t);
      if (!byKey.has(k)) byKey.set(k, Fmt.name(t));
    }
    byKey.set(Fmt.key(Cats.ME), Cats.ME);
    return [...byKey.values()];
  },

  setRoomPeople(list) {
    const byKey = new Map();
    for (const n of list) {
      const t = String(n || "").trim();
      if (!t) continue;
      // folded key, so "Arun" and "ARUN " cannot both get on the list
      const k = Fmt.key(t);
      if (!byKey.has(k)) byKey.set(k, Fmt.name(t));
    }
    byKey.set(Fmt.key(Cats.ME), Cats.ME);
    Repo.set("room_people", [...byKey.values()].join(","));
  },

  /**
   * Adds one roommate.
   * Returns false when the name is blank, is "Me", or is already on the list
   * whatever the case. Everyone in the room also becomes a person you can
   * spend with, give to or borrow from, so there is only ever one list of names.
   */
  addRoomPerson(name) {
    const n = String(name || "").trim();
    if (!n || Fmt.same(n, Cats.ME)) return false;
    if (Repo.roomPeople().some((p) => Fmt.same(p, n))) return false;
    Repo.setRoomPeople([...Repo.roomPeople(), n]);
    Repo.personId(n);
    return true;
  },

  removeRoomPerson(name) {
    Repo.setRoomPeople(Repo.roomPeople().filter((p) => !Fmt.same(p, name)));
  },

  isRoomPerson(name) {
    return Repo.roomPeople().some((p) => Fmt.same(p, name));
  },

  /** Who a new room bill is split between, before the user unticks anyone. */
  defaultSplit() {
    return Repo.roomPeople();
  },

  // ---------------- months ----------------

  monthCfg(m) {
    const row = Db.table("months").find((r) => r.m === m);
    if (row) return MonthCfg(row.salary, row.savings, row.opening || 0);
    return MonthCfg(Repo.defaultSalary(), Repo.defaultSavings(), 0);
  },

  /**
   * Sets the opening balance for a month: money already in hand that the app
   * would not otherwise know about. It moves the "money in hand" figure and the
   * month-end leftover, and is deliberately not added to the spending limit.
   */
  setMonthOpening(m, opening) {
    const cfg = Repo.monthCfg(m);
    const t = Db.table("months");
    const i = t.findIndex((r) => r.m === m);
    const row = { m, salary: cfg.salary, savings: cfg.savings, opening: num(opening, 0) };
    if (i >= 0) t[i] = row;
    else t.push(row);
    Db.saveNow();
  },

  setMonthCfg(m, salary, savings) {
    // figures only: a blank or odd value here would quietly poison every total
    // in the month with NaN, and NaN shows up as a blank on the screen
    salary = num(salary, 0);
    savings = num(savings, 0);
    const opening = Repo.monthCfg(m).opening;
    const t = Db.table("months");
    const i = t.findIndex((r) => r.m === m);
    const row = { m, salary, savings, opening };
    if (i >= 0) t[i] = row;
    else t.push(row);
    Db.saveNow();
  },

  monthsSet() {
    return new Set(Db.table("months").map((r) => r.m));
  },

  clearMonthOverride(m) {
    const t = Db.table("months");
    const i = t.findIndex((r) => r.m === m);
    if (i >= 0) t.splice(i, 1);
    Db.saveNow();
  },

  // ---------------- people ----------------

  people() {
    return [...Db.table("people")]
      .sort((a, b) => Fmt.name(a.name).localeCompare(Fmt.name(b.name), undefined, { sensitivity: "base" }))
      .map((r) => Person(r.id, Fmt.name(r.name)));
  },

  /** Finds someone by name without regard to case, or creates them. */
  personId(name) {
    const n = String(name || "").replace(/\s+/g, " ").trim();
    if (!n) return null;
    // one person per name, whatever case it was typed in
    const found = Repo.people().find((p) => Fmt.same(p.name, n));
    if (found) return found.id;
    const id = Fmt.uid();
    Db.insert("people", { id, name: Fmt.name(n) });
    return id;
  },

  personName(id) {
    if (!id) return "Someone";
    const row = Db.table("people").find((r) => r.id === id);
    // shown tidied up, so an older all-caps row still reads properly
    return row ? Fmt.name(row.name) : "Someone";
  },

  renamePerson(id, name) {
    Db.updateById("people", id, { name: Fmt.name(name) });
  },

  deletePerson(id) {
    Db.replaceTable("tx", Db.table("tx").filter((r) => r.person !== id));
    Db.deleteById("people", id);
  },

  // ---------------- transactions ----------------

  /**
   * Every transaction, newest first.
   *
   * These come back as transactions, not as stored rows: the stored row calls
   * the person "person" and the flags "ret" and "from_sav", and a page reading
   * t.personId off a raw row quietly sees nobody and labels a repayment a gift.
   */
  txAll() {
    return [...Db.table("tx")]
      .map(Repo.rowToTx)
      .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
  },

  txInMonth(m) {
    return Repo.txAll().filter((t) => Fmt.monthKey(t.date) === m);
  },

  txById(id) {
    return Repo.txAll().find((t) => t.id === id) || null;
  },

  txToRow(t) {
    return {
      id: t.id, type: t.type, amount: t.amount,
      category: t.category, person: t.personId, date: t.date, note: t.note,
      ret: t.returnable ? 1 : 0, settled: t.settled ? 1 : 0, from_sav: t.fromSavings ? 1 : 0,
      group: t.group ?? null,
    };
  },

  rowToTx(r) {
    return Tx({
      id: r.id, type: r.type, amount: r.amount, category: r.category,
      personId: r.person, date: r.date, note: r.note,
      returnable: r.ret === 1, settled: r.settled === 1, fromSavings: r.from_sav === 1,
      group: r.group ?? null,
    });
  },

  addTx(t) {
    Db.insert("tx", Repo.txToRow(t));
    return t;
  },

  updateTx(t) {
    const patch = Repo.txToRow(t);
    delete patch.id;
    Db.updateById("tx", t.id, patch);
  },

  /**
   * Records spending. If it was paid out of savings, a matching withdrawal is
   * written to the savings ledger so the two stay in step.
   *
   * A gift to a person is still one `personal` row: it carries the person so it
   * shows under them as a gift, and it is counted once as spending. Nothing else
   * is written, so it can never show up as money that is owed.
   */
  addSpending(t) {
    Repo.addTx(t);
    if (t.fromSavings) {
      Repo.addSaving(SavEntry({
        id: Fmt.uid(), amount: t.amount, date: t.date,
        note: "Spent on " + (t.category || "spending"), dir: "out",
      }));
    }
    return t;
  },

  /**
   * Removes an entry, and puts the rest of the app back in step with it.
   *
   * Three things hang off an entry and have to go with it, or the balance
   * quietly stops adding up:
   *   - the shares of a split bill, which are separate rows tied to it
   *   - a refund into savings, when the spending came out of savings
   *   - a partial repayment that was made against it
   */
  deleteTx(id) {
    const t = Repo.txById(id);
    if (!t) return;
    // the shares of a split bill are part of the same entry
    for (const r of Db.table("tx")) {
      if (r.group === id) Db.deleteById("tx", r.id);
    }
    // money that came out of savings goes back in, or savings stays short
    if (t.fromSavings && t.amount > 0) {
      Repo.addSaving(
        SavEntry({
          id: Fmt.uid(),
          amount: t.amount,
          date: Fmt.today(),
          note: "Entry deleted: " + (t.category || "spending"),
          dir: "in",
        })
      );
    }
    Db.deleteById("tx", id);
  },

  /**
   * True when this row is money the other person still owes you.
   *
   * Two shapes mean the same thing, and both are owed back:
   *   - "I gave", returnable, the ordinary case
   *   - "I spent" with a person on it, which is spending you did for them, so
   *     it counts against your month and they owe you the same amount
   * A "spent for somebody" row is only a gift when it was recorded as one.
   */
  isOwedToMe(t) {
    if (!t.personId || t.settled) return false;
    if (t.type === "personal") return t.returnable !== false;
    return t.type === "gave" && t.returnable === true;
  },

  /** True when this row is money you still owe the other person. */
  isOwedByMe(t) {
    return t.type === "borrowed" && t.returnable === true && !t.settled;
  },

  /** True when the row is money that is expected to come back one day. */
  isOpenPersonTx(t) {
    return Repo.isOwedToMe(t) || Repo.isOwedByMe(t);
  },

  /**
   * True for a transaction that is part of a shared room entry.
   *
   * A room entry is two rows: the user's own share as spending, and each
   * roommate's share as money they owe. Both belong to the room, which is what
   * lets History show a room filter that actually finds them.
   */
  isRoomTx(t) {
    if (t.type === "personal") return Fmt.same(t.category, "Room");
    if (t.group) {
      const parent = Repo.txById(t.group);
      return !!parent && Fmt.same(parent.category, "Room");
    }
    return false;
  },

  /** True once any room entry exists, so the old room-bill list can step aside. */
  hasRoomTx() {
    return Repo.txAll().some(Repo.isRoomTx);
  },

  /** The entry a share came from, so both halves can be described together. */
  roomGroupOf(t) {
    if (!t.group) return t;
    return Repo.txById(t.group) || t;
  },

  /** True when the row is a gift in either direction. Never pending. */
  isGiftTx(t) {
    if (t.type === "personal") return !!(t.personId && t.returnable === false);
    return t.type !== "personal" && !t.returnable;
  },

  // ---------------- room ----------------

  roomAll() {
    return [...Db.table("room_bill")].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
  },

  roomInMonth(m) {
    return Repo.roomAll().filter((b) => Fmt.monthKey(b.date) === m);
  },

  roomById(id) {
    return Repo.roomAll().find((b) => b.id === id) || null;
  },

  roomRow(b) {
    return {
      id: b.id, amount: b.amount, note: b.note, date: b.date,
      paid_by: b.paidBy, split_with: b.splitWith.join("|"), settled: b.settled ? 1 : 0,
    };
  },

  rowToRoom(r) {
    return RoomBill({
      id: r.id, amount: r.amount, note: r.note, date: r.date,
      paidBy: r.paid_by,
      splitWith: String(r.split_with || "").split("|").map((s) => s.trim()).filter(Boolean),
      settled: r.settled === 1,
    });
  },

  addRoom(b) {
    Db.insert("room_bill", Repo.roomRow(b));
    return b;
  },

  updateRoom(b) {
    const patch = Repo.roomRow(b);
    delete patch.id;
    Db.updateById("room_bill", b.id, patch);
  },

  deleteRoom(id) {
    Db.deleteById("room_bill", id);
  },

  // ---------------- savings ----------------

  savingsAll() {
    return [...Db.table("savings_tx")].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
  },

  savingsBalance() {
    return round2(
      Repo.savingsAll().reduce((t, e) => t + (e.dir === "in" ? e.amount : -e.amount), 0)
    );
  },

  addSaving(s) {
    Db.insert("savings_tx", { id: s.id, amount: s.amount, date: s.date, note: s.note, dir: s.dir });
    return s;
  },

  updateSaving(s) {
    Db.updateById("savings_tx", s.id, { amount: s.amount, date: s.date, note: s.note, dir: s.dir });
  },

  deleteSaving(id) {
    Db.deleteById("savings_tx", id);
  },

  // ---------------- needs ----------------

  needs() {
    return [...Db.table("need_item")].sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
  },

  addNeed(n) {
    Db.insert("need_item", {
      id: n.id, text: n.text, amount: n.amount, from_whom: n.fromWhom, date: n.date, done: n.done ? 1 : 0,
    });
    return n;
  },

  updateNeed(n) {
    Db.updateById("need_item", n.id, {
      text: n.text, amount: n.amount, from_whom: n.fromWhom, date: n.date, done: n.done ? 1 : 0,
    });
  },

  deleteNeed(id) {
    Db.deleteById("need_item", id);
  },

  openNeeds() {
    return Repo.needs().filter((n) => !n.done);
  },

  // ---------------- recurring bills ----------------

  bills() {
    return [...Db.table("bill")]
      .sort((a, b) => a.due_day - b.due_day || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      .map((r) => Bill({
        id: r.id, name: r.name, amount: r.amount, dueDay: r.due_day,
        category: r.category, note: r.note, active: r.active === 1, paidMonth: r.paid_month,
      }));
  },

  billById(id) {
    return Repo.bills().find((b) => b.id === id) || null;
  },

  addBill(b) {
    Db.insert("bill", Repo.billRow(b));
    return b;
  },

  updateBill(b) {
    const patch = Repo.billRow(b);
    delete patch.id;
    Db.updateById("bill", b.id, patch);
  },

  deleteBill(id) {
    Db.deleteById("bill", id);
  },

  billRow(b) {
    return {
      id: b.id, name: b.name, amount: b.amount, due_day: b.dueDay,
      category: b.category, note: b.note, active: b.active ? 1 : 0, paid_month: b.paidMonth,
    };
  },

  /** A bill by the name the user would type, so "RENT" finds "Rent". */
  billByName(name) {
    return Repo.bills().find((b) => Fmt.same(b.name, name)) || null;
  },

  /** The active bills still not paid in this month. */
  unpaidBills(month) {
    return Repo.activeBills().filter((b) => b.paidMonth !== month);
  },

  /**
   * Reads a line of typing and records which monthly bills it says were paid.
   *
   * A bill mentioned for the first time is remembered, so it can be nagged about
   * in a later month when the user does not write it down again. The amount is
   * left at zero: what was written here is the name of the bill, not what it
   * came to.
   */
  learnBills(text, month) {
    const names = billsInText(text);
    const learned = [];
    for (const name of names) {
      let b = Repo.billByName(name);
      if (!b) {
        b = Bill({
          id: Fmt.uid(),
          name,
          amount: 0,
          dueDay: 10,
          category: "Bills & Recharge",
          note: "Picked up from a room entry",
          active: true,
          paidMonth: month,
        });
        Repo.addBill(b);
      } else if (b.paidMonth !== month) {
        Repo.markBillPaid(b.id, month);
      }
      learned.push(name);
    }
    return learned;
  },

  markBillPaid(id, month) {
    Db.updateById("bill", id, { paid_month: month });
  },

  unmarkBill(id) {
    Db.updateById("bill", id, { paid_month: "" });
  },

  activeBills() {
    return Repo.bills().filter((b) => b.active);
  },

  /**
   * The common payments still to handle in the first few days of a month.
   *
   * Rent, WiFi, electricity and the rest are all just bills; the only extra rule
   * is that the window closes on `untilDay`, which defaults to the 10th. This is
   * what the "common payments" reminder reads.
   */
  commonBills(month, untilDay = 10) {
    return Repo.activeBills()
      .filter((b) => billInWindow(b, untilDay))
      .sort((a, b) => a.dueDay - b.dueDay);
  },

  commonDue(month, day, untilDay = 10) {
    return Repo.commonBills(month, untilDay).filter((b) => !b.isPaidThis(month) && b.dueDay <= day);
  },

  // ---------------- derived ----------------

  share(b) {
    return b.splitWith.length === 0 ? b.amount : b.amount / b.splitWith.length;
  },

  /** How much the user is owed for a bill they did not pay. */
  owedOn(b) {
    if (b.settled) return 0;
    if (b.paidBy === Cats.ME) return 0;
    const others = b.splitWith.filter((n) => n !== b.paidBy);
    return others.length === 0 ? 0 : Repo.share(b) * others.length;
  },

  monthSum(m) {
    const tx = Repo.txInMonth(m).map(Repo.rowToTx);
    const room = Repo.roomInMonth(m).map(Repo.rowToRoom);
    const sav = Repo.savingsAll().filter((e) => Fmt.monthKey(e.date) === m);
    const sum = (list, f) => round2(list.reduce((t, x) => t + f(x), 0));

    const savedIn = sum(sav, (e) => (e.dir === "in" ? e.amount : 0));
    const savedOut = sum(sav, (e) => (e.dir === "out" ? e.amount : 0));

    return MonthSum({
      personal: sum(tx, (t) => (t.type === "personal" ? t.amount : 0)),
      // money that came back in, which is what settling up leaves behind
      received: sum(tx, (t) => (t.type === "received" ? t.amount : 0)),
      gaveOpen: sum(tx, (t) => (Repo.isOwedToMe(t) ? t.amount : 0)),
      gaveGift: sum(tx, (t) => (t.type === "gave" && !t.returnable ? t.amount : 0)),
      gaveAll: sum(tx, (t) => (t.type === "gave" ? t.amount : 0)),
      // borrowed as a gift is never owed back, so it is not open
      borrowedOpen: sum(tx, (t) => (Repo.isOwedByMe(t) ? t.amount : 0)),
      borrowedAll: sum(tx, (t) => (t.type === "borrowed" ? t.amount : 0)),
      giftReceived: sum(tx, (t) => (t.type === "borrowed" && !t.returnable ? t.amount : 0)),
      // only the ones recorded as gifts: spending you did for somebody who owes
      // it back is a receivable, and is counted in gaveOpen
      spentAsGift: sum(tx, (t) => (t.type === "personal" && t.personId && !t.returnable ? t.amount : 0)),
      roomTotal: sum(room, (b) => b.amount),
      roomPaidByMe: sum(room, (b) => (b.paidBy === Cats.ME ? b.amount : 0)),
      roomMyShare: sum(room, (b) => Repo.share(b)),
      roomOwedToMe: sum(room, (b) => Repo.owedOn(b)),
      savedIn,
      savedOut,
      saved: round2(savedIn - savedOut),
    });
  },

  /** Money they still owe you, across all months. Gifts are excluded. */
  openReceivable() {
    return round2(
      Repo.txAll()
        .filter(Repo.isOwedToMe)
        .reduce((a, t) => a + t.amount, 0)
    );
  },

  /** Money you still owe them. Borrowed gifts are excluded. */
  openPayable() {
    return round2(
      Repo.txAll()
        .filter(Repo.isOwedByMe)
        .reduce((a, t) => a + t.amount, 0)
    );
  },

  openRoomOwed() {
    return round2(Repo.roomAll().map(Repo.rowToRoom).reduce((a, b) => a + Repo.owedOn(b), 0));
  },

  /** Positive means the room owes you, negative means you owe the room. */
  roomNetTotal() {
    return round2(Repo.roomNets().reduce((a, n) => a + n.net, 0));
  },

  /**
   * What each person still owes you, minus what you owe them.
   *
   * A bill you paid adds their share to what they owe. A bill they paid
   * subtracts your share, so the two cancel out instead of both sitting on the
   * books. Zero means the room is square.
   */
  roomNets() {
    const all = Repo.roomAll().map(Repo.rowToRoom);
    return Repo.roomPeople()
      .filter((name) => name !== Cats.ME)
      .map((name) => {
        let theirs = 0;
        let mine = 0;
        for (const b of all) {
          if (b.settled) continue;
          if (!b.splitWith.includes(name)) continue;
          if (b.paidBy === Cats.ME) theirs += Repo.share(b);
          else if (Fmt.same(b.paidBy, name)) mine += Repo.share(b);
        }
        return RoomNet(name, theirs, mine);
      });
  },

  roomNetWith(name) {
    const hit = Repo.roomNets().find((n) => Fmt.same(n.name, name));
    return hit ? hit.net : 0;
  },

  /** Closes off every open room bill shared with this person. */
  settleRoomWith(name) {
    for (const b of Repo.roomAll()) {
      if (b.settled) continue;
      if (!b.split_with.includes(name)) continue;
      if (b.paid_by === Cats.ME || b.paid_by === name) Repo.updateRoom(Repo.rowToRoom({ ...b, settled: 1 }));
    }
  },

  /**
   * Records one half of a settlement: money that actually changed hands.
   *
   * A return expected from the other person lands as `received`, which is
   * neutral - it is money coming back, never spending and never a new
   * receivable. A repayment the user makes is ordinary spending, so it counts
   * against the month's limit and shows on History like anything else they buy.
   */
  settleMoney({ personId, amount, dir, date, note }) {
    const amt = round2(num(amount));
    if (amt <= 0) return null;
    return Repo.addTx(
      Tx({
        id: Fmt.uid(),
        type: dir === "in" ? "received" : "personal",
        amount: amt,
        category: dir === "in" ? null : "Repayment",
        personId: dir === "in" ? null : personId,
        date: date || Fmt.today(),
        note: note || "",
        returnable: false,
      })
    );
  },

  /** Settles a single open entry and moves the money. */
  settleTx(id) {
    const t = Repo.txById(id);
    if (!t || t.settled) return null;
    Repo.updateTx({ ...t, settled: true });
    if (!Repo.isReturnable(t)) return null;
    // they owed you, so the money comes back to you
    if (t.type === "gave") {
      return Repo.settleMoney({
        personId: t.personId, amount: t.amount, dir: "in",
        note: `Back from ${Repo.personName(t.personId)}`,
      });
    }
    // you owed them, so you pay and it is spending
    return Repo.settleMoney({
      personId: t.personId, amount: t.amount, dir: "out",
      note: `Paid back to ${Repo.personName(t.personId)}`,
    });
  },

  /** Puts an entry back on the open list. The money row is left alone. */
  unsettleTx(id) {
    const t = Repo.txById(id);
    if (!t) return;
    Repo.updateTx({ ...t, settled: false });
  },

  /**
   * Closes off everything open with this person in one go, and moves the money
   * that actually changes hands.
   *
   * Both sides are added up first, so only the net is recorded: if you owe them
   * more than they owe you, one payment out clears everything. Gifts have
   * nothing to settle, so settling never silently swallows one.
   */
  settleAllWith(name) {
    const pid = Repo.personId(name);
    let moved = null;
    if (pid) {
      const open = Db.table("tx")
        .map(Repo.rowToTx)
        .filter((t) => t.personId === pid && t.returnable && !t.settled);
      const theirs = round2(open.filter(Repo.isOwedToMe).reduce((a, t) => a + t.amount, 0));
      const mine = round2(open.filter(Repo.isOwedByMe).reduce((a, t) => a + t.amount, 0));
      for (const t of open) Repo.updateTx({ ...t, settled: true });
      const net = round2(theirs - mine);
      if (net > 0) {
        moved = Repo.settleMoney({ personId: pid, amount: net, dir: "in", note: `Settled up with ${name}` });
      } else if (net < 0) {
        moved = Repo.settleMoney({ personId: pid, amount: -net, dir: "out", note: `Settled up with ${name}` });
      }
    }
    Repo.settleRoomWith(name);
    return moved;
  },

  /**
   * Per-person roll-up used by the People page.
   *
   * giftGiven covers money you handed over as a gift and spending that was a
   * gift to that person. giftReceived covers money that came to you as a gift.
   * Neither ever shows up as pending.
   */
  peopleSums() {
    const txs = Db.table("tx").map(Repo.rowToTx);
    return Repo.people().map((person) => {
      const mine = txs.filter((t) => t.personId === person.id);
      const sum = (f) => round2(mine.filter(f).reduce((a, t) => a + t.amount, 0));
      const base = {
        person,
        theyOweMe: sum(Repo.isOwedToMe),
        iOweThem: sum(Repo.isOwedByMe),
        gaveTotal: sum((t) => t.type === "gave"),
        receivedTotal: sum((t) => t.type === "borrowed"),
        // spending done for somebody is only a gift when it was recorded as one
        giftGiven: round2(
          sum((t) => (t.type === "gave" && !t.returnable) || (t.type === "personal" && !!t.personId && t.returnable === false))
        ),
        giftReceived: sum((t) => t.type === "borrowed" && !t.returnable),
        entries: mine.length,
      };
      const withNet = personSumNet(base);
      return { ...withNet, giftTotal: personSumGiftTotal(base) };
    });
  },

  /**
   * Only the people something is still owed to or by.
   *
   * A name is not kept on the books for the sake of it: once the last entry
   * with somebody is settled, deleted, or turned into a gift, they drop off the
   * People page. Their old entries are untouched, so History still shows them,
   * but there is nothing left to settle and nothing to press.
   */
  pendingPeople() {
    return Repo.peopleSums().filter((p) => p.theyOweMe > 0 || p.iOweThem > 0);
  },

  // ---------------- money in hand, daily pace, month close ----------------

  /** What can be spent this month once the fixed savings are set aside. */
  spendableLimit(m) {
    // Nothing is spendable until the salary for the month has been confirmed.
    if (!Repo.isMonthStarted(m)) return 0;
    const cfg = Repo.monthCfg(m);
    return Math.max(0, cfg.salary - cfg.savings);
  },

  /**
   * Unspent money in a month, after its savings target. Positive means there is
   * something left over to sweep into savings; negative means the month was
   * overspent and nothing moves.
   */
  leftover(m) {
    return Repo.spendableLimit(m) + Repo.monthCfg(m).opening - Repo.monthSum(m).personal;
  },

  /** Money still unspent this month. Negative when the limit is blown. */
  moneyLeft(m) {
    return Repo.leftover(m);
  },

  /** What is safe to spend each day for the rest of the month. */
  dailyAllowance(m) {
    const left = Repo.moneyLeft(m);
    if (left <= 0) return 0;
    const days = Fmt.daysLeftIn(m);
    return days === 0 ? 0 : left / days;
  },

  /**
   * Moves whatever was left unspent into savings at the end of a month.
   *
   * The leftover becomes savings and is no longer spendable, so the next month
   * starts fresh from its own salary. It is recorded as a savings entry, never
   * as spending, which is why an unspent month never looks like an expense.
   *
   * Only a month that actually started can close, otherwise a month with no
   * salary would sweep a meaningless amount. Idempotent: re-running replaces the
   * previous carry entry, so it is safe to call on every app open.
   */
  carryOverToSavings(m) {
    const key = `carry_${m}`;
    const prev = Repo.get(key);
    if (prev) Repo.deleteSaving(prev);
    const amount = Repo.isMonthStarted(m) ? Repo.leftover(m) : 0;
    if (amount <= 0) {
      // nothing left to move, but the month is still closed so it is not
      // worked out again on every launch
      Repo.set(key, "");
      Repo.set(`carry_closed_${m}`, "1");
      return 0;
    }
    const id = Fmt.uid();
    Repo.addSaving(SavEntry({
      id, amount, date: Fmt.lastDayOf(m),
      note: "Left over from " + Fmt.monthLabel(m), dir: "in",
    }));
    Repo.set(key, id);
    Repo.set(`carry_closed_${m}`, "1");
    return amount;
  },

  isClosed(m) {
    return Repo.get(`carry_closed_${m}`, "") === "1";
  },

  isCarried(m) {
    return Repo.get(`carry_${m}`) !== "";
  },

  carriedAmount(m) {
    const id = Repo.get(`carry_${m}`);
    if (!id) return 0;
    return Repo.savingsAll().find((e) => e.id === id)?.amount ?? 0;
  },

  /** Forgets that a month was closed, so the leftover can be worked out again. */
  clearCarryOver(m) {
    const id = Repo.get(`carry_${m}`);
    if (id) Repo.deleteSaving(id);
    Repo.set(`carry_${m}`, "");
    Repo.set(`carry_closed_${m}`, "");
  },

  /**
   * Past months that have not been closed yet. Months are taken from every
   * source, not just the ones with a saved configuration, so a month that was
   * tracked on the default salary still gets its leftover swept.
   */
  monthsNeedingClose() {
    return Repo.allMonths()
      .filter((m) => Fmt.isPastMonth(m) && !Repo.isClosed(m))
      .sort();
  },

  /** Finishes any month that closed without its leftover being moved. */
  closeFinishedMonths() {
    return Repo.monthsNeedingClose().reduce((a, m) => a + Repo.carryOverToSavings(m), 0);
  },

  /** Every month that has an entry of any kind, newest first. */
  allMonths() {
    const out = new Set(Repo.monthsSet());
    for (const t of Db.table("tx")) out.add(Fmt.monthKey(t.date));
    for (const b of Db.table("room_bill")) out.add(Fmt.monthKey(b.date));
    for (const e of Db.table("savings_tx")) out.add(Fmt.monthKey(e.date));
    out.add(Fmt.thisMonth());
    return [...out].sort().reverse();
  },

  wipe() {
    Db.wipe();
  },
};

export { NeedItem, RoomBill, SavEntry, Tx, Bill };
