// Budget Planner - Add.
// Mirrors app/src/main/java/com/budgetplanner/ui/AddFragment.kt, reshaped into
// four top-level modes as agreed: Spent, Gave, Borrowed and Savings. Savings
// then asks in or out, instead of being two separate chips.
//
// The one thing worth reading twice: Spent can be "money I spent for somebody".
// That is still recorded as spending, so it counts against the month, and the
// person is attached so it also shows under them as money they owe you. It is
// one entry, not two. It is only a gift if the person says so, which is what
// the "a gift, they will not give it back" switch is for.

import { BILL_WORDS, isRoomText } from "../../data/BillWords.js";
import { Cats, round2 } from "../../data/Models.js";
import { Repo } from "../../data/Repo.js";
import { Fmt } from "../../util/Fmt.js";
import { Anim } from "../Anim.js";
import { ChipGroup, amountOf, onlyNumbers, textOf, toast } from "../Form.js";
import { Screen, toggleRow } from "../Kit.js";
import { openCalendar } from "../Calendar.js";
import { Pages } from "../Pages.js";
import { Scheduler } from "../../notify/Scheduler.js";

/** The people a room entry is shared with: every roommate except the user. */
function roommates() {
  return Repo.roomPeople().filter((n) => !Fmt.same(n, Cats.ME));
}

/**
 * True when this entry is a shared room thing.
 *
 * The user said where this goes in plain words: "room" in what it was for, and
 * the bills in the note underneath. Reading it that way saves a whole extra
 * question to answer before every rent payment.
 */
function roomIn(what, note) {
  return isRoomText(what) || isRoomText(note);
}

/** The bills a room entry can cover, in the order they are offered. */
const BILL_NAMES = BILL_WORDS.map(([name]) => name);

/** What a room entry will do, in one line, before it is saved. */
function roomShareNote() {
  const with_ = roommates();
  if (with_.length === 0) {
    return "No roommate is set up yet, so this is saved as your spending only. Add one from Profile.";
  }
  return `Splits equally with ${with_.join(", ")}. Your share is added as spending, their share shows as money they owe you.`;
}

/**
 * The bills this room entry covers, as chips that can be ticked.
 *
 * Tapping is the whole point: the app used to have to guess which bills a line
 * of typing meant, and guessing wrong quietly marks the wrong thing as paid.
 */
function billPicker(s, ctx) {
  s.section("What is it for");
  const scroll = document.createElement("div");
  scroll.className = "chipscroll";
  for (const name of BILL_NAMES) {
    const on = state.roomItems.includes(name);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (on ? " on" : "");
    chip.textContent = name;
    chip.addEventListener("click", () => {
      Anim.dip(chip);
      const i = state.roomItems.indexOf(name);
      if (i === -1) state.roomItems.push(name);
      else state.roomItems.splice(i, 1);
      chip.classList.toggle("on");
      line.textContent = summaryText();
    });
    scroll.appendChild(chip);
  }
  s.add(scroll);
  const line = document.createElement("div");
  line.className = "note";
  const summaryText = () =>
    state.roomItems.length
      ? `Marks paid for ${Fmt.monthLabel(Fmt.monthKey(state.date))}: ${state.roomItems.join(", ")}.`
      : "Nothing ticked, so no bill is marked paid.";
  line.textContent = summaryText();
  s.add(line, 8);
}

/**
 * The form's state, kept outside the Screen so switching mode does not throw
 * away what was already typed.
 *
 * The typed values live here as well as in their boxes, because parts of the
 * form are rebuilt when a switch is flipped - the note under "paid from"
 * changes, the person block appears - and a part-filled form has to survive
 * that. Clearing an amount somebody had already keyed in is the kind of small
 * betrayal that makes an app tiring to use.
 */
const state = {
  mode: "spent",
  savDir: "in",
  fromSavings: false,
  date: Fmt.today(),
  personId: null,
  gift: false,
  // "room" means this is shared with the roommates, and roomItems are the bills
  // it covers, ticked rather than typed
  roomShare: false,
  roomItems: [],
  amount: "",
  what: "",
  note: "",
  personName: "",
  // the people a bill is being split between, and whether the user is one of
  // them. Empty means the entry is not a split at all.
  split: [],
  splitWithMe: false,
};

export function reset() {
  state.mode = "spent";
  state.savDir = "in";
  state.fromSavings = false;
  state.date = Fmt.today();
  state.personId = null;
  state.gift = false;
  state.roomShare = false;
  state.roomItems = [];
  state.amount = "";
  state.what = "";
  state.note = "";
  state.personName = "";
  state.split = [];
  state.splitWithMe = false;
}

/**
 * Only the part of the page under the chips is rebuilt when the mode changes.
 * The chips, the heading and the scroll place all stay exactly where they
 * were, so switching between Spent and Savings does not feel like the app
 * reloading under your finger.
 */
let bodyHost = null;

export function build(ctx) {
  const s = new Screen();

  s.section("What are you adding?");
  s.chips(
    [
      ["spent", "I spent"],
      ["gave", "I gave"],
      ["borrowed", "I borrowed"],
      ["savings", "Savings"],
    ],
    state.mode,
    (picked) => {
      if (picked === state.mode) return;
      state.mode = picked;
      renderBody(ctx);
    }
  );
  s.spacer(4);

  bodyHost = document.createElement("div");
  s.add(bodyHost);
  renderBody(ctx);

  // This is the page the app opens on, so the amount box takes the keyboard
  // straight away. Only on a real keyboard: popping the soft keyboard up by
  // itself would cover half the screen on a phone.
  const amt = bodyHost.querySelector(".hero-amount");
  if (amt && matchMedia("(pointer: fine)").matches) {
    requestAnimationFrame(() => amt.focus({ preventScroll: true }));
  }

  return s;
}

/** Fills the area under the chips with the form for the current mode. */
function renderBody(ctx) {
  if (!bodyHost) return;
  const inner = new Screen();
  if (state.mode === "spent") spentBody(inner, ctx);
  else if (state.mode === "gave" || state.mode === "borrowed") personBody(inner, ctx);
  else savingsBody(inner, ctx);
  bodyHost.replaceChildren(inner.root);
}

/** The big amount box at the top of every mode. */
function amountHero(s, label, onChange = () => {}) {
  let amt;
  s.heroCard((c) => {
    c.add(c.label(label, 11, "ink", true));
    amt = c.add(c.hstack(), 4);
    const input = document.createElement("input");
    input.className = "hero-amount";
    input.type = "text";
    input.inputMode = "decimal";
    input.placeholder = "0";
    onlyNumbers(input);
    input.value = state.amount;
    input.addEventListener("input", () => {
      state.amount = input.value;
      onChange();
    });
    amt.appendChild(input);
    amt._input = input;
  });
  return amt._input;
}

function amountBlock(s, label, onChange = () => {}) {
  s.section(label);
  const input = document.createElement("input");
  input.className = "field money";
  input.type = "text";
  input.inputMode = "decimal";
  input.placeholder = "0";
  onlyNumbers(input);
  input.value = state.amount;
  input.addEventListener("input", () => {
    state.amount = input.value;
    onChange();
  });
  s.add(input);
  return input;
}

/** The date row: the browser's own date picker behind a tappable box. */
function dateRow(s) {
  s.section("Date");
  const t = s.buildButton("", { ghost: true });
  t.classList.add("date-pick");
  const paint = () => (t.textContent = `${Fmt.dayLabel(state.date)}  ·  ${state.date}`);
  paint();
  // the app's own calendar: today is the last day, because money is spent on the
  // day it is spent
  t.addEventListener("click", () => {
    openCalendar({
      value: state.date,
      onPick: (d) => {
        state.date = d;
        paint();
      },
    });
  });
  s.add(t);
  return t;
}
function spentBody(s, ctx) {
  const amt = amountHero(s, "AMOUNT SPENT");

  s.section("Who is this for");
  s.chips(
    [
      ["me", "Just me"],
      ["room", "My room"],
    ],
    state.roomShare ? "room" : "me",
    (k) => {
      state.roomShare = k === "room";
      renderBody(ctx);
    }
  );
  let what = null;
  if (state.roomShare) {
    s.note(roomShareNote());
  } else {
    s.section("What was it for");
    what = liveField("field", "e.g. petrol", "what");
    s.add(what);
    s.note("Anything at all, such as petrol or groceries. Leave it blank if you do not want to label it.");
  }

  s.section("Paid from");
  s.chips(
    [
      ["salary", "This month's salary"],
      ["savings", "My savings"],
    ],
    state.fromSavings ? "savings" : "salary",
    (k) => {
      const was = state.fromSavings;
      state.fromSavings = k === "savings";
      // only the note underneath depends on the choice, and it is in the body
      if (was !== state.fromSavings) renderBody(ctx);
    }
  );
  if (state.fromSavings) {
    const have = Repo.savingsBalance();
    s.note(
      have > 0
        ? `You have ${Fmt.money(have)} in savings. This will be taken out of savings and still counted as spending.`
        : "You have nothing recorded in savings yet. This will still be logged as spending."
    );
  }

  if (state.roomShare) billPicker(s, ctx);

  const dateBox = dateRow(s);

  s.section("Note");
  const note = liveField("field", "Note (optional)", "note");
  s.add(note);

  s.spacer(12);
  s.button("Save spending", {
    primary: true,
    onClick: () => {
      const a = amountOf(amt);
      if (a <= 0) {
        Anim.shake(amt);
        return toast("Enter an amount");
      }
      // A room entry is chosen with one tap, and the bills it covers are ticked
      // rather than typed. Typing the word "room" still works, so a habit formed
      // in the first day does not quietly stop splitting halfway through a month.
      const roomSplit = state.roomShare || roomIn(what?.value, state.note);
      const label = roomSplit ? "Room" : labelOf(what);
      const reason = [state.note.trim(), roomSplit ? state.roomItems.join(", ") : ""]
        .filter(Boolean)
        .join(" · ");
      // a room entry is shared with the roommates; anything else is the user's
      // own spending, and money handed to a person is entered under I gave
      const chosen = roomSplit
        ? roommates().map((n) => Repo.personId(n)).filter(Boolean)
        : [];
      const withMe = roomSplit;
      const ways = chosen.length + (withMe ? 1 : 0);

      // One person and no split means the whole amount is theirs: the entry
      // carries the person, and it is what they owe back.
      //
      // A split is recorded the way it is actually paid: the user's own share as
      // spending, and each other person's share as money they owe. Recording the
      // whole amount as spending and then adding the shares on top would count
      // the same money twice in the month.
      const each = ways > 1 ? Math.floor((a / ways) * 100) / 100 : 0;
      // the user's share is what is left once the others have taken theirs, so
      // rounding never loses or invents a rupee
      const mine = ways > 1 && withMe ? round2(a - each * chosen.length) : a;
      const t = {
        id: Fmt.uid(),
        type: "personal",
        amount: mine,
        category: label,
        date: state.date,
        note: reason,
        fromSavings: state.fromSavings,
        personId: null,
        // the user is spending their own money here; the roommate's share is
        // the part that is owed back, and it is recorded on its own below
        returnable: false,
      };
      Repo.addSpending(t);

      let learned = [];
      if (ways > 1) {
        for (const id of chosen) {
          Repo.addTx({
            id: Fmt.uid(),
            type: "gave",
            amount: each,
            personId: id,
            date: t.date,
            category: label,
            // ties the share back to the entry it came from
            group: t.id,
            note: `${label || "Split bill"} · ${ways} ways, ${Fmt.money(each)} each`,
            returnable: true,
          });
        }
        const who = chosen.map((id) => Repo.personName(id)).join(", ");
        toast(`${Fmt.money(a)} split ${ways} ways · ${Fmt.money(each)} each · ${who} to pay back`, { good: true });
      } else {
        toast(
          state.fromSavings
            ? "Saved the entry, and took it out of savings"
            : `Added ${Fmt.money(a)} spending`
        );
      }

      // a room entry is also the list of bills that just got paid, which is
      // what the weekly check looks at
      if (roomSplit) {
        // the ticked bills, plus anything the note mentioned that is not one of
        // the standard ones
        const said = [state.roomItems.join(" "), state.note].join(" ");
        learned = Repo.learnBills(said, Fmt.monthKey(state.date));
        if (learned.length) toast(`Marked paid: ${learned.join(", ")}`);
      }

      // the instant low-budget nudge, same as the Android path
      Scheduler.checkLowBudgetNow(t);
      reset();
      ctx.open(Pages.HOME);
    },
  });
}

// ------------------------------------------------------------------ people

function personBody(s, ctx) {
  const giving = state.mode === "gave";

  s.card((c) => {
    c.add(
      c.label(
        giving ? "You are giving money to someone" : "You received money from someone",
        15,
        "ink",
        true
      )
    );
    c.add(
      c.sub(
        giving
          ? "It stays as pending until they give it back, unless you switch it off."
          : "It shows as money you owe until you settle it, unless it was a gift.",
        12.5
      )
    );
  });

  const amt = amountBlock(s, "Amount");

  s.section("Person");
  personPicker(s, ctx);

  s.section("Return");
  s.chips(
    [
      ["yes", giving ? "Expect it back" : "I will return it"],
      ["no", giving ? "Gift / no return" : "Gift, I will not return it"],
    ],
    state.gift ? "no" : "yes",
    (k) => {
      state.gift = k === "no";
    }
  );
  s.note(
    giving
      ? state.gift
        ? "A gift is not pending: it will not show under To settle."
        : "It stays as pending until they give it back, unless you switch it off."
      : state.gift
        ? "Money you were given and will not return. It shows as a gift, never as something you owe."
        : "It shows as money you owe until you settle it."
  );

  dateRow(s);
  s.section("Note");
  const note = liveField("field", "Note (optional)", "note");
  s.add(note);

  s.spacer(12);
  s.button(giving ? "Save · I gave this" : "Save · I borrowed this", {
    primary: true,
    onClick: () => {
      const a = amountOf(amt);
      if (a <= 0) {
        Anim.shake(amt);
        return toast("Enter an amount");
      }
      const pid = resolvePerson();
      if (!pid) return toast("Enter the person's name");
      Repo.addTx({
        id: Fmt.uid(),
        type: state.mode,
        amount: a,
        personId: pid,
        date: state.date,
        note: note.value.trim(),
        // both directions can be a gift: money handed over for nothing, and
        // money taken that never has to go back
        returnable: !state.gift,
      });
      toast(
        state.gift
          ? `Recorded ${giving ? "as a gift you gave" : "as a gift you received"}`
          : giving
            ? "Recorded"
            : "Added to what you owe"
      );
      reset();
      ctx.open(Pages.HOME);
    },
  });
}

/** The known-people chips plus a free-text name, shared by both person modes. */
/**
 * Who this entry is for.
 *
 * Two shapes, chosen by `multi`:
 *   - single: one person, as before. Picking a chip writes the name into the
 *     box, so the exact spelling that was chosen is on screen to be checked.
 *   - multi: a bill being shared out. Several people can be picked, the amount
 *     is divided between them, and the user can include themselves in the
 *     split, which is the normal case for a dinner or a taxi.
 */
function personPicker(s, ctx, multi = false) {
  const people = Repo.people();
  const box = () => document.getElementById("newPersonName");
  const showNames = (names) => {
    state.personName = names.join(", ");
    const b = box();
    if (b) b.value = state.personName;
  };

  if (people.length > 0) {
    const names = multi
      ? [...people.filter((p) => state.split.includes(p.id)).map((p) => p.name), ...(state.splitWithMe ? [Cats.ME] : [])]
      : [Repo.personName(state.personId)].filter((n) => n && n !== "Someone");
    const group = new ChipGroup(people.map((p) => p.name), -1, (i) => {
      const p = people[i];
      if (multi) {
        const at = state.split.indexOf(p.id);
        if (at >= 0) state.split.splice(at, 1);
        else state.split.push(p.id);
        renderBody(ctx);
      } else {
        state.personId = p.id;
        // the name goes in the box as well as lighting up the chip, so the
        // exact person can be read back and corrected by hand if need be
        showNames([p.name]);
        refreshChips(group, i);
      }
    });
    // chips that are already chosen start lit
    if (multi) {
      people.forEach((p, i) => group.chips[i].classList.toggle("on", state.split.includes(p.id)));
    } else if (people.findIndex((p) => p.id === state.personId) >= 0) {
      refreshChips(group, people.findIndex((p) => p.id === state.personId));
    }
    s.add(group.row);

    if (multi) {
      // the user is often part of the split, and saying so is the difference
      // between "3 ways" and "2 ways plus me"
      const me = new ChipGroup([`${Cats.ME} (that's you)`], 0, () => {
        state.splitWithMe = !state.splitWithMe;
        renderBody(ctx);
      });
      me.chips[0].classList.toggle("on", state.splitWithMe);
      s.add(me.row);
      shareSummary(s);
    }
    s.section("Or someone new");
  }

  const input = liveField("field", "e.g. Rahul", "personName", { id: "newPersonName" });
  input.addEventListener("input", () => {
    // a typed name always beats a chip
    if (input.value.trim()) {
      state.personId = null;
      state.split = [];
      state.splitWithMe = false;
    }
  });
  s.add(input);
  if (multi && state.split.length === 0 && !input.value.trim()) {
    s.note("Pick the people to share this between. Leave it empty if the whole amount is yours.");
  }
}

/** Lights the one chip that was chosen, and puts the rest out. */
function refreshChips(group, on) {
  group.chips.forEach((c, i) => c.classList.toggle("on", i === on));
}

/** How the amount lands when a bill is shared out. */
function shareSummary(s) {
  const count = state.split.length + (state.splitWithMe ? 1 : 0);
  if (count === 0) return;
  const amount = amountOf(state.amount);
  const each = amount > 0 ? Math.floor((amount / count) * 100) / 100 : 0;
  const line = document.createElement("div");
  line.className = "note";
  line.textContent = each > 0
    ? `Split ${count} ways · ${Fmt.money(each)} each` +
      (state.splitWithMe ? `, so ${Fmt.money(each)} of it is yours` : "")
    : `Split ${count} ways. Enter an amount to see each share.`;
  s.add(line);
}

/** A typed name always wins over a chip, the same rule the dialogs use. */
function resolvePerson() {
  const box = document.getElementById("newPersonName");
  const typed = (box ? box.value : state.personName).trim();
  if (typed) return Repo.personId(typed);
  return state.personId;
}

// ------------------------------------------------------------------ savings

function savingsBody(s, ctx) {
  s.chips(
    [
      ["in", "Into savings"],
      ["out", "Out of savings"],
    ],
    state.savDir,
    (k) => {
      state.savDir = k;
      renderBody(ctx);
    }
  );
  s.spacer(4);

  const into = state.savDir === "in";
  const balance = Repo.savingsBalance();

  s.card((c) => {
    c.add(c.label(into ? "Currently in savings" : "Available in savings", 12.5, "muted", true));
    const v = c.big(Fmt.money(balance), 28, balance > 0 ? "ok" : "muted");
    v.style.marginTop = "4px";
    c.add(v);
  });

  const amt = amountBlock(s, "How much");
  dateRow(s);
  s.section("Note");
  const note = liveField("field", "Note (optional)", "note");
  s.add(note);

  s.spacer(12);
  s.button(into ? "Move into savings" : "Take out of savings", {
    primary: true,
    onClick: () => {
      const a = amountOf(amt);
      if (a <= 0) {
        Anim.shake(amt);
        return toast("Enter an amount");
      }
      if (!into && a > balance) {
        Anim.shake(amt);
        return toast(`You only have ${Fmt.money(balance)} in savings`);
      }
      Repo.addSaving({
        id: Fmt.uid(),
        amount: a,
        date: state.date,
        note: note.value.trim(),
        dir: into ? "in" : "out",
      });
      toast(into ? "Moved into savings" : "Taken out of savings", { good: true });
      reset();
      ctx.open(Pages.SAVINGS);
    },
  });

  s.button("Open the Savings page", { onClick: () => ctx.open(Pages.SAVINGS) });
}

// ------------------------------------------------------------------ helpers

/**
 * A plain text box that keeps its value in the form's state, so rebuilding the
 * part of the form under the chips does not wipe what was typed into it.
 */
function liveField(cls, placeholder, key, opts = {}) {
  const e = document.createElement("input");
  e.className = cls;
  e.placeholder = placeholder;
  if (opts.id) e.id = opts.id;
  if (opts.autocomplete) e.autocomplete = opts.autocomplete;
  e.value = state[key] || "";
  e.addEventListener("input", () => {
    state[key] = e.value;
  });
  return e;
}

/**
 * Whatever was typed, matched against the labels already on file so "Rent" and
 * "rent" land in the same group instead of splitting in two.
 */
function labelOf(input) {
  const typed = input.value.trim();
  if (!typed) return "Other";
  return Repo.cats().find((c) => Fmt.same(c, typed)) || typed;
}
