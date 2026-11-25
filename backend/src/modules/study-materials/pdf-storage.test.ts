import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  assertPdfFilename,
  assertStorageKey,
  buildStorageKey,
  newMaterialId,
  resolveStoragePath,
  sanitizeOriginalFilename,
  studyMaterialsRoot,
} from "./pdf-storage";

const UUID = "80cee706-de4e-431f-acb6-3fe7b37d805c";

describe("PDF storage helpers", () => {
  it("keeps only the basename of an original filename", () => {
    expect(sanitizeOriginalFilename("..\\..\\fake.pdf")).toBe("fake.pdf");
    expect(sanitizeOriginalFilename("/tmp/notes\u0000.pdf")).toBe("notes.pdf");
    expect(sanitizeOriginalFilename("  report.pdf  ")).toBe("report.pdf");
  });

  it("rejects empty or traversal-only original filenames", () => {
    expect(() => sanitizeOriginalFilename("")).toThrow();
    expect(() => sanitizeOriginalFilename("..")).toThrow();
  });

  it("requires a .pdf extension on the original filename", () => {
    expect(() => assertPdfFilename("notes.PDF")).not.toThrow();
    expect(() => assertPdfFilename("notes.exe")).toThrow();
  });

  it("builds a relative UUID-based storage key", () => {
    expect(buildStorageKey(6, "Mathematics", UUID)).toBe(`6/mathematics/${UUID}.pdf`);
    expect(() => buildStorageKey(0, "Mathematics", UUID)).toThrow();
    expect(() => buildStorageKey(6, "Mathematics", "not-a-uuid")).toThrow();
  });

  it("generates UUID v4 material ids", () => {
    expect(newMaterialId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("rejects unsafe storage keys", () => {
    expect(() => assertStorageKey(`6/mathematics/${UUID}.pdf`)).not.toThrow();
    expect(() => assertStorageKey("../../etc/passwd")).toThrow();
    expect(() => assertStorageKey(`C:\\temp\\${UUID}.pdf`)).toThrow();
    expect(() => assertStorageKey(`6/mathematics/${UUID}.txt`)).toThrow();
  });

  it("resolves keys only inside the configured upload root", () => {
    const root = studyMaterialsRoot();
    const key = `6/mathematics/${UUID}.pdf`;
    expect(resolveStoragePath(key)).toBe(resolve(root, "6", "mathematics", `${UUID}.pdf`));
    expect(() => resolveStoragePath("../../secrets.pdf")).toThrow();
  });
});
