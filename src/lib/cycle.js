import dayjs from "dayjs";

/** Retourne la date (00:00) du DERNIER reset <= now, selon la config. */
export function computeInitialLastResetAt(period, { resetDow = 1, resetDom = 1 }, now = new Date()) {
  const t = dayjs(now).startOf("day");
  if (period === "daily") return t.toDate();

  if (period === "weekly" || period === "biweekly") {
    // dayjs: 0=dimanche ... 6=samedi ; resetDow attendu idem
    let d = t.day(resetDow);
    if (d.isAfter(t)) d = d.subtract(7, "day");
    return d.toDate();
  }

  if (period === "monthly") {
    const clampDay = Math.min(resetDom, t.daysInMonth());
    let d = t.date(clampDay);
    if (d.isAfter(t)) d = d.subtract(1, "month").date(Math.min(resetDom, d.daysInMonth()));
    return d.toDate();
  }

  // once
  return t.toDate();
}

/** Donne début courant (lastResetAt) et prochaine borne (next) */
export function getCurrentWindow(envelope, now = new Date()) {
  const period = envelope.period || "monthly";
  const last = dayjs(envelope.lastResetAt?.toDate?.() ? envelope.lastResetAt.toDate() : envelope.lastResetAt || new Date()).startOf("day");

  if (period === "daily") {
    const start = dayjs(now).startOf("day");
    return { start: start.toDate(), next: start.add(1, "day").toDate() };
  }
  if (period === "weekly")   return { start: last.toDate(), next: last.add(7, "day").toDate() };
  if (period === "biweekly") return { start: last.toDate(), next: last.add(14, "day").toDate() };
  if (period === "monthly") {
    const dom = envelope.resetDom || 1;
    const nextMonth = last.add(1, "month");
    const clamp = Math.min(dom, nextMonth.daysInMonth());
    const next = nextMonth.date(clamp).startOf("day");
    return { start: last.toDate(), next: next.toDate() };
  }
  // once: pas de prochaine borne "réelle"
  return { start: last.toDate(), next: new Date(8640000000000000) };
}
