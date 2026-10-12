// Budget Planner - Money I need.
// Mirrors app/src/main/java/com/budgetplanner/ui/NeedFragment.kt.

import { Repo } from "../../data/Repo.js";
import { Fmt } from "../../util/Fmt.js";
import * as Dialogs from "../Dialogs.js";
import { gap, Screen } from "../Kit.js";

export function build(ctx) {
  const s = new Screen();
  const all = Repo.needs();
  const open = all.filter((n) => !n.done);
  const done = all.filter((n) => n.done);
  const wanted = open.reduce((a, n) => a + n.amount, 0);
  const collected = done.reduce((a, n) => a + n.amount, 0);

  s.kpi("Still needed", Fmt.money(wanted), `${open.length} open`, "brand");
  s.add(gap());
  s.kpi("Collected", Fmt.money(collected), `${done.length} done`, "ok");

  s.spacer(4);
  s.button("+ Add something I need", { primary: true, onClick: () => Dialogs.need() });

  if (open.length > 0) {
    s.section("Still need");
    s.listCard((lc) => {
      open.forEach((n, i) => {
        if (i > 0) lc.divider();
        lc.add(
          lc.row({
            avatar: "?",
            title: n.text,
            subtitle: [n.amount > 0 ? Fmt.money(n.amount) : null, n.fromWhom || "no source noted", Fmt.dayLabel(n.date) || null]
              .filter(Boolean)
              .join(" · "),
            amount: "GET",
            amountColor: "brand",
            avatarTone: "soft",
            avatarTextColor: "brand",
            onClick: () => Dialogs.needDetail(n.id),
          })
        );
      });
    });
  }

  if (done.length > 0) {
    s.section("Got it");
    s.listCard((lc) => {
      done.slice(0, 20).forEach((n, i) => {
        if (i > 0) lc.divider();
        lc.add(
          lc.row({
            avatar: "✓",
            title: n.text,
            subtitle: [n.amount > 0 ? Fmt.money(n.amount) : null, n.fromWhom || null]
              .filter(Boolean)
              .join(" · "),
            amount: "DONE",
            amountColor: "ok",
            avatarTone: "soft",
            avatarTextColor: "ok",
            onClick: () => Dialogs.needDetail(n.id),
          })
        );
      });
    });
  }

  if (all.length === 0) {
    s.empty(
      "Nothing on the list",
      "Write down anything you need money for - a repair, a gift, a deposit - and tick it off when the money arrives.",
      "+ Add something I need",
      () => Dialogs.need()
    );
  }

  s.note(
    "When you record the money you received for an item, it is also added to the People page so you can track whether it is a gift or something to return."
  );

  return s;
}
