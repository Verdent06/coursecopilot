import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  fetchAndParseCanvasIcs,
  parseIcsCalendar,
  parseIcsDate,
  splitSummary,
} from "../../src/canvas/ics.js";

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../fixtures/canvas/calendar.ics"),
  "utf8",
);

describe("Canvas ICS calendar feed", () => {
  it("parses Canvas VEVENTs and [COURSE] titles", () => {
    const events = parseIcsCalendar(fixture);
    expect(events).toHaveLength(3);
    expect(events[0]?.summary).toBe("Homework 3");
    expect(events[0]?.course).toBe("EECS 376");
    expect(events[0]?.dueAt).toBe("2026-10-20T23:59:00.000Z");
    expect(events[2]?.course).toBe("ENGR 100");
    expect(events[2]?.dueAt).toBe("2026-11-02T23:59:00.000Z");
  });

  it("unfolds long lines and splits summaries", () => {
    const folded =
      "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:A very long assignment name that\n  continues [EECS 281]\nDTSTART:20261014T120000Z\nEND:VEVENT\nEND:VCALENDAR\n";
    const events = parseIcsCalendar(folded);
    expect(events[0]?.summary).toBe("A very long assignment name that continues");
    expect(events[0]?.course).toBe("EECS 281");
    expect(splitSummary("No course")).toEqual({ name: "No course", course: "Canvas" });
  });

  it("parses DATE and local DTSTART", () => {
    expect(parseIcsDate("DTSTART;VALUE=DATE:20261020")).toBe("2026-10-20T23:59:00.000Z");
    expect(parseIcsDate("DTSTART:20261020T235900Z")).toBe("2026-10-20T23:59:00.000Z");
  });

  it("fetches and rejects non-calendar bodies", async () => {
    const fetchFn = (async (url: RequestInfo | URL) => {
      if (String(url).includes("good.ics")) {
        return new Response(fixture, { status: 200, headers: { "content-type": "text/calendar" } });
      }
      return new Response("<html>login</html>", { status: 200 });
    }) as typeof fetch;
    const events = await fetchAndParseCanvasIcs(
      "https://umich.instructure.com/feeds/calendars/user_x.ics?src=good.ics",
      fetchFn,
      { allowPrivateNetwork: true },
    );
    expect(events.some((e) => e.summary === "Homework 3")).toBe(true);
    await expect(
      fetchAndParseCanvasIcs("https://umich.instructure.com/feeds/calendars/bad.ics", fetchFn, {
        allowPrivateNetwork: true,
      }),
    ).rejects.toThrow(/iCalendar|Calendar Feed/i);
  });
});
