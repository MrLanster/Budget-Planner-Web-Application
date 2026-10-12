// Budget Planner - the app shell.
// Mirrors app/src/main/java/com/budgetplanner/ui/MainActivity.kt and
// SetupActivity.kt.
//
// Three jobs, in this order:
//   1. ask who you are: sign in to an existing account, or create one
//   2. draw the chrome and the four tabs, and move between pages
//   3. keep the month being looked at, because Home, Balance, Money and History
//      all read it
//
// The data lives on the server, one database per account, so the first thing the
// app does after sign-in is fetch this user's own copy (see data/Db.js).

import { Auth } from "./data/Auth.js";
import { Db } from "./data/Db.js";
import { Repo } from "./data/Repo.js";
import { Prefs } from "./notify/Prefs.js";
import { Scheduler } from "./notify/Scheduler.js";
import { Fmt } from "./util/Fmt.js";
import { Anim } from "./ui/Anim.js";
import * as Dialogs from "./ui/Dialogs.js";
import { ask, Form, closeSheet, openSheet, toast } from "./ui/Form.js";
import { h, Screen } from "./ui/Kit.js";
import { monthView } from "./ui/MonthView.js";
import { pageCtx, Pages, TAB_LABELS, TABS, TITLES } from "./ui/Pages.js";
import { Theme } from "./ui/Theme.js";

// The page bodies are pulled in one at a time, so opening the app does not have
// to parse all eleven before the first screen appears.
const LOADERS = {
  [Pages.HOME]: () => import("./ui/pages/Home.js"),
  [Pages.BALANCE]: () => import("./ui/pages/Balance.js"),
  [Pages.ADD]: () => import("./ui/pages/Add.js"),
  [Pages.PEOPLE]: () => import("./ui/pages/People.js"),
  [Pages.MORE]: () => import("./ui/pages/More.js"),
  [Pages.ROOM]: () => import("./ui/pages/Room.js"),
  [Pages.SAVINGS]: () => import("./ui/pages/Savings.js"),
  [Pages.MONEY]: () => import("./ui/pages/Money.js"),
  [Pages.NEED]: () => import("./ui/pages/Need.js"),
  [Pages.BILLS]: () => import("./ui/pages/Bills.js"),
  [Pages.HISTORY]: () => import("./ui/pages/History.js"),
  [Pages.PROFILE]: () => import("./ui/pages/Profile.js"),
};

/** Where each tab's icon comes from. Plain text, so there is no icon font. */
const ICONS = {
  [Pages.ADD]: "+",
  [Pages.HOME]: "⌂",
  [Pages.PEOPLE]: "☺",
  [Pages.HISTORY]: "◷",
  [Pages.MORE]: "⋯",
};

const state = {
  // Add entry is the landing page: the fastest path to the thing most people
  // opened the app for
  page: Pages.ADD,
  month: Fmt.thisMonth(),
  /** remembers where the tab bar was, so a back button has somewhere to go */
  fromTab: null,
};

// ------------------------------------------------------------------ the shell

const chrome = () => document.getElementById("chrome");
const content = () => document.getElementById("content");
const tabbar = () => document.getElementById("tabbar");

/**
 * Puts the three shell nodes back if they are not there.
 *
 * The setup and lock screens take over the whole window, and they do it by
 * emptying #app so nothing of the app can be seen or clicked behind them. That
 * means the shell has to be rebuilt on the way out, otherwise the app unlocks
 * into an empty page.
 */
function ensureShell() {
  const app = document.getElementById("app");
  if (!app) return;
  if (!document.getElementById("content")) {
    app.replaceChildren();
    const c = h("header", "chrome");
    c.id = "chrome";
    const body = h("main", "content");
    body.id = "content";
    const nav = h("nav", "tabbar");
    nav.id = "tabbar";
    app.append(c, body, nav);
  }
  // the sheet and toast hosts live outside #app, so rebuild them too if a
  // previous run of this page was torn down
  if (!document.getElementById("modal")) {
    const m = h("div", "modal-root");
    m.id = "modal";
    m.hidden = true;
    document.body.appendChild(m);
  }
  if (!document.getElementById("toasts")) {
    const t = h("div", "toasts");
    t.id = "toasts";
    document.body.appendChild(t);
  }
}

/** The month being looked at, kept inside the months that actually exist. */
function setMonth(m) {
  state.month = m;
  draw();
}

function shiftMonth(delta) {
  const next = Fmt.shiftMonth(state.month, delta);
  if (next > Fmt.thisMonth()) {
    toast("That month has not happened yet");
    return;
  }
  setMonth(next);
}

function goToToday() {
  setMonth(Fmt.thisMonth());
}

function open(id) {
  if (id === state.page) return;
  // any popup belongs to the page being left, so it goes with it
  closeSheet();
  if (TABS.includes(state.page) && !TABS.includes(id)) state.fromTab = state.page;
  state.page = id;
  draw();
  content().scrollTop = 0;
}

/** Back out of a page to the tab it was opened from. */
function goBack() {
  closeSheet();
  const target = state.fromTab || Pages.HOME;
  state.fromTab = null;
  state.page = target;
  draw();
}

function ctx() {
  return pageCtx({
    get month() {
      return state.month;
    },
    open,
    refresh: (toTop = false) => draw(toTop),
  });
}

let drawToken = 0;

function draw(toTop = false) {
  // a page body can ask to redraw while its own dialog is closing, so the last
  // request wins and any older one is dropped
  const token = ++drawToken;
  buildChrome();
  buildTabs();
  const host = content();
  // A redraw is not a page load: the user tapped something halfway down and
  // expects to still be halfway down afterwards, so hold the scroll place
  // unless the page explicitly asked to jump to the top.
  const keepScroll = toTop ? 0 : host.scrollTop;
  host.replaceChildren();
  const loader = LOADERS[state.page] || LOADERS[Pages.HOME];
  loader().then((mod) => {
    if (token !== drawToken) return;
    try {
      const screen = mod.build(ctx());
      host.appendChild(screen.root);
      Anim.cascade(screen.root);
      // lists then lift in row by row, so a screen of entries reads as a list
      // rather than a wall that appeared all at once
      Anim.riseRows(screen.root);
      host.scrollTop = keepScroll;
    } catch (e) {
      console.error("page failed", state.page, e);
      host.appendChild(errorCard(state.page, e));
    }
  });
}

function errorCard(id, err) {
  const s = new Screen();
  s.card((c) => {
    c.add(c.label(`Could not draw ${TITLES[id] || id}`, 15, "bad", true));
    c.add(c.sub(String(err && err.message ? err.message : err), 12), 6);
  });
  s.button("Try again", { primary: true, onClick: () => draw() });
  return s.root;
}

function buildChrome() {
  const bar = chrome();
  bar.replaceChildren();

  const top = h("div", "chrome-top");
  const back = h("button", "icon-btn", "‹");
  back.type = "button";
  back.setAttribute("aria-label", "Back");
  const canGoBack = !TABS.includes(state.page) && state.fromTab != null;
  back.hidden = !canGoBack;
  back.addEventListener("click", goBack);
  top.appendChild(back);

  if (canGoBack) {
    const av = h("div", "chrome-avatar", "‹");
    top.appendChild(av);
  } else {
    const av = h("div", "chrome-avatar", (Auth.name()[0] || "B").toUpperCase());
    av.addEventListener("click", () => open(Pages.PROFILE));
    top.appendChild(av);
  }

  const title = h("div", "chrome-title");
  title.appendChild(h("h1", null, TITLES[state.page] || "Budget Planner"));
  const sub = h("p", null, subtitleFor(state.page));
  title.appendChild(sub);
  top.appendChild(title);

  const bell = h("button", "icon-btn", "◔");
  bell.type = "button";
  bell.setAttribute("aria-label", "Reminders");
  bell.addEventListener("click", () => open(Pages.PROFILE));
  top.appendChild(bell);
  bar.appendChild(top);

  // the month strip, on the pages where a month means something
  if (SHOWS_MONTH.has(state.page)) {
    const mb = h("div", "monthbar");
    const prev = h("button", null, "‹");
    prev.type = "button";
    prev.setAttribute("aria-label", "Previous month");
    prev.addEventListener("click", () => shiftMonth(-1));
    mb.appendChild(prev);

    const label = h("button", "month-label", Fmt.monthLabel(state.month));
    label.type = "button";
    label.addEventListener("click", () => pickMonth());
    mb.appendChild(label);

    const next = h("button", null, "›");
    next.type = "button";
    next.setAttribute("aria-label", "Next month");
    next.addEventListener("click", () => shiftMonth(1));
    mb.appendChild(next);

    if (state.month !== Fmt.thisMonth()) {
      const now = h("button", "this-month", "This month");
      now.type = "button";
      now.addEventListener("click", goToToday);
      mb.appendChild(now);
    }
    bar.appendChild(mb);
  }
}

/** The pages where the month strip belongs. Add picks its own date instead. */
const SHOWS_MONTH = new Set([
  Pages.HOME,
  Pages.BALANCE,
  Pages.MONEY,
  Pages.SAVINGS,
  Pages.HISTORY,
  Pages.ROOM,
  Pages.NEED,
  Pages.BILLS,
  Pages.PEOPLE,
  Pages.PROFILE,
  Pages.MORE,
]);

function subtitleFor(page) {
  if (page === Pages.HOME) {
    const v = monthViewSafe(state.month);
    if (!v.isStarted) return "Waiting for your salary";
    return v.isOver
      ? `Over by ${Fmt.money(-v.inHand)}`
      : `${Fmt.money(v.daily)} a day for ${v.daysLeft} more day${v.daysLeft === 1 ? "" : "s"}`;
  }
  if (page === Pages.ADD) return "Spending, gave, borrowed or savings";
  if (page === Pages.PEOPLE) {
    const recv = Repo.openReceivable();
    const pay = Repo.openPayable();
    if (recv <= 0 && pay <= 0) return "Everyone is settled up";
    return [recv > 0 ? `${Fmt.money(recv)} to get back` : null, pay > 0 ? `${Fmt.money(pay)} to return` : null]
      .filter(Boolean)
      .join(" · ");
  }
  if (page === Pages.MORE) return "Balance, savings, bills and settings";
  if (page === Pages.HISTORY) return "Every month, side by side";
  return Fmt.monthLabel(state.month);
}

/** Month maths for the chrome line, so the header can never disagree with Home. */
function monthViewSafe(m) {
  return monthView(m);
}

/** The page whose tab was active last time, so only a real page change pops. */
let lastActiveTab = "";

function buildTabs() {
  const bar = tabbar();
  bar.replaceChildren();
  // A redraw is not a page change: saving an entry rebuilds the bar too, and
  // the whole thing bouncing every time you saved something would be noise.
  const switched = state.page !== lastActiveTab;
  lastActiveTab = state.page;
  for (const id of TABS) {
    // every tab, Add included, is coloured only while it is the page you are on
    const on = id === state.page;
    const b = h(
      "button",
      "tab" + (on ? " on" : "") + (id === Pages.ADD ? " fab" : "") + (on && switched ? " pop" : "")
    );
    b.type = "button";
    b.appendChild(h("span", "ico", ICONS[id] || "•"));
    b.appendChild(h("span", null, TAB_LABELS[id] || TITLES[id]));
    b.addEventListener("click", () => {
      // the tab bar dips like every other control, so a press is never silent
      Anim.dip(b);
      if (id !== state.page) open(id);
    });
    bar.appendChild(b);
  }
}

/** A list of the months that hold something, for the month label. */
function pickMonth() {
  const months = Repo.allMonths();
  const s = new Screen();
  s.listCard((col) => {
    months.forEach((m, i) => {
      if (i > 0) col.divider();
      const sum = Repo.monthSum(m);
      const btn = h("button", "lrow tappable");
      btn.type = "button";
      const mid = h("div", "mid");
      mid.appendChild(h("div", "t", Fmt.monthLabel(m) + (m === Fmt.thisMonth() ? " · now" : "")));
      mid.appendChild(h("div", "s", `Spent ${Fmt.money(sum.personal)}`));
      btn.appendChild(mid);
      if (m === state.month) {
        const tick = h("div", "amt", "✓");
        tick.style.color = "var(--brand)";
        btn.appendChild(tick);
      }
      btn.addEventListener("click", () => {
        document.querySelector(".modal-root .sheet-x")?.click();
        setMonth(m);
      });
      col.add(btn);
    });
  });
  openSheet("Jump to a month", (sh) => {
    sh.add(s.root);
  });
}

// ------------------------------------------------------------------ accounts
//
// The screen that stands between a visitor and any data. The same form does two
// jobs: signing in, and creating an account. Switching between them re-renders
// the form, which keeps each mode's fields honest rather than hiding them.

/** True while the sign-in screen is up, so nothing tries to draw it twice. */
let authOpen = false;

function showAuth(mode = "signin") {
  authOpen = true;
  document.getElementById("app").replaceChildren();
  // a sign-in screen that was already up (e.g. after a session expired) goes
  document.querySelectorAll(".setup").forEach((el) => el.remove());
  const wrap = h("div", "setup");
  document.body.appendChild(wrap);

  wrap.appendChild(h("div", "setup-logo", "₹"));
  wrap.appendChild(
    h("h1", null, mode === "create" ? "Create your account" : "Budget Planner")
  );
  wrap.appendChild(
    h(
      "p",
      null,
      mode === "create"
        ? "Your budget is private to you. Nobody else can see it, not even another account on this server."
        : "Sign in to open your budget."
    )
  );

  const f = new Form();
  const name = mode === "create" ? f.text("Your name", "e.g. Arun") : null;
  const email = f.text("Email", "you@example.com");
  const pass = f.text("Password", mode === "create" ? "at least 8 characters" : "your password");
  const pass2 = mode === "create" ? f.text("Repeat password", "type it again") : null;
  if (mode === "create") {
    f.note(
      "Your password is checked on the server and stored only as a salted hash. " +
        "It is never kept in this browser."
    );
  }
  wrap.appendChild(f.root);

  const go = h("button", "btn primary wide", mode === "create" ? "Create account" : "Sign in");
  go.type = "button";
  wrap.appendChild(go);

  const alt = h(
    "button",
    "btn ghost wide",
    mode === "create" ? "I already have an account" : "Create a new account"
  );
  alt.type = "button";
  alt.addEventListener("click", () => {
    wrap.remove();
    showAuth(mode === "create" ? "signin" : "create");
  });
  wrap.appendChild(alt);

  let busy = false;
  async function submit() {
    if (busy) return;
    const emailValue = email.value.trim();
    const password = pass.value;

    if (!emailValue) return toast("Enter your email");
    if (mode === "create") {
      if (!name.value.trim()) return toast("Enter your name");
      if (password.length < 8) return toast("Use at least 8 characters for your password");
      if (password !== pass2.value) return toast("The two passwords do not match");
    } else if (!password) {
      return toast("Enter your password");
    }

    busy = true;
    go.disabled = true;
    go.textContent = mode === "create" ? "Creating…" : "Signing in…";
    try {
      if (mode === "create") await Auth.register(name.value.trim(), emailValue, password);
      else await Auth.signIn(emailValue, password);
      busy = false;
      wrap.remove();
      await begin();
    } catch (e) {
      busy = false;
      go.disabled = false;
      go.textContent = mode === "create" ? "Create account" : "Sign in";
      toast(e && e.message ? e.message : "That did not work");
      pass.value = "";
      pass.focus?.();
    }
  }

  go.addEventListener("click", submit);
  wrap.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });
  (name || email).focus?.();
}

/** Signs out and returns to the sign-in screen. */
async function signOut() {
  try {
    await Db.flushNow();
  } catch {
    /* nothing worth keeping back a sign-out for */
  }
  await Auth.signOut();
  closeSheet();
  showAuth("signin");
}

// ------------------------------------------------------------------ starting up

function start() {
  // the setup and lock screens emptied the shell, so it is rebuilt here before
  // anything tries to draw into it
  ensureShell();

  // any month that finished while the app was closed gets its leftover swept
  // into savings before the first screen is drawn
  Repo.closeFinishedMonths();

  // the dialogs redraw the page they were opened from, the same hook the
  // fragments use on Android
  Dialogs.setRefresh(() => draw());

  // the notification that jumps to a page when one is clicked
  Scheduler.start((id) => open(id || Pages.HOME));

  draw();
  toast(`Welcome, ${Auth.firstName()}`);
}

// ------------------------------------------------------------------ boot

/** Loads this user's data and shows the app. Used after sign-in or register. */
async function begin() {
  authOpen = false;
  try {
    await Db.open();
  } catch (e) {
    console.error("could not load data", e);
    toast("Could not load your budget");
    showAuth("signin");
    return;
  }
  start();
  offerPreviousData();
}

/**
 * One-time help for anyone upgrading from the old browser-only app: their
 * budget is still in localStorage under the key the old Db.js used. Offer to
 * import it, but only into an empty account, and only once.
 */
function offerPreviousData() {
  const LEGACY_KEY = "budgetplanner.db.v1";
  const ASKED_KEY = "budgetplanner.old-data-asked";
  let raw = null;
  try {
    raw = localStorage.getItem(LEGACY_KEY);
    if (!raw || localStorage.getItem(ASKED_KEY)) return;
  } catch {
    return;
  }

  const tables = ["tx", "people", "months", "bill", "room_bill", "savings_tx", "need_item"];
  const isEmpty = tables.every((t) => !Db.table(t) || Db.table(t).length === 0);
  if (!isEmpty) return;

  // Remember that it was offered, so a "no" is not asked again next time.
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    /* if it cannot be remembered, at worst it is offered again */
  }

  ask(
    "Bring your old budget across?",
    "This browser still has a budget saved from before accounts existed. Import it into this account?",
    {
      okLabel: "Import",
      onOk: () => {
        try {
          Db.importJson(raw);
          localStorage.removeItem(LEGACY_KEY);
          toast("Your old budget was imported");
          draw(true);
        } catch {
          toast("Could not read the old data");
        }
      },
    }
  );
}

(async function boot() {
  // a browser tab left open overnight can come back to yesterday's numbers
  state.month = Fmt.thisMonth();

  // theme-boot.js has already set the theme before the first paint, so this
  // only has to keep it in step with the device while the app is open
  Theme.apply();
  Theme.watch();

  // a write that fails because the session ended sends the user back to sign in
  Db.setOnSaveError((e) => {
    if (e && e.status === 401) {
      if (!authOpen) {
        toast("Your session ended. Please sign in again.");
        showAuth("signin");
      }
    } else {
      toast("Could not save your changes");
    }
  });

  // who is signed in, if anyone, decides between the app and the sign-in screen
  const user = await Auth.me();
  if (!user) {
    showAuth("signin");
    return;
  }
  await begin();
})();

// handy while testing, and the only place the shell's state is readable
window.BudgetPlanner = { state, open, draw, setMonth, shiftMonth, signOut, showAuth };
