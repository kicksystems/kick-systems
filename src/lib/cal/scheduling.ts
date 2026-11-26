// Ported unchanged from RegiStar Schedule (Manus), shared/scheduling.ts, except that the categories
// come from the project (each project keeps its own) instead of a fixed list.

export type RippleEvent = {
  id: string;
  episode: string;
  category: string;
  date: string;
  title?: string;
  rippleLinked?: boolean;
  [key: string]: unknown;
};

export type RippleChange = {
  eventId: string;
  episode: string;
  title: string;
  category: string;
  from: string;
  to: string;
};

export type RipplePlan = {
  delta: number;
  changes: RippleChange[];
};

const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5] as const;
const MIN_YEAR = 2020;
const MAX_YEAR = 2100;
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Returns whether a value is a real, supported civil date in YYYY-MM-DD form. */
export function isDateKey(value: string): boolean {
  if (typeof value !== "string") return false;

  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function assertDateKey(value: unknown, label = "date"): asserts value is string {
  if (typeof value !== "string" || !isDateKey(value)) {
    throw new Error(`${label} must be a valid YYYY-MM-DD date between ${MIN_YEAR} and ${MAX_YEAR}.`);
  }
}

function normalizeWorkingDays(value: unknown): number[] {
  const days = value === undefined ? [...DEFAULT_WORKING_DAYS] : value;
  if (!Array.isArray(days) || days.length === 0) {
    throw new Error("workingDays must be a non-empty array of weekday numbers from 0 through 6.");
  }

  const unique = new Set<number>();
  for (const day of days) {
    if (typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6) {
      throw new Error("workingDays must contain only integer weekday numbers from 0 through 6.");
    }
    unique.add(day);
  }

  if (unique.size === 0) {
    throw new Error("workingDays must contain at least one weekday.");
  }
  return Array.from(unique).sort((left, right) => left - right);
}

function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateKey(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function weekdayFor(dateKey: string): number {
  return parseDateKey(dateKey).getUTCDay();
}

/** Determines whether a valid date lands on one of the configured working weekdays. */
export function isWorkingDay(date: string, workingDays: number[] = [...DEFAULT_WORKING_DAYS]): boolean {
  assertDateKey(date);
  return normalizeWorkingDays(workingDays).includes(weekdayFor(date));
}

/**
 * Adds a number of configured working days using civil UTC arithmetic. The start date
 * is excluded from the count, which makes a Saturday plus one working day Monday.
 */
export function addWorkingDays(
  date: string,
  amount: number,
  workingDays: number[] = [...DEFAULT_WORKING_DAYS],
): string {
  assertDateKey(date);
  if (typeof amount !== "number" || !Number.isSafeInteger(amount)) {
    throw new Error("amount must be a safe integer number of working days.");
  }

  const activeDays = normalizeWorkingDays(workingDays);
  if (amount === 0) return date;

  const direction = amount > 0 ? 1 : -1;
  let remaining = Math.abs(amount);
  const cursor = parseDateKey(date);

  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + direction);
    const current = formatDateKey(cursor);
    if (!isDateKey(current)) {
      throw new Error(`Resulting date is outside the supported ${MIN_YEAR}-${MAX_YEAR} range.`);
    }
    if (activeDays.includes(cursor.getUTCDay())) remaining -= 1;
  }

  return formatDateKey(cursor);
}

/**
 * Counts configured working days traversed from one civil date to another. The origin
 * is excluded and the destination is included, so Saturday to Monday is +1.
 */
export function workingDayDelta(
  from: string,
  to: string,
  workingDays: number[] = [...DEFAULT_WORKING_DAYS],
): number {
  assertDateKey(from, "from");
  assertDateKey(to, "to");
  const activeDays = normalizeWorkingDays(workingDays);
  if (from === to) return 0;

  const direction = from < to ? 1 : -1;
  const cursor = parseDateKey(from);
  let delta = 0;

  while (formatDateKey(cursor) !== to) {
    cursor.setUTCDate(cursor.getUTCDate() + direction);
    if (activeDays.includes(cursor.getUTCDay())) delta += direction;
  }

  return delta;
}

function assertEvent(value: unknown, index: number): asserts value is RippleEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`events[${index}] must be an event object.`);
  }

  const event = value as Record<string, unknown>;
  for (const property of ["id", "episode", "category"] as const) {
    if (typeof event[property] !== "string" || event[property].length === 0) {
      throw new Error(`events[${index}].${property} must be a non-empty string.`);
    }
  }
  assertDateKey(event.date, `events[${index}].date`);
  if (event.title !== undefined && typeof event.title !== "string") {
    throw new Error(`events[${index}].title must be a string when provided.`);
  }
  if (event.rippleLinked !== undefined && typeof event.rippleLinked !== "boolean") {
    throw new Error(`events[${index}].rippleLinked must be a boolean when provided.`);
  }
}

/**
 * Plans, without mutating input, the consequences of moving an event in any category.
 * Preparation deadlines participate just like other linked episode events.
 * Events are selected exactly once from the anchor's original date forward within its episode.
 */
export function planRipple(
  events: Array<RippleEvent>,
  eventId: string,
  targetDate: string,
  workingDays: number[] = [...DEFAULT_WORKING_DAYS],
  rippleCategories?: string[],
): RipplePlan {
  if (!Array.isArray(events)) {
    throw new Error("events must be an array.");
  }
  if (typeof eventId !== "string" || eventId.length === 0) {
    throw new Error("eventId must be a non-empty string.");
  }
  assertDateKey(targetDate, "targetDate");
  const activeDays = normalizeWorkingDays(workingDays);

  const categories = rippleCategories ?? Array.from(new Set(events.map((e) => (e as RippleEvent).category)));
  if(!Array.isArray(categories)||categories.some(c=>typeof c!=='string'))throw new Error('Choose valid ripple categories.');
  const selectedCategories=new Set(categories);
  const ids = new Set<string>();
  events.forEach((event, index) => {
    assertEvent(event, index);
    if (ids.has(event.id)) throw new Error(`events contains duplicate id '${event.id}'.`);
    ids.add(event.id);
  });

  const anchor = events.find((event) => event.id === eventId);
  if (!anchor) throw new Error(`No event found for eventId '${eventId}'.`);
  if (!activeDays.includes(weekdayFor(targetDate))) {
    throw new Error("targetDate must be a configured working day; weekend destinations are not allowed.");
  }
  if (targetDate === anchor.date) return { delta: 0, changes: [] };

  const delta = workingDayDelta(anchor.date, targetDate, activeDays);
  const changes: RippleChange[] = [];

  for (const event of events) {
    if (event.id !== anchor.id && (anchor.rippleLinked === false || event.rippleLinked === false || event.episode !== anchor.episode || event.date < anchor.date || !selectedCategories.has(event.category))) continue;

    const shiftedDate = event.id === anchor.id ? targetDate : addWorkingDays(event.date, delta, activeDays);
    // addWorkingDays validates its output, while this explicit check keeps the anchor path protected too.
    if (!isDateKey(shiftedDate)) {
      throw new Error(`Ripple result for event '${event.id}' is outside the supported date range.`);
    }
    changes.push({
      eventId: event.id,
      episode: event.episode,
      title: typeof event.title === "string" ? event.title : event.episode,
      category: event.category,
      from: event.date,
      to: shiftedDate,
    });
  }

  changes.sort((left, right) =>
    left.from.localeCompare(right.from) || left.eventId.localeCompare(right.eventId),
  );
  return { delta, changes };
}
