import { describe, expect, it } from "vitest";
import { fileName, formatDuration, formatHms, formatHmsTenths, parseTime, secondsSince } from "./time";

describe("formatHms", () => {
  it("formats marker timestamps", () => {
    expect(formatHms(0)).toBe("00:00:00");
    expect(formatHms(10)).toBe("00:00:10");
    expect(formatHms(6157.9)).toBe("01:42:37");
    expect(formatHms(4 * 3600 + 17 * 60 + 32)).toBe("04:17:32");
  });
  it("does not wrap long recordings", () => {
    expect(formatHms(30 * 3600)).toBe("30:00:00");
  });
  it("clamps negatives", () => {
    expect(formatHms(-5)).toBe("00:00:00");
  });
});

describe("formatHmsTenths", () => {
  it("shows tenths", () => {
    expect(formatHmsTenths(5041.75)).toBe("01:24:01.7");
    expect(formatHmsTenths(0.3)).toBe("00:00:00.3");
  });
});

describe("formatDuration", () => {
  it("is compact", () => {
    expect(formatDuration(60)).toBe("1:00");
    expect(formatDuration(725)).toBe("12:05");
    expect(formatDuration(3723)).toBe("1:02:03");
  });
});

describe("parseTime", () => {
  it("parses hh:mm:ss, mm:ss and seconds", () => {
    expect(parseTime("01:24:31")).toBe(5071);
    expect(parseTime("2:05")).toBe(125);
    expect(parseTime("90")).toBe(90);
    expect(parseTime("00:00:10.5")).toBe(10.5);
  });
  it("rejects invalid input", () => {
    expect(parseTime("")).toBeNull();
    expect(parseTime("abc")).toBeNull();
    expect(parseTime("1:2:3:4")).toBeNull();
    expect(parseTime("00:75")).toBeNull();
  });
});

describe("secondsSince / fileName", () => {
  it("computes elapsed seconds", () => {
    const now = Date.parse("2026-09-23T18:00:00Z");
    expect(secondsSince("2026-09-23T17:00:00Z", now)).toBe(3600);
    expect(secondsSince(undefined, now)).toBe(0);
  });
  it("extracts file names from Windows and POSIX paths", () => {
    expect(fileName("D:\\Streams\\stream_2026-09-23.mkv")).toBe("stream_2026-09-23.mkv");
    expect(fileName("/home/me/a.mp4")).toBe("a.mp4");
  });
});
