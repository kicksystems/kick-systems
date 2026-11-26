import { createHash } from "node:crypto";
// Ported from RegiStar Schedule (Manus), server/calendarIcs.ts. Category labels come from the project.
import { isDateKey } from "./scheduling";

type CalendarEvent = { id: string; title: string; category: string; date: string };

export type CalendarIcsOptions = {
  events: CalendarEvent[];
  calendarName: string;
  uidNamespace: string;
  updatedAt: number;
  revision: number;
  categoryLabel: (id: string) => string;
};

type IcsEvent = Pick<CalendarEvent, "id" | "title" | "category" | "date">;

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function assertIcsEvent(value: unknown, index: number): asserts value is IcsEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`events[${index}] must be an event object.`);
  }
  const event = value as Record<string, unknown>;
  assertNonEmptyString(event.id, `events[${index}].id`);
  assertNonEmptyString(event.title, `events[${index}].title`);
  assertNonEmptyString(event.category, `events[${index}].category`);
  if (typeof event.date !== "string" || !isDateKey(event.date)) {
    throw new Error(`events[${index}].date must be a valid YYYY-MM-DD calendar date.`);
  }
}

/** Escapes RFC 5545 TEXT values and removes all opportunities for line injection. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function dateValue(dateKey: string): string {
  return dateKey.replaceAll("-", "");
}

function nextCalendarDateValue(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + 1);
  return `${String(date.getUTCFullYear()).padStart(4, "0")}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function utcTimestamp(value: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("updatedAt must be a finite numeric Unix timestamp in milliseconds.");
  }
  const date = new Date(value);
  const year = date.getUTCFullYear();
  if (Number.isNaN(date.getTime()) || year < 1 || year > 9999) {
    throw new Error("updatedAt must resolve to an RFC 5545-compatible UTC timestamp.");
  }
  return `${String(year).padStart(4, "0")}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}T${String(date.getUTCHours()).padStart(2, "0")}${String(date.getUTCMinutes()).padStart(2, "0")}${String(date.getUTCSeconds()).padStart(2, "0")}Z`;
}

/**
 * Folds a content line at UTF-8 octet boundaries. Continuations start with one space,
 * and every physical content line is at most 75 octets before its CRLF terminator.
 */
function foldLine(line: string): string[] {
  const chunks: string[] = [];
  let chunk = "";
  let chunkBytes = 0;
  let limit = 75;

  for (const character of line) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (chunkBytes > 0 && chunkBytes + characterBytes > limit) {
      chunks.push(chunk);
      chunk = character;
      chunkBytes = characterBytes;
      limit = 74; // the leading continuation space is the 75th-byte budget participant
    } else {
      chunk += character;
      chunkBytes += characterBytes;
    }
  }
  chunks.push(chunk);

  return chunks.map((part, index) => (index === 0 ? part : ` ${part}`));
}

function opaqueUid(namespace: string, eventId: string): string {
  const hash = createHash("sha256").update(`${namespace}\u0000${eventId}`, "utf8").digest("hex");
  return `${hash}@kick-systems`;
}

/**
 * Builds a private, all-day RFC 5545 calendar feed. It intentionally serializes only
 * the title, date, and a curated category label—never source import metadata.
 */
export function buildCalendarIcs(options: CalendarIcsOptions): string {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("options must be an object.");
  }
  const { events, calendarName, uidNamespace, updatedAt, revision, categoryLabel: labelOf } = options;
  if (!Array.isArray(events)) throw new Error("events must be an array.");
  assertNonEmptyString(calendarName, "calendarName");
  assertNonEmptyString(uidNamespace, "uidNamespace");
  if (
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    revision > 2_147_483_647
  ) {
    throw new Error("revision must be a non-negative RFC 5545 integer.");
  }

  const ids = new Set<string>();
  const validEvents = events.map((event, index) => {
    assertIcsEvent(event, index);
    if (ids.has(event.id)) throw new Error(`events contains duplicate id '${event.id}'.`);
    ids.add(event.id);
    return event;
  });
  const timestamp = utcTimestamp(updatedAt);

  const lines = [
    "BEGIN:VCALENDAR",
    "PRODID:-//Kick Systems//Calendar//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];

  validEvents
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id))
    .forEach((event) => {
      const categoryLabel = labelOf(event.category);
      lines.push(
        "BEGIN:VEVENT",
        `UID:${opaqueUid(uidNamespace, event.id)}`,
        `DTSTAMP:${timestamp}`,
        `LAST-MODIFIED:${timestamp}`,
        `SEQUENCE:${revision}`,
        `DTSTART;VALUE=DATE:${dateValue(event.date)}`,
        `DTEND;VALUE=DATE:${nextCalendarDateValue(event.date)}`,
        `SUMMARY:${escapeText(event.title)}`,
        `CATEGORIES:${escapeText(categoryLabel)}`,
        "END:VEVENT",
      );
    });
  lines.push("END:VCALENDAR");

  return lines.flatMap(foldLine).join("\r\n") + "\r\n";
}
