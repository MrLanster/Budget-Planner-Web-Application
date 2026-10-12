// Budget Planner - data models.
// Mirrors app/src/main/java/com/budgetplanner/data/Models.kt.
// Keep the two in step: same field names, same meaning.

/**
 * A money movement. type = personal | gave | borrowed
 *
 * returnable means "a return is expected", and it is the single switch behind
 * the whole gift idea:
 *   gave     + returnable     -> they owe you, stays open until settled
 *   gave     + !returnable    -> gift you gave, nothing pending
 *   borrowed + returnable     -> you owe them, stays open until settled
 *   borrowed + !returnable    -> gift you received, nothing to return
 *   personal + personId       -> spending that was a gift to that person
 */
export function Tx(o = {}) {
  return {
    id: o.id,
    // personal = ordinary spending, gave = they owe you, borrowed = you owe
    // them, received = money that came back to you when they settled up
    type: o.type,
    amount: o.amount,
    category: o.category ?? null,
    personId: o.personId ?? null,
    date: o.date,
    note: o.note ?? "",
    returnable: !!o.returnable,
    settled: !!o.settled,
    // true when this spending was paid out of savings rather than salary
    fromSavings: !!o.fromSavings,
    // set on a share of a split bill, holding the id of the bill it came from,
    // so the shares can be deleted along with it
    group: o.group ?? null,
  };
}

/** A shared household bill. splitWith is the list of people sharing it. */
export function RoomBill(o = {}) {
  return {
    id: o.id,
    amount: o.amount,
    note: o.note ?? "",
    date: o.date,
    paidBy: o.paidBy,
    splitWith: o.splitWith ?? [],
    settled: !!o.settled,
  };
}

/** Money moved into or out of savings. dir = in | out */
export function SavEntry(o = {}) {
  return {
    id: o.id,
    amount: o.amount,
    date: o.date,
    note: o.note ?? "",
    dir: o.dir,
  };
}

/** Something the user still needs money for. */
export function NeedItem(o = {}) {
  return {
    id: o.id,
    text: o.text,
    amount: o.amount ?? 0,
    fromWhom: o.fromWhom ?? "",
    date: o.date ?? "",
    done: !!o.done,
  };
}

export const Person = (id, name) => ({ id, name });

/** Everything the app knows about one person, across all months. */
export function PersonSum(person) {
  return {
    person,
    theyOweMe: 0,      // I gave it, returnable, not settled
    iOweThem: 0,       // I borrowed it, returnable, not settled
    gaveTotal: 0,
    receivedTotal: 0,
    giftGiven: 0,      // gave as a gift, or spent as a gift to them
    giftReceived: 0,   // borrowed as a gift
    entries: 0,
  };
}

export function personSumNet(p) {
  const net = round2(p.theyOweMe - p.iOweThem);
  return {
    ...p,
    net,
    // both sides are zero once nothing is expected either way
    settled: p.theyOweMe <= 0 && p.iOweThem <= 0,
  };
}

/** Gift value in both directions. Nothing here is ever pending. */
export function personSumGiftTotal(p) {
  return round2(p.giftGiven + p.giftReceived);
}

/**
 * A fixed bill that repeats every month (wifi, rent, recharge...).
 * paidMonth is the "YYYY-MM" it was last marked paid.
 *
 * The three checks are methods, not free functions, so the same reads
 * `b.isOverdue(month, day)` here as it does in Kotlin and Swift.
 */
export function Bill(o = {}) {
  const b = {
    id: o.id,
    name: o.name,
    amount: o.amount ?? 0,
    dueDay: o.dueDay ?? 1,
    category: o.category ?? "Bills & Recharge",
    note: o.note ?? "",
    active: o.active ?? true,
    paidMonth: o.paidMonth ?? "",
  };
  b.isPaidThis = (month) => b.paidMonth === month;
  b.isOverdue = (month, todayDay) => b.active && !b.isPaidThis(month) && todayDay >= b.dueDay;
  b.isDueSoon = (month, todayDay) => b.active && !b.isPaidThis(month) && todayDay < b.dueDay;
  return b;
}

/** True when a bill falls inside the early-month common payments window. */
export const billInWindow = (b, untilDay) => b.active && b.dueDay <= untilDay;

/**
 * A month's settings.
 *
 * opening is money that was already in hand for this month before any of this
 * month's entries - a carried balance, an adjustment, or simply a correction
 * when the real figure does not match what the app worked out. It is kept
 * separate from the salary because it is not new money for the month: it only
 * moves the starting point, so it is never treated as a limit.
 */
export const MonthCfg = (salary = 0, savings = 0, opening = 0) => ({ salary, savings, opening });

/**
 * One roommate's running balance with you. The two sides are kept apart so the
 * screen can show what they owe you and what you owe them.
 */
export function RoomNet(name, theyOweMe = 0, iOweThem = 0) {
  const net = Math.abs(theyOweMe - iOweThem) < 0.005 ? 0 : round2(theyOweMe - iOweThem);
  return {
    name,
    theyOweMe: round2(theyOweMe),
    iOweThem: round2(iOweThem),
    net,
    settledUp: net === 0,
  };
}

/** Aggregates for one month, used by the dashboard. */
export function MonthSum(o = {}) {
  return {
    personal: 0,
    // money that came back when somebody settled up; neutral, not spending
    received: 0,
    gaveOpen: 0,
    gaveGift: 0,
    gaveAll: 0,
    borrowedOpen: 0,
    borrowedAll: 0,
    // borrowed as a gift, so nothing comes back
    giftReceived: 0,
    // spending that was a gift to someone: counts as spending, never pending
    spentAsGift: 0,
    roomTotal: 0,
    roomPaidByMe: 0,
    roomMyShare: 0,
    roomOwedToMe: 0,
    saved: 0,
    savedIn: 0,
    savedOut: 0,
    ...o,
  };
}

export const Cats = {
  all: [
    "Food", "Transport", "Groceries", "Rent / EMI", "Bills & Recharge",
    "Health", "Shopping", "Fun / Going out", "Gifts given", "Other",
  ],
  ME: "Me",
};

export function round2(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.abs(v) < 0.005 ? 0 : v;
}
