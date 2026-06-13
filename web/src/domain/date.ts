export function toISODate(input: Date | string = new Date()): string {
  const date = input instanceof Date ? input : new Date(input);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateFromISO(iso: string): Date {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(year || 1970, (month || 1) - 1, day || 1);
}

export function addDaysISO(input: string, days: number): string {
  const date = dateFromISO(input);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}
