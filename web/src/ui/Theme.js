// Budget Planner - light and dark.
//
// The colours themselves live in app.css, in the :root and
// :root[data-theme="dark"] blocks, which mirror app/src/main/res/values/colors.xml
// and values-night/colors.xml. This file only decides *which* of the two is on
// screen, and remembers the choice.
//
// Three choices, the same idea every platform uses:
//   "system" - follow the device (this is the default, and what Android does)
//   "light"  - always light
//   "dark"   - always dark
//
// The choice is a device preference, not part of the account's budget data. It
// is kept in localStorage under its own key, which lets the tiny script in
// theme-boot.js read it synchronously before the first paint. Because the key
// does not start with "bp.", it does not collide with anything.
//
// The attribute the CSS reads (data-theme, "light" or "dark") is set by that
// boot script before the first paint. Everything below changes it afterwards,
// and keeps "system" honest while the app stays open.

/** Where the choice is remembered. Shared with src/theme-boot.js by name. */
const KEY = "budgetplanner.theme";

/** The order the picker shows them in. */
export const CHOICES = ["system", "light", "dark"];

const isChoice = (v) => CHOICES.includes(v);

function prefersDark() {
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

export const Theme = {
  choices: CHOICES,

  /** What the user picked: "system", "light" or "dark". */
  get() {
    try {
      const v = localStorage.getItem(KEY);
      return isChoice(v) ? v : "system";
    } catch {
      return "system";
    }
  },

  /** What is actually on screen right now: "light" or "dark". */
  resolved() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  },

  /** A name for the choice, for the button and the toast. */
  label(choice) {
    return choice === "dark" ? "Dark" : choice === "light" ? "Light" : "System";
  },

  /** Picks a theme, remembers it, and puts it on screen straight away. */
  set(choice) {
    const c = isChoice(choice) ? choice : "system";
    try {
      localStorage.setItem(KEY, c);
    } catch {
      /* nothing to remember it with; still apply it for this session */
    }
    Theme.apply();
    return c;
  },

  /**
   * Puts the resolved theme on the document. Safe to call any time; it is a
   * no-op visually when nothing has changed.
   */
  apply() {
    const choice = Theme.get();
    const dark = choice === "dark" || (choice === "system" && prefersDark());
    const root = document.documentElement;
    root.setAttribute("data-theme", dark ? "dark" : "light");
    root.setAttribute("data-theme-choice", choice);
    // the browser's own chrome (the address bar colour on mobile) goes with it
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#0B1120" : "#4F46E5");
  },

  /**
   * Re-resolves "system" when the device switches to or from dark mode while
   * the app is open, and follows the choice if another tab changes it. A choice
   * of "light" or "dark" is left alone, because the user asked for it by name.
   */
  watch() {
    if (window.matchMedia) {
      const m = window.matchMedia("(prefers-color-scheme: dark)");
      const on = () => {
        if (Theme.get() === "system") Theme.apply();
      };
      // addListener is the old spelling, still needed by a few older browsers
      if (m.addEventListener) m.addEventListener("change", on);
      else if (m.addListener) m.addListener(on);
    }
    window.addEventListener("storage", (e) => {
      if (e.key === KEY) Theme.apply();
    });
  },
};
