/** Small date helpers on plain local dates (no time of day), shared by the pickers. */
export type Day = Date;

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const addMonths = (d: Date, n: number) => {
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), last));
};
export const sameDay = (a?: Date | null, b?: Date | null) => !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const sameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
export const before = (a: Date, b: Date) => startOfDay(a).getTime() < startOfDay(b).getTime();
export const between = (d: Date, a: Date, b: Date) => {
  const t = startOfDay(d).getTime();
  const [x, y] = [startOfDay(a).getTime(), startOfDay(b).getTime()].sort((m, n) => m - n);
  return t >= x && t <= y;
};

/** Six weeks of days covering the month, starting on the locale's first weekday. */
export function monthGrid(month: Date, weekStart: number) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const start = addDays(first, -lead);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function weekStartFor(locale: string) {
  try {
    const info = (new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } });
    const first = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
    if (first) return first % 7;
  } catch {
    /* older engines: fall through */
  }
  return /^en-(US|CA)|^ja|^ko|^zh|^he|^pt-BR/.test(locale) ? 0 : 1;
}

export function weekdayNames(locale: string, weekStart: number) {
  const f = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  const long = new Intl.DateTimeFormat(locale, { weekday: "long" });
  // 2023-01-01 was a Sunday.
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2023, 0, 1 + ((i + weekStart) % 7));
    return { short: f.format(d), long: long.format(d) };
  });
}
