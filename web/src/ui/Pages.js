// Budget Planner - the page registry and the shared page context.
// Mirrors app/src/main/java/com/budgetplanner/ui/Pages.kt.

import { Fmt } from "../util/Fmt.js";

export const Pages = {
  HOME: "home",
  BALANCE: "balance",
  ADD: "add",
  PEOPLE: "people",
  MORE: "more",
  ROOM: "room",
  SAVINGS: "savings",
  MONEY: "money",
  NEED: "need",
  BILLS: "bills",
  HISTORY: "history",
  PROFILE: "profile",
};

export const TITLES = {
  [Pages.HOME]: "Budget Planner",
  [Pages.BALANCE]: "Current balance",
  [Pages.ADD]: "Add entry",
  [Pages.PEOPLE]: "People",
  [Pages.MORE]: "More",
  [Pages.ROOM]: "Room",
  [Pages.SAVINGS]: "Savings",
  [Pages.MONEY]: "Money",
  [Pages.NEED]: "Money I need",
  [Pages.BILLS]: "Bills",
  [Pages.HISTORY]: "History",
  [Pages.PROFILE]: "Profile",
};

/**
 * The tabs along the bottom, in order.
 *
 * Add entry is first on purpose: opening the app to put down one expense and
 * closing it again is what most sessions are, so it should never be more than
 * the first tap - or the page the app opens on.
 */
export const TABS = [Pages.ADD, Pages.HOME, Pages.PEOPLE, Pages.HISTORY, Pages.MORE];

/**
 * Short tab labels. TITLES is for the header, where there is room for the full
 * name; a tab is a fifth of the width, so it gets its own wording.
 */
export const TAB_LABELS = {
  [Pages.ADD]: "Add",
  [Pages.HOME]: "Home",
  [Pages.PEOPLE]: "People",
  [Pages.HISTORY]: "History",
  [Pages.MORE]: "More",
};

/**
 * The context every page builds against. It is the same three things the Kotlin
 * PageFragment offers - the month being looked at, a way to open another page,
 * and a way to redraw after changing something - so the page bodies read the
 * same way in both.
 */
export function pageCtx(host) {
  return {
    /** the month this page is looking at, "YYYY-MM" */
    get month() {
      return host.month;
    },
    /** opens another page, e.g. actHost()?.openPage(Pages.PROFILE) in Kotlin */
    open: (id) => host.open(id),
    /** redraws the current page after a change */
    refresh: () => host.refresh(),
    /** redraws and jumps to the top, for after a form is submitted */
    refreshTop: () => host.refresh(true),
    /** the day of the month, for the bill and common-payment checks */
    dayOfMonth: () => Fmt.dayOfMonth(),
    /** true for any month the user can look back at */
    isPast: () => Fmt.isPastMonth(host.month),
  };
}
