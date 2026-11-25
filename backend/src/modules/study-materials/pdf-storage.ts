import { randomUUID } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { BadRequestException } from "@nestjs/common";
import { slugify } from "../../common/ids";

const DEFAULT_MAX_PDF_SIZE_MB = 50;
const MAX_ALLOWED_PDF_SIZE_MB = 500;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STORAGE_KEY_PATTERN =
  /^([0-9]{1,3})\/([a-z0-9][a-z0-9-]{0,79})\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.pdf$/;

/** Root for study-material PDFs. Configurable; never inside a static route. */
export const studyMaterialsRoot = (): string =>
  resolve(process.env.UPLOAD_DIR?.trim() || resolve(process.cwd(), "uploads", "study-materials"));

/** Configurable per-file limit (MB). Invalid values fall back to 50 MB. */
export const maxPdfBytes = (): number => {
  const parsed = Number(process.env.MAX_PDF_SIZE_MB?.trim());
  const mb =
    Number.isFinite(parsed) && parsed > 0
      ? Math.min(parsed, MAX_ALLOWED_PDF_SIZE_MB)
      : DEFAULT_MAX_PDF_SIZE_MB;
  return Math.floor(mb * 1024 * 1024);
};

export const newMaterialId = (): string => randomUUID();

/**
 * Build the relative storage key: `<grade>/<subject-slug>/<uuid>.pdf`.
 * All segments come from database rows (not from the request) and are validated.
 */
export const buildStorageKey = (
  grade: number,
  subjectName: string,
  materialId: string
): string => {
  if (!Number.isInteger(grade) || grade < 1 || grade > 99) {
    throw new BadRequestException({ error: "Invalid class grade for storage" });
  }
  if (!UUID_V4_PATTERN.test(materialId)) {
    throw new BadRequestException({ error: "Invalid material id" });
  }
  const subjectSlug = slugify(subjectName);
  if (!subjectSlug) {
    throw new BadRequestException({ error: "Invalid subject name for storage" });
  }
  const key = `${grade}/${subjectSlug}/${materialId}.pdf`;
  assertStorageKey(key);
  return key;
};

/** Reject any key that is not exactly our trusted relative layout. */
export const assertStorageKey = (key: string): void => {
  if (!STORAGE_KEY_PATTERN.test(key)) {
    throw new BadRequestException({ error: "Invalid storage key" });
  }
};

/**
 * Resolve a storage key to an absolute path, with an explicit containment
 * check. Absolute paths are never returned to clients.
 */
export const resolveStoragePath = (key: string): string => {
  assertStorageKey(key);
  const root = studyMaterialsRoot();
  const target = resolve(root, ...key.split("/"));
  const rel = relative(root, target);
  if (isAbsolute(rel) || rel.startsWith("..") || rel.startsWith(`${sep}..`)) {
    throw new BadRequestException({ error: "Invalid storage key" });
  }
  return target;
};

export const ensureStorageDirectory = async (filePath: string): Promise<void> => {
  await mkdir(dirname(filePath), { recursive: true });
};

/** Temporary file in the target directory, renamed atomically after validation. */
export const tempFilePathFor = (finalPath: string): string =>
  join(dirname(finalPath), `.${basename(finalPath)}.${randomUUID()}.part`);

/** Only the basename is kept for display; the original name is never used on disk. */
export const sanitizeOriginalFilename = (value: string): string => {
  const withoutDirs = value.replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = withoutDirs
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/["']/g, "")
    .trim()
    .slice(0, 255);
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new BadRequestException({ error: "Invalid original filename" });
  }
  return cleaned;
};

/** Enforce that the client only claims a PDF file (magic bytes are checked separately). */
export const assertPdfFilename = (value: string): void => {
  const name = sanitizeOriginalFilename(value);
  if (extname(name).toLowerCase() !== ".pdf") {
    throw new BadRequestException({ error: "Only PDF files are accepted" });
  }
};

export const deleteFileQuietly = async (path: string): Promise<void> => {
  await unlink(path).catch(() => undefined);
};
