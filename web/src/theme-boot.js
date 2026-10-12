// Budget Planner - the theme, settled before the first paint.
//
// This is loaded with a plain <script> in <head>, so it runs before anything is
// drawn and a device set to dark never gets a white flash while the app boots.
// It is a separate file rather than an inline script so the server can send a
// Content-Security-Policy that forbids inline scripts entirely.
//
// The choice is a device preference, kept in localStorage rather than with the
// account's data, so it is known synchronously. It also means two people who
// share one browser can each keep their own theme.
(function () {
  var root = document.documentElement;
  var choice = "system";
  try {
    var saved = localStorage.getItem("budgetplanner.theme");
    if (saved === "light" || saved === "dark" || saved === "system") choice = saved;
  } catch (e) {
    /* storage can be blocked; "system" is a fine answer */
  }
  var dark =
    choice === "dark" ||
    (choice === "system" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.setAttribute("data-theme", dark ? "dark" : "light");
  root.setAttribute("data-theme-choice", choice);
})();
