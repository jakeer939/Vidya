import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { assertPdfMimeType, PdfInspector } from "./pdf-validation";

const sink = () =>
  new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });

const inspect = async (chunks: Buffer[], maxBytes = 1024 * 1024) => {
  const inspector = new PdfInspector(maxBytes);
  await pipeline(Readable.from(chunks), inspector, sink());
  return inspector;
};

const errorText = (getError: () => unknown): string => {
  let error: unknown;
  try {
    getError();
  } catch (caught) {
    error = caught;
  }
  const exception = error as { getResponse?: () => unknown };
  const response = exception.getResponse?.();
  if (response && typeof response === "object" && "error" in response) {
    return String((response as { error: unknown }).error);
  }
  return String(error);
};

describe("PDF validation", () => {
  it("accepts a PDF whose magic bytes are at byte zero", async () => {
    const head = Buffer.from("%PDF-1.4\n");
    const tail = Buffer.from("%%EOF");
    const inspector = await inspect([head, tail]);

    expect(inspector.bytesWritten).toBe(head.length + tail.length);
    expect(inspector.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(() => inspector.assertValidPdf()).not.toThrow();
  });

  it("rejects files without the PDF signature", async () => {
    const inspector = await inspect([Buffer.from("not a real pdf")]);
    expect(() => inspector.assertValidPdf()).toThrow(BadRequestException);
    expect(errorText(() => inspector.assertValidPdf())).toContain("missing %PDF- signature");
  });

  it("rejects a PDF signature that is not at byte zero", async () => {
    const inspector = await inspect([Buffer.from("junk%PDF-1.4")]);
    expect(() => inspector.assertValidPdf()).toThrow(BadRequestException);
    expect(errorText(() => inspector.assertValidPdf())).toContain("missing %PDF- signature");
  });

  it("rejects empty uploads", async () => {
    const inspector = await inspect([]);
    expect(() => inspector.assertValidPdf()).toThrow(BadRequestException);
    expect(errorText(() => inspector.assertValidPdf())).toContain("empty");
  });

  it("enforces the configured byte limit while streaming", async () => {
    const error = await pipeline(
      Readable.from([Buffer.from("%PDF-1.4")]),
      new PdfInspector(4),
      sink()
    ).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(PayloadTooLargeException);
    expect(errorText(() => { throw error; })).toContain("exceeds the maximum allowed size");
  });

  it("checks the declared MIME type", () => {
    expect(() => assertPdfMimeType("application/pdf")).not.toThrow();
    expect(() => assertPdfMimeType("application/pdf; charset=binary")).not.toThrow();
    expect(() => assertPdfMimeType("text/plain")).toThrow(BadRequestException);
    expect(errorText(() => assertPdfMimeType("text/plain"))).toContain("Only application/pdf");
  });
});
