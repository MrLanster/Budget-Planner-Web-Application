// Budget Planner - the small animation helpers.
// Mirrors app/src/main/java/com/budgetplanner/ui/Anim.kt.
//
// Everything here checks prefers-reduced-motion first, so turning it on in the
// OS turns it off here too.

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

export const Anim = {
  /** Counts a number up into an element, the way the app's hero figures do. */
  countUp(el, from, to, dur = 850, format = (v) => String(v)) {
    if (!el) return;
    if (reduced() || dur <= 0) {
      el.textContent = format(to);
      return;
    }
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      // ease out cubic, so the last digits settle instead of snapping
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = format(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = format(to);
    };
    requestAnimationFrame(step);
  },

  /** A quick press feedback, matching Anim.dip in the app. */
  dip(el) {
    if (!el || reduced()) return;
    el.animate(
      [{ transform: "scale(1)" }, { transform: "scale(0.97)" }, { transform: "scale(1)" }],
      { duration: 130, easing: "ease-out" }
    );
  },

  /**
   * The ink that spreads from wherever a finger landed. Every pressable thing in
   * the app gets one, so a tap answers with a ripple as well as a dip - it is
   * the difference between a screen that reacts and one that merely redraws.
   *
   * The circle is centred on the real touch point, falls back to the middle of
   * the control for keyboard activation, and removes itself when it finishes.
   */
  ripple(el, ev) {
    if (!el || reduced()) return;
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const x = ev && ev.clientX != null ? ev.clientX - box.left : box.width / 2;
    const y = ev && ev.clientY != null ? ev.clientY - box.top : box.height / 2;
    // far enough to cover the corners from any touch point
    const r = Math.hypot(Math.max(x, box.width - x), Math.max(y, box.height - y));
    const ink = document.createElement("span");
    ink.className = "ink";
    const size = r * 2;
    ink.style.cssText =
      `width:${size}px;height:${size}px;left:${x - r}px;top:${y - r}px`;
    el.appendChild(ink);
    ink.addEventListener("animationend", () => ink.remove(), { once: true });
    // a keyboard or programmatic call never fires animationend on some engines
    setTimeout(() => ink.remove(), 700);
  },

  /** press feedback for anything tappable: the ink plus the dip. */
  press(el, ev) {
    this.ripple(el, ev);
    this.dip(el);
  },

  /** A short buzz on a button that was pressed with nothing to show for it. */
  tapFeedback(el) {
    if (!el || reduced()) return;
    el.animate([{ transform: "scale(1)" }], { duration: 60 });
    if (navigator.vibrate) navigator.vibrate(8);
  },

  /** Head-shake for a form that was saved with a mistake in it. */
  shake(el) {
    if (!el) return;
    el.classList.remove("shake");
    void el.offsetWidth; // restart the animation
    el.classList.add("shake");
    if (navigator.vibrate) navigator.vibrate(30);
  },

  /** The slow attention pulse on the low-budget card. */
  pulse(el, scale = 1.03) {
    if (!el || reduced()) return;
    el.animate(
      [
        { transform: "scale(1)" },
        { transform: `scale(${scale})` },
        { transform: "scale(1)" },
      ],
      { duration: 1400, iterations: 2, easing: "ease-in-out" }
    );
  },

  /** Staggers a freshly built page body. */
  cascade(root) {
    if (!root || reduced()) return;
    root.classList.add("fade-in");
    [...root.children].forEach((child, i) => {
      child.style.animationDelay = `${Math.min(i, 12) * 26}ms`;
    });
  },

  /** Lifts the rows of a list in one after another as it first appears. */
  riseRows(root, selector = ".lrow") {
    if (!root || reduced()) return;
    const rows = [...root.querySelectorAll(selector)].slice(0, 14);
    rows.forEach((row, i) => {
      row.animate(
        [
          { opacity: 0, transform: "translateY(9px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 260, delay: Math.min(i, 14) * 22, easing: "ease-out", fill: "backwards" }
      );
    });
  },

  /** A tick that pops in a box, for a save that worked. */
  popCheck(el) {
    if (!el) return;
    if (reduced()) return;
    el.animate(
      [
        { transform: "scale(0.4)", opacity: 0 },
        { transform: "scale(1.15)", opacity: 1, offset: 0.7 },
        { transform: "scale(1)", opacity: 1 },
      ],
      { duration: 320, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" }
    );
  },

  fadeSwap(el) {
    if (!el || reduced()) return;
    el.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
  },

  nudge(el) {
    if (!el) return;
    el.animate(
      [{ transform: "translateX(0)" }, { transform: "translateX(5px)" }, { transform: "translateX(0)" }],
      { duration: 200 }
    );
  },
};
