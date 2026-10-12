// Budget Planner - every edit and detail popup in the web app.
// Mirrors app/src/main/java/com/budgetplanner/ui/Dialogs.kt, and carries over the
// clarified gift rules: a `gave` entry with returnable = false is a gift, and
// money spent on a person is one personal entry linked to them.

import { Cats, Tx } from "../data/Models.js";
import { Repo } from "../data/Repo.js";
import { Fmt } from "../util/Fmt.js";
import { Screen, tone } from "./Kit.js";
import {
  Form, amountOf, closeSheet, confirmDelete, formDialog, openSheet, textOf, toast,
} from "./Form.js";
import { Scheduler } from "../notify/Scheduler.js";

/** Passed in by main.js so a dialog can ask the page to redraw itself. */
let refresh = () => {};

export function setRefresh(fn) {
  refresh = fn;
}

// ------------------------------------------------------------------ transactions

/**
 * Adds an entry.
 *
 * @param {"personal"|"gave"|"borrowed"} type
 * @param {object} [opts] { lockPerson } to preselect someone, for the Add page
 */
export function addTx(type, { lockPerson = null, lockPersonName = "" } = {}) {
  const f = new Form();
  const amount = f.money("Amount");
  const isPersonal = type === "personal";

  let cats = null;
  let personChoice = null;
  let newName = null;
  let retToggle = null;

  const allCats = Repo.cats();
  if (isPersonal) {
    cats = f.chips("Category", allCats, 0, () => {});
  } else {
    const people = Repo.people();
    // the Add page already knows who this is about
    const preIndex = lockPerson ? people.findIndex((p) => p.id === lockPerson) : -1;
    if (people.length === 0) {
      newName = f.text("Person's name", "e.g. Rahul");
    } else {
      personChoice = f.choice(
        "Person",
        people.map((p) => p.name),
        preIndex >= 0 ? preIndex : 0
      );
      newName = f.text("Or a different name", "leave blank to use the one above");
    }
    f.note(
      type === "gave"
        ? "You are handing this money over. Keep the switch on if you expect it back; turn it off and it is recorded as a gift."
        : "You received this money and will have to give it back."
    );
    if (type === "gave") {
      retToggle = f.toggle(
        "I expect this back",
        "Off means it was a gift and stays out of pending.",
        true
      );
    }
  }

  f.dateField("Date");
  const note = f.text("Note (optional)", "e.g. for groceries");

  formDialog("Add entry", f, (fm) => {
    const a = amountOf(amount);
    if (a <= 0) return "Enter an amount";

    if (isPersonal) {
      Repo.addTx({
        id: Fmt.uid(),
        type: "personal",
        amount: a,
        category: allCats[cats?.value ?? 0] ?? allCats[0],
        date: fm.date,
        note: textOf(note),
      });
    } else {
      // an explicit name always wins over the dropdown, same as the app
      const typed = newName ? textOf(newName) : "";
      let pid;
      if (typed === "" && personChoice) {
        pid = Repo.people()[personChoice.index]?.id;
      } else if (lockPerson && typed === "" && !personChoice) {
        pid = lockPerson;
      } else {
        pid = Repo.personId(typed);
      }
      if (!pid) return "Enter the person's name";

      Repo.addTx({
        id: Fmt.uid(),
        type,
        amount: a,
        personId: pid,
        date: fm.date,
        note: textOf(note),
        returnable: type === "borrowed" ? true : f.isOn(retToggle),
      });
    }
    refresh();
    Scheduler.checkLowBudgetNow({ date: fm.date, amount: a, type });
    return null;
  });
}

/**
 * The detail view for one entry, with the actions that apply to it.
 * The gift line is what tells the two "gave" cases apart on screen.
 */
export function txDetail(id) {
  const t = Repo.txById(id);
  if (!t) return;
  const name = txTitle(t);
  const meta = [Fmt.dayLabel(t.date), t.note || null, t.fromSavings ? "paid from savings" : null]
    .filter(Boolean)
    .join(" · ");
  const [status, statusTone] = txStatus(t);

  openSheet(name, (s) => {
    const col = el("div", "stack");
    if (meta) col.appendChild(el("div", "sub", meta));
    const amt = el("div", "big", Fmt.money(t.amount));
    amt.style.fontSize = "28px";
    amt.style.marginTop = "10px";
    col.appendChild(amt);
    const pill = el("span", "pill", status);
    pill.style.background = tone("soft");
    pill.style.color = tone(statusTone);
    pill.style.alignSelf = "flex-start";
    pill.style.marginTop = "10px";
    col.appendChild(pill);
    s.add(col);

    const acts = new Screen();
    const stack = acts.vstack();
    stack.style.marginTop = "18px";
    if (t.type !== "personal") {
      stack.appendChild(
        t.settled
        ? acts.buildButton("Mark as still open", {
            onClick: () => {
              Repo.unsettleTx(t.id);
              closeSheet();
              refresh();
            },
          })
        : acts.buildButton(Repo.isReturnable(t) ? "Settled - money moved" : "Mark as settled", {
            primary: Repo.isReturnable(t),
            onClick: () => {
              // settling an expected return moves the money, not just the flag
              if (Repo.isReturnable(t)) Repo.settleTx(t.id);
              else Repo.updateTx({ ...t, settled: true });
              closeSheet();
              refresh();
              if (Repo.isReturnable(t)) {
                toast(
                  t.type === "gave"
                    ? `Back from ${Repo.personName(t.personId)}`
                    : `Paid back to ${Repo.personName(t.personId)}`
                );
              }
            },
          })
      );
      if (!t.settled) {
        stack.appendChild(
          acts.buildButton(t.type === "gave" ? "They returned some" : "You paid back some", {
            onClick: () => {
              closeSheet();
              partialReturn(t);
            },
          })
        );
      }
      if (t.type === "gave") {
        stack.appendChild(
          acts.buildButton(t.returnable ? "Mark as a gift (not expected back)" : "Expect this back", {
            onClick: () => {
              Repo.updateTx({ ...t, returnable: !t.returnable });
              closeSheet();
              refresh();
            },
          })
        );
      }
    }
    stack.appendChild(
      acts.buildButton("Edit", {
        onClick: () => {
          closeSheet();
          editTx(t);
        },
      })
    );
    stack.appendChild(
      acts.buildButton("Delete", {
        danger: true,
        onClick: () => {
          closeSheet();
          confirmDelete("entry", () => {
            Repo.deleteTx(id);
            refresh();
          });
        },
      })
    );
    s.add(stack);
  });
}

export function txTitle(t) {
  if (t.type === "received") return "Money received";
  if (t.type === "gave") return `You gave ${Repo.personName(t.personId)}`;
  if (t.type === "borrowed") return `You borrowed from ${Repo.personName(t.personId)}`;
  return t.category || "Spending";
}

/** The word under the amount, and the colour it wears. */
export function txStatus(t) {
  if (t.type === "received") return ["Money came back", "ok"];
  if (t.settled) return ["Settled", "ok"];
  if (t.type === "gave" && !t.returnable) return ["Gift · no return expected", "muted"];
  if (t.type === "gave") return ["Still to get back", "warn"];
  if (t.type === "borrowed") return ["You still owe this", "bad"];
  return ["Spent", "muted"];
}

function partialReturn(t) {
  const f = new Form();
  const a = f.moneyPlain("Amount returned", Fmt.moneyPlain(t.amount));
  f.note("Anything you leave out stays open.");
  formDialog(t.type === "gave" ? "They returned" : "You paid back", f, () => {
    const v = amountOf(a);
    if (v <= 0) return "Enter an amount";
    if (v > t.amount) return `That is more than the ${Fmt.money(t.amount)} left open`;
    // only the part that changed hands is recorded as money moved
    Repo.settleMoney({
      personId: t.personId,
      amount: v,
      dir: t.type === "gave" ? "in" : "out",
      note: t.type === "gave"
        ? `Part back from ${Repo.personName(t.personId)}`
        : `Part paid to ${Repo.personName(t.personId)}`,
    });
    if (v >= t.amount) {
      Repo.updateTx({ ...t, settled: true });
    } else {
      // what is left stays open, as a fresh entry at the reduced amount
      Repo.addTx(
        Tx({
          id: Fmt.uid(),
          type: t.type,
          amount: round2(t.amount - v),
          category: t.category,
          personId: t.personId,
          date: Fmt.today(),
          note: `left open from ${Fmt.money(t.amount)}`,
          returnable: t.returnable,
        })
      );
      Repo.updateTx({ ...t, settled: true });
    }
    refresh();
    return null;
  });
}

function editTx(t) {
  const f = new Form();
  const a = f.moneyPlain("Amount", Fmt.moneyPlain(t.amount));
  f.setDate(t.date);
  f.dateField("Date");
  const note = f.text("Note (optional)", "", t.note);
  let cats = null;
  if (t.type === "personal") {
    const allCats = Repo.cats();
    cats = f.chips("Category", allCats, Math.max(0, allCats.indexOf(t.category)), () => {});
  }
  formDialog("Edit entry", f, (fm) => {
    const v = amountOf(a);
    if (v <= 0) return "Enter an amount";
    Repo.updateTx({
      ...t,
      amount: v,
      date: fm.date,
      note: textOf(note),
      category: t.type === "personal" ? Repo.cats()[cats?.value ?? 0] ?? t.category : t.category,
    });
    refresh();
    return null;
  });
}

// ------------------------------------------------------------------ savings

export function savingsMove(dir) {
  const f = new Form();
  const a = f.money("Amount");
  f.dateField("Date");
  const n = f.text("Note (optional)", "e.g. salary day transfer");
  formDialog(dir === "in" ? "Move into savings" : "Take out of savings", f, (fm) => {
    const v = amountOf(a);
    if (v <= 0) return "Enter an amount";
    Repo.addSaving({ id: Fmt.uid(), amount: v, date: fm.date, note: textOf(n), dir });
    refresh();
    return null;
  });
}

// ------------------------------------------------------------------ room

/**
 * A shared bill. Everyone is ticked to begin with, which is what makes a bill
 * between two people come out as half each with no extra taps.
 */
export function roomBill(existing = null) {
  const f = new Form();
  const a = f.money("Bill amount");
  const what = f.text("What is it for", "e.g. rent");
  f.setDate(existing?.date ?? Fmt.today());
  f.dateField("Date");
  const people = Repo.roomPeople();
  const paidBy = f.choice(
    "Paid by",
    people,
    Math.max(0, people.indexOf(existing?.paidBy ?? Cats.ME))
  );

  const picked = new Set(
    (existing?.splitWith ?? []).filter((n) => people.includes(n))
  );
  if (picked.size === 0) people.forEach((n) => picked.add(n));

  const each = el("div", "sub");
  const refreshEach = () => {
    const v = amountOf(a);
    const n = picked.size;
    each.textContent =
      n === 0
        ? "Tick at least one person, including yourself, to split this."
        : v <= 0
        ? n === 2
          ? `Split ${n} ways. Each pays half of the amount.`
          : `Split ${n} ways. Each pays an equal share.`
        : n === 2
        ? `Each pays ${Fmt.money(v / 2)} — half each.`
        : `Each pays ${Fmt.money(v / n)} — split ${n} ways.`;
  };
  a.addEventListener("input", refreshEach);

  f.label("Split between");
  for (const name of people) {
    f.toggle(name, "", picked.has(name), (on) => {
      if (on) picked.add(name);
      else picked.delete(name);
      refreshEach();
    });
  }
  f.add(each, 12);
  refreshEach();
  f.note("Keep yourself in the list unless you did not pay any of it yourself.");

  formDialog(existing == null ? "Add room bill" : "Edit room bill", f, (fm) => {
    const v = amountOf(a);
    if (v <= 0) return "Enter the bill amount";
    if (picked.size === 0) return "Pick at least one person to split with";
    const b = {
      id: existing?.id ?? Fmt.uid(),
      amount: v,
      note: textOf(what),
      date: fm.date,
      paidBy: paidBy.value,
      splitWith: [...picked],
      settled: existing?.settled ?? false,
    };
    if (existing == null) Repo.addRoom(b);
    else Repo.updateRoom(b);
    refresh();
    return null;
  });
}

export function roomDetail(b) {
  openSheet(b.note || "Shared bill", (s) => {
    const sc = new Screen();
    const col = sc.vstack();
    col.appendChild(sc.sub(`${Fmt.dayLabel(b.date)} · ${b.splitWith.length} way split`, 12.5));
    const amt = sc.big(Fmt.money(b.amount), 28);
    amt.style.marginTop = "10px";
    col.appendChild(amt);
    s.add(col);

    // one row per person, the payer first because they fronted the cash
    const ordered = [b.paidBy, ...b.splitWith.filter((n) => n !== b.paidBy)];
    const card = el("div", "card");
    card.style.padding = "0";
    ordered.forEach((name, i) => {
      if (i > 0) card.appendChild(el("div", "divider"));
      const isPayer = Fmt.same(name, b.paidBy);
      const r = el("div", "lrow");
      const av = el("div", "av", Fmt.initials(name));
      av.style.background = tone("card2");
      av.style.color = tone(isPayer ? "ok" : "muted");
      r.appendChild(av);
      const mid = el("div", "mid");
      mid.appendChild(el("div", "t", name));
      mid.appendChild(el("div", "s", isPayer ? "paid the whole bill" : "owes their share"));
      r.appendChild(mid);
      const a = el("div", "amt", isPayer ? Fmt.money(b.amount) : Fmt.money(Repo.share(b)));
      a.style.color = tone(isPayer ? "ok" : "ink");
      r.appendChild(a);
      card.appendChild(r);
    });
    s.add(card, 14);

    const owed = Repo.owedOn(b);
    if (b.paidBy === Cats.ME && owed > 0) {
      s.add(el("div", "note", `You are owed ${Fmt.money(owed)} from this bill.`), 12);
    }
    if (b.paidBy !== Cats.ME) {
      s.add(el("div", "note", `Your share is ${Fmt.money(Repo.share(b))}.`), 12);
    }

    const acts = new Screen();
    const stack = acts.vstack();
    stack.style.marginTop = "18px";
    stack.appendChild(
      acts.buildButton("Edit bill", {
        onClick: () => {
          closeSheet();
          roomBill(b);
        },
      })
    );
    if (b.paidBy !== Cats.ME) {
      stack.appendChild(
        acts.buildButton("Mark my share as settled", {
          primary: true,
          onClick: () => {
            Repo.updateRoom({ ...b, settled: true });
            closeSheet();
            refresh();
          },
        })
      );
    }
    stack.appendChild(
      acts.buildButton("Delete bill", {
        danger: true,
        onClick: () => {
          closeSheet();
          confirmDelete("bill", () => {
            Repo.deleteRoom(b.id);
            refresh();
          });
        },
      })
    );
    s.add(stack);
  });
}

// ------------------------------------------------------------------ roommates

/**
 * Add and remove the people room bills are shared with. You stay on the list,
 * and removing somebody leaves their past bills exactly as they are.
 *
 * This is what Profile calls: the list drives the People page as well, so
 * somebody added here can be picked as the person in an Add entry.
 */
/**
 * Records money that changed hands before the app was tracking it.
 *
 * Somebody remembers owing three hundred from March and wants it on the books
 * now. This writes a normal entry with an old date, so the balance, the history
 * and the "to settle" lists all pick it up exactly as if it had been entered on
 * the day it happened.
 */
export function oldEntry(onDone, kind = "borrowed") {
  const f = new Form();
  const DIRECTIONS = ["borrowed", "gave"];
  const direction = f.chips(
    "What happened",
    ["They gave me", "I gave them"],
    kind === "borrowed" ? 0 : 1
  );
  const amt = f.money("Amount", "0");
  const name = f.text("Who", "e.g. Rahul");
  f.setDate(Fmt.shiftDay(Fmt.today(), -30));
  const date = f.dateField("Date it happened");
  f.note(
    "Put the date it actually happened, and the balance for that month will " +
      "include it. Borrowed money stays as something you owe until you settle it."
  );

  formDialog("Add an older entry", f, () => {
    const a = amountOf(amt);
    if (a <= 0) return "Enter an amount";
    const who = textOf(name);
    if (!who) return "Enter the person's name";
    const pid = Repo.personId(who);
    const type = DIRECTIONS[direction.value] || "borrowed";
    Repo.addTx({
      id: Fmt.uid(),
      type,
      amount: a,
      personId: pid,
      date: f.dateValue,
      note: textOf(f.note_) || "Added later",
      // whatever direction this was, it is money that changed hands and is
      // still expected back unless it is later marked as a gift
      returnable: true,
    });
    toast(
      type === "borrowed"
        ? `Added ${Fmt.money(a)} you owe ${Repo.personName(pid)}`
        : `Added ${Fmt.money(a)} you gave ${Repo.personName(pid)}`
    );
    if (onDone) onDone();
  });
}

/**
 * Corrects the savings figure without inventing a transaction story: this is
 * the "the number is wrong, let me put it right" box.
 */
export function adjustSavings(onDone) {
  const f = new Form();
  const dir = f.chips("Which way", ["Add to savings", "Take out"], 0);
  const amt = f.money("Amount", "0");
  const date = f.dateField("Date");
  const note = f.text("Note", "optional");
  f.note(`Savings now: ${Fmt.money(Repo.savingsBalance())}`);

  formDialog("Correct your savings", f, () => {
    const a = amountOf(amt);
    if (a <= 0) return "Enter an amount";
    const out = dir.value === 1;
    if (out && a > Repo.savingsBalance()) {
      return `You only have ${Fmt.money(Repo.savingsBalance())} in savings`;
    }
    Repo.addSaving({
      id: Fmt.uid(),
      amount: a,
      date: f.dateValue,
      note: textOf(note) || "Correction",
      dir: out ? "out" : "in",
    });
    toast(`Savings now ${Fmt.money(Repo.savingsBalance())}`);
    if (onDone) onDone();
  });
}

export function roomPeople(onDone) {
  const sc = new Screen();
  const col = sc.vstack();
  col.appendChild(sc.label("Roommates", 17, "ink", true));
  col.appendChild(
    sc.sub("These names come up when you add a room bill. Everyone ticked is split equally.", 12.5)
  );

  const list = Repo.roomPeople();
  // The list is written straight through, so a name added here is saved even if
  // the sheet is closed by the cross or a swipe. Holding it in a local array
  // until "Done" is what made the Add button look like it had done nothing.
  const save = () => Repo.setRoomPeople(list);
  const listBox = el("div", "stack");

  const listRows = () => {
    listBox.textContent = "";
    if (list.length === 0) {
      listBox.appendChild(el("div", "sub", "Nobody here yet."));
      return;
    }
    list.forEach((name, i) => {
      if (i > 0) listBox.appendChild(el("div", "divider"));
      const row = el("div", "flexrow");
      const lbl = el("div", "label", name);
      lbl.style.flex = "1";
      row.appendChild(lbl);
      if (name === Cats.ME) {
        row.appendChild(el("div", "sub", "that's you"));
      } else {
        const rm = sc.buildButton("Remove", {
          danger: true,
          onClick: () => {
            list.splice(list.indexOf(name), 1);
            save();
            listRows();
            refresh();
          },
        });
        rm.classList.add("sm");
        rm.style.flex = "0 0 92px";
        rm.style.textAlign = "center";
        row.appendChild(rm);
      }
      listBox.appendChild(row);
    });
  };
  listRows();
  listBox.style.marginTop = "12px";
  col.appendChild(listBox);

  const input = el("input", "field");
  input.placeholder = "Roommate name";
  input.style.marginTop = "12px";
  col.appendChild(input);

  const addTyped = () => {
    const name = input.value.trim();
    if (!name) return toast("Enter a name");
    // case does not matter: "Ravi" and "RAVI" are the same roommate
    if (Fmt.same(name, Cats.ME)) return toast("You are already on the list");
    if (list.some((n) => Fmt.same(n, name))) {
      input.value = "";
      return toast(`${name} is already on the list`);
    }
    list.push(name);
    save();
    input.value = "";
    listRows();
    refresh();
    toast(`${name} added`);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTyped();
    }
  });

  const add = sc.buildButton("Add roommate", { primary: true, onClick: addTyped });
  add.style.marginTop = "8px";
  col.appendChild(add);

  openSheet("Roommates", (s) => {
    s.add(col);
    // everything is already saved, so this only closes
    const done = sc.buildButton("Done", {
      primary: true,
      onClick: () => {
        closeSheet();
        onDone?.();
        refresh();
      },
    });
    done.style.marginTop = "12px";
    s.add(done);
  });
}

// ------------------------------------------------------------------ categories

/** Add and remove your own categories. Built-ins stay put. */
export function manageCats(onDone) {
  const sc = new Screen();
  const col = sc.vstack();
  col.appendChild(sc.label("Your categories", 17, "ink", true));
  col.appendChild(sc.sub("Add things like Petrol, Rent or School fees.", 12.5));

  const listBox = el("div", "stack");
  const listRows = () => {
    listBox.textContent = "";
    const custom = Repo.customCats();
    if (custom.length === 0) {
      listBox.appendChild(el("div", "sub", "No custom categories yet."));
      return;
    }
    custom.forEach((name, i) => {
      if (i > 0) listBox.appendChild(el("div", "divider"));
      const row = el("div", "flexrow");
      const lbl = el("div", "label", name);
      lbl.style.flex = "1";
      row.appendChild(lbl);
      const rm = sc.buildButton("Remove", {
        danger: true,
        onClick: () => {
          Repo.removeCat(name);
          listRows();
        },
      });
      rm.classList.add("sm");
      rm.style.flex = "0 0 92px";
      rm.style.textAlign = "center";
      row.appendChild(rm);
      listBox.appendChild(row);
    });
  };
  listRows();
  listBox.style.marginTop = "12px";
  col.appendChild(listBox);

  const input = el("input", "field");
  input.placeholder = "e.g. Petrol";
  input.style.marginTop = "12px";
  col.appendChild(input);

  const addTyped = () => {
    const name = input.value.trim();
    if (!name) return toast("Type a category first");
    const ok = Repo.addCat(name);
    input.value = "";
    if (!ok) return toast(`${name} is already in the list`);
    listRows();
    refresh();
    toast(`${name} added`);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTyped();
    }
  });

  const add = sc.buildButton("Add category", { primary: true, onClick: addTyped });
  add.style.marginTop = "8px";
  col.appendChild(add);

  openSheet("Categories", (s) => {
    s.add(col);
    const done = sc.buildButton("Done", {
      primary: true,
      onClick: () => {
        closeSheet();
        onDone?.();
        refresh();
      },
    });
    done.style.marginTop = "12px";
    s.add(done);
  });
}

// ------------------------------------------------------------------ needs

export function need(existing = null) {
  const f = new Form();
  const t = f.area("What do you need money for?", "e.g. bike service");
  const a = f.moneyPlain("How much (optional)");
  const from = f.text("From whom (optional)", "e.g. Dad");
  f.setDate(existing?.date ?? Fmt.today());
  f.dateField("Needed by");
  formDialog(existing == null ? "Money I need" : "Edit", f, (fm) => {
    const txt = textOf(t);
    if (!txt) return "Write what you need money for";
    const n = {
      id: existing?.id ?? Fmt.uid(),
      text: txt,
      amount: amountOf(a),
      fromWhom: textOf(from),
      date: fm.date,
      done: existing?.done ?? false,
    };
    if (existing == null) Repo.addNeed(n);
    else Repo.updateNeed(n);
    refresh();
    return null;
  });
}

export function needDetail(id) {
  const n = Repo.needs().find((x) => x.id === id);
  if (!n) return;
  const sc = new Screen();
  const col = sc.vstack();
  if (n.amount > 0) col.appendChild(sc.big(Fmt.money(n.amount), 26, "brand"));
  const t = sc.label(n.text, 17, "ink", true);
  t.style.marginTop = "6px";
  col.appendChild(t);
  col.appendChild(
    sc.sub([n.fromWhom || null, Fmt.dayLabel(n.date)].filter(Boolean).join(" · "), 12.5)
  );

  openSheet(n.text, (s) => {
    s.add(col);
    const acts = new Screen();
    const stack = acts.vstack();
    stack.style.marginTop = "18px";
    stack.appendChild(
      acts.buildButton(n.done ? "Mark as still needed" : "I got it", {
        primary: !n.done,
        onClick: () => {
          Repo.updateNeed({ ...n, done: !n.done });
          closeSheet();
          refresh();
        },
      })
    );
    if (!n.done && n.amount > 0) {
      stack.appendChild(
        acts.buildButton("Record money they gave me", {
          onClick: () => {
            closeSheet();
            gotMoney(n);
          },
        })
      );
    }
    stack.appendChild(
      acts.buildButton("Edit", {
        onClick: () => {
          closeSheet();
          need(n);
        },
      })
    );
    stack.appendChild(
      acts.buildButton("Delete", {
        danger: true,
        onClick: () => {
          closeSheet();
          confirmDelete("request", () => {
            Repo.deleteNeed(id);
            refresh();
          });
        },
      })
    );
    s.add(stack);
  });
}

/**
 * Money that arrived against a request. The same "gave" entry the Add page
 * would create, so a gift given here still reads as a gift on the People page.
 */
function gotMoney(n) {
  const f = new Form();
  const a = f.moneyPlain("Amount received", n.amount > 0 ? Fmt.moneyPlain(n.amount) : "");
  const from = f.text("From whom", n.fromWhom);
  f.setDate(Fmt.today());
  f.dateField("Date received");
  const ret = f.toggle("I expect this back", "Off means it was a gift.", true);
  formDialog("Money received", f, (fm) => {
    const v = amountOf(a);
    if (v <= 0) return "Enter the amount";
    const pid = Repo.personId(textOf(from));
    if (!pid) return "Enter who gave it";
    Repo.addTx({
      id: Fmt.uid(),
      type: "gave",
      amount: v,
      personId: pid,
      date: fm.date,
      note: n.text,
      returnable: f.isOn(ret),
    });
    Repo.updateNeed({ ...n, done: true });
    refresh();
    return null;
  });
}

// ------------------------------------------------------------------ bills

export function billEdit(existing = null) {
  const f = new Form();
  const name = f.text("Bill name", "e.g. WiFi", existing?.name ?? "");
  const amt = f.moneyPlain(
    "Amount every month",
    (existing?.amount ?? 0) > 0 ? Fmt.moneyPlain(existing.amount) : ""
  );
  const day = f.moneyPlain("Due day of month (1-28)", existing ? String(existing.dueDay) : "1");
  const note = f.text("Note (optional)", "", existing?.note ?? "");
  const act = f.toggle(
    "Remind me every month",
    "You'll be notified if it isn't marked paid.",
    existing?.active ?? true
  );
  f.note("The day is capped at 28 so every month has that date.");
  formDialog(existing == null ? "Add monthly bill" : "Edit bill", f, () => {
    const n = textOf(name);
    if (!n) return "Give the bill a name";
    const b = {
      id: existing?.id ?? Fmt.uid(),
      name: n,
      amount: amountOf(amt),
      dueDay: Math.min(28, Math.max(1, Math.round(amountOf(day)))),
      note: textOf(note),
      active: f.isOn(act),
      paidMonth: existing?.paidMonth ?? "",
    };
    if (existing == null) Repo.addBill(b);
    else Repo.updateBill(b);
    refresh();
    return null;
  });
}

export function billDetail(b) {
  const m = Fmt.thisMonth();
  const paid = b.isPaidThis(m);
  const sc = new Screen();
  const col = sc.vstack();
  col.appendChild(sc.label(b.name, 18, "ink", true));
  col.appendChild(sc.sub(`Due on day ${b.dueDay} every month`, 12.5));
  if (b.amount > 0) {
    const amt = sc.big(Fmt.money(b.amount), 26);
    amt.style.marginTop = "10px";
    col.appendChild(amt);
  }
  const pill = sc.pill(
    paid ? `Paid for ${Fmt.monthLabel(m)}` : `Not paid for ${Fmt.monthLabel(m)}`,
    "soft",
    paid ? "ok" : "bad"
  );
  pill.style.alignSelf = "flex-start";
  pill.style.marginTop = "12px";
  col.appendChild(pill);

  openSheet(b.name, (s) => {
    s.add(col);
    const acts = new Screen();
    const stack = acts.vstack();
    stack.style.marginTop = "18px";
    stack.appendChild(
      acts.buildButton(paid ? "Undo · mark as unpaid" : "Mark as paid", {
        primary: !paid,
        onClick: () => {
          if (paid) Repo.unmarkBill(b.id);
          else Repo.markBillPaid(b.id, m);
          closeSheet();
          refresh();
        },
      })
    );
    stack.appendChild(
      acts.buildButton("Edit bill", {
        onClick: () => {
          closeSheet();
          billEdit(b);
        },
      })
    );
    stack.appendChild(
      acts.buildButton("Delete bill", {
        danger: true,
        onClick: () => {
          closeSheet();
          confirmDelete("bill", () => {
            Repo.deleteBill(b.id);
            refresh();
          });
        },
      })
    );
    s.add(stack);
  });
}

// ------------------------------------------------------------------ small helpers

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}
