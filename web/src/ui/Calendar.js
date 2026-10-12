// Budget Planner - the in-app calendar.
//
// The browser's own date picker was doing two things badly: it let a day in the
// future be picked, and it looked nothing like the rest of the app. Both matter
// here. Money is spent on the day it is spent, so today is the last day that
// can be chosen, and a calendar that arrives in a different shape from every
// other screen makes the app feel like two apps stitched together.

import { Fmt } from "../util/Fmt.js";
import { Anim } from "./Anim.js";
import { closeSheet, openSheet } from "./Form.js";

const DOW = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** YYYY-MM-DD for a day, which is what the app stores dates as. */
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The calendar grid for one month.
 *
 * `max` is the last day that may be picked, so every day after it is shown grey
 * and cannot be tapped: spending is entered on the day it happened, and a
 * tomorrow-dated entry quietly moves money into the wrong month.
 */
export function monthGrid(month, { value = null, max = null, onPick = null } = {}) {
  const [y, mo] = month.split("-").map(Number);
  const first = new Date(y, mo - 1, 1);
  const days = new Date(y, mo, 0).getDate();
  // Monday-first, which is how the month reads on a wall
  const lead = (first.getDay() + 6) % 7;
  const last = max || Fmt.today();

  const wrap = document.createElement("div");
  wrap.className = "cal";

  const head = document.createElement("div");
  head.className = "calhead";
  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "calnav";
  prev.textContent = "‹";
  prev.setAttribute("aria-label", "Previous month");
  const title = document.createElement("div");
  title.className = "caltitle";
  title.textContent = Fmt.monthLabel(month);
  const next = document.createElement("button");
  next.type = "button";
  next.className = "calnav";
  next.textContent = "›";
  next.setAttribute("aria-label", "Next month");
  head.append(prev, title, next);
  wrap.appendChild(head);

  const grid = document.createElement("div");
  grid.className = "calgrid";
  for (const d of DOW) {
    const h = document.createElement("div");
    h.className = "caldow";
    h.textContent = d;
    grid.appendChild(h);
  }
  for (let i = 0; i < lead; i++) {
    const pad = document.createElement("div");
    pad.className = "calday empty";
    grid.appendChild(pad);
  }
  for (let d = 1; d <= days; d++) {
    const date = ymd(new Date(y, mo - 1, d));
    const b = document.createElement("button");
    b.type = "button";
    b.className = "calday";
    b.textContent = String(d);
    if (date === value) b.classList.add("on");
    if (date === Fmt.today()) b.classList.add("today");
    if (max && date > max) {
      // not selectable, and said so rather than left to look clickable
      b.classList.add("off");
      b.disabled = true;
    }
    b.addEventListener("click", () => {
      if (b.disabled) return;
      Anim.dip(b);
      onPick?.(date);
    });
    grid.appendChild(b);
  }
  wrap.appendChild(grid);

  return { wrap, prev, next, canGoBack: Fmt.shiftMonth(month, -1) <= (max || Fmt.today()).slice(0, 7) };
}

/**
 * Opens the calendar in a sheet.
 *
 * Nothing is returned: the caller gets the picked YYYY-MM-DD through onPick, and
 * the sheet closes itself. `max` defaults to today, which is the rule everywhere
 * an entry's date is being chosen.
 */
export function openCalendar({ title = "Pick a date", value = null, max = Fmt.today(), onPick = null } = {}) {
  let shown = (value && value <= max ? value : Fmt.today()).slice(0, 7);

  openSheet(title, (s) => {
    const host = document.createElement("div");

    const draw = () => {
      host.textContent = "";
      const g = monthGrid(shown, { value, max, onPick: (d) => { closeSheet(); onPick?.(d); } });
      g.prev.addEventListener("click", () => {
        shown = Fmt.shiftMonth(shown, -1);
        draw();
      });
      g.next.addEventListener("click", () => {
        shown = Fmt.shiftMonth(shown, 1);
        draw();
      });
      // there is nothing to pick in a month that has not started, so the arrows
      // stop rather than offering days that cannot be chosen
      const lastMonth = (max || Fmt.today()).slice(0, 7);
      g.next.disabled = shown >= lastMonth;
      g.next.classList.toggle("off", g.next.disabled);
      g.prev.disabled = !g.canGoBack;
      g.prev.classList.toggle("off", g.prev.disabled);
      host.appendChild(g.wrap);
    };
    draw();
    s.add(host);

    const foot = document.createElement("div");
    foot.className = "calfoot";
    const today = document.createElement("button");
    today.type = "button";
    today.className = "btn ghost";
    today.textContent = "Today";
    today.addEventListener("click", () => {
      closeSheet();
      onPick?.(Fmt.today());
    });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => closeSheet());
    foot.append(today, cancel);
    s.add(foot, 12);
  });
}
