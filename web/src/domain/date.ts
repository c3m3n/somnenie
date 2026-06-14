export function toISODate(input: Date | string = new Date()): string {
  const date = input instanceof Date ? input : new Date(input);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateFromISO(iso: string): Date {
  const match = String(iso || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    throw new Error(`Некорректная дата: ${iso}`);
  }
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Некорректная дата: ${iso}`);
  }
  return date;
}

export function addDaysISO(input: string, days: number): string {
  const date = dateFromISO(input);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}
