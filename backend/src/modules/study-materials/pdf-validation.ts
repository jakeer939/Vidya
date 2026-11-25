import { createHash } from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";
import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";

const PDF_MAGIC = Buffer.from("%PDF-", "ascii");

/**
 * Stream inspector: hashes, counts and sniffs the first bytes while the upload
 * is written to disk. The complete PDF is never buffered in Node memory.
 */
export class PdfInspector extends Transform {
  private readonly hash = createHash("sha256");
  private readonly head = Buffer.alloc(PDF_MAGIC.length);
  private headLength = 0;

  bytesWritten = 0;
  checksum = "";

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.bytesWritten += chunk.length;
    if (this.bytesWritten > this.maxBytes) {
      callback(
        new PayloadTooLargeException({
          error: `PDF exceeds the maximum allowed size of ${Math.floor(this.maxBytes / (1024 * 1024))} MB`,
        })
      );
      return;
    }

    if (this.headLength < PDF_MAGIC.length) {
      const toCopy = Math.min(PDF_MAGIC.length - this.headLength, chunk.length);
      chunk.copy(this.head, this.headLength, 0, toCopy);
      this.headLength += toCopy;
    }

    this.hash.update(chunk);
    callback(null, chunk);
  }

  override _flush(callback: TransformCallback): void {
    this.checksum = this.hash.digest("hex");
    callback();
  }

  /** The PDF signature must be present at byte zero, not merely in the MIME header. */
  assertValidPdf(): void {
    if (this.bytesWritten === 0) {
      throw new BadRequestException({ error: "Uploaded file is empty" });
    }
    if (this.headLength < PDF_MAGIC.length || !this.head.equals(PDF_MAGIC)) {
      throw new BadRequestException({ error: "File is not a valid PDF (missing %PDF- signature)" });
    }
  }
}

/** Browser-provided MIME types are advisory; the signature check is authoritative. */
export const assertPdfMimeType = (mimetype: string): void => {
  if (mimetype.toLowerCase().split(";")[0].trim() !== "application/pdf") {
    throw new BadRequestException({ error: "Only application/pdf files are accepted" });
  }
};
