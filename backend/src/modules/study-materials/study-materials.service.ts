import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from "@nestjs/common";
import { DbService } from "../../db/db.service";
import { assertPdfMimeType, PdfInspector } from "./pdf-validation";
import {
  assertPdfFilename,
  assertStorageKey,
  buildStorageKey,
  deleteFileQuietly,
  ensureStorageDirectory,
  maxPdfBytes,
  newMaterialId,
  resolveStoragePath,
  sanitizeOriginalFilename,
  tempFilePathFor,
} from "./pdf-storage";
import type {
  AdminListQuery,
  UpdateStudyMaterialInput,
  UploadStudyMaterialInput,
} from "./study-materials.schemas";

type UploadFile = {
  mimetype: string;
  filename: string;
  file: Readable & { truncated?: boolean };
};

type SubjectRow = {
  id: string;
  name: string;
  classId: string;
  grade: number;
};

type MaterialRow = {
  id: string;
  title: string;
  originalFilename: string;
  mimeType: string;
  fileSize: string;
  isActive: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
  subjectId: string;
  subjectName: string;
  classId: string;
  grade: number;
  className: string;
};

type DetailRow = MaterialRow & { checksum: string; storageKey: string };

type StreamRow = {
  originalFilename: string;
  mimeType: string;
  fileSize: string;
  storageKey: string;
  checksum: string;
  updatedAt: Date | string;
  classId: string;
  activeClassId: string | null;
};

const MATERIAL_COLUMNS = `
  sm.id, sm.title, sm.original_filename AS "originalFilename",
  sm.mime_type AS "mimeType", sm.file_size AS "fileSize",
  sm.is_active AS "isActive", sm.created_at AS "createdAt", sm.updated_at AS "updatedAt",
  sm.subject_id AS "subjectId", s.name AS "subjectName",
  s."classId" AS "classId", sc.grade AS "grade", sc.title AS "className"`;

const MATERIAL_FROM = `
  FROM study_materials sm
  JOIN "Subject" s ON s.id = sm.subject_id
  JOIN "SchoolClass" sc ON sc.id = s."classId"`;

const DETAIL_COLUMNS = `${MATERIAL_COLUMNS}, sm.checksum, sm.storage_key AS "storageKey"`;

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : String(value);

const toAdminDto = (row: MaterialRow) => ({
  id: row.id,
  title: row.title,
  originalFilename: row.originalFilename,
  mimeType: row.mimeType,
  fileSize: Number(row.fileSize),
  isActive: row.isActive,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
  classId: row.classId,
  grade: row.grade,
  className: row.className,
  subjectId: row.subjectId,
  subjectName: row.subjectName,
  viewUrl: `/api/study-materials/${row.id}/view`,
});

const toStudentDto = (row: MaterialRow) => ({
  id: row.id,
  title: row.title,
  originalFilename: row.originalFilename,
  mimeType: row.mimeType,
  fileSize: Number(row.fileSize),
  createdAt: toIso(row.createdAt),
  viewUrl: `/api/study-materials/${row.id}/view`,
  downloadUrl: `/api/study-materials/${row.id}/view?download=1`,
});

@Injectable()
export class StudyMaterialsService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  // ------------------------------------------------------------- classes --

  async listClasses() {
    const { rows } = await this.db.query<{ id: string; grade: number; title: string }>(
      `SELECT "id", "grade", "title" FROM "SchoolClass" ORDER BY "grade" ASC, "id" ASC`
    );
    return rows.map((row) => ({ id: row.id, grade: row.grade, title: row.title }));
  }

  async listSubjects(classId: string) {
    const { rows } = await this.db.query<{ id: string; name: string }>(
      `SELECT "id", "name" FROM "Subject" WHERE "classId" = $1 ORDER BY "order" ASC, "id" ASC`,
      [classId]
    );
    return rows.map((row) => ({ id: row.id, name: row.name }));
  }

  private async findSubject(classId: string, subjectId: string): Promise<SubjectRow> {
    const row = await this.db.queryOne<SubjectRow>(
      `SELECT s."id", s."name", s."classId", sc."grade"
         FROM "Subject" s
         JOIN "SchoolClass" sc ON sc."id" = s."classId"
        WHERE s."id" = $1 AND sc."id" = $2`,
      [subjectId, classId]
    );
    if (!row) {
      throw new BadRequestException({ error: "Subject does not belong to the selected class" });
    }
    return row;
  }

  private async findDetailRow(id: string): Promise<DetailRow> {
    const row = await this.db.queryOne<DetailRow>(
      `SELECT ${DETAIL_COLUMNS} ${MATERIAL_FROM} WHERE sm."id" = $1`,
      [id]
    );
    if (!row) throw new NotFoundException({ error: "Study material not found" });
    return row;
  }

  private adminFilters(query: AdminListQuery): { sql: string; params: unknown[] } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const classId = query.class_id ?? query.classId;
    const subjectId = query.subject_id ?? query.subjectId;

    if (classId) {
      params.push(classId);
      conditions.push(`s."classId" = $${params.length}`);
    }
    if (subjectId) {
      params.push(subjectId);
      conditions.push(`sm.subject_id = $${params.length}`);
    }
    if (query.search) {
      // Literal search: wildcard characters from the client must stay literal.
      params.push(`%${query.search.replace(/[\\%_]/g, "")}%`);
      conditions.push(
        `(sm.title ILIKE $${params.length} OR sm.original_filename ILIKE $${params.length})`
      );
    }
    return { sql: conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "", params };
  }

  // --------------------------------------------------------------- admin --

  async listAdmin(query: AdminListQuery) {
    const { sql, params } = this.adminFilters(query);
    const limit = query.limit ?? 20;
    const page = query.page ?? 1;
    const offset = (page - 1) * limit;

    const [{ rows: totalRows }, { rows }] = await Promise.all([
      this.db.query<{ count: number }>(`SELECT COUNT(*)::int AS count ${MATERIAL_FROM}${sql}`, params),
      this.db.query<MaterialRow>(
        `SELECT ${MATERIAL_COLUMNS} ${MATERIAL_FROM}${sql}
          ORDER BY sm.created_at DESC, sm.id DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
    ]);

    return {
      items: rows.map(toAdminDto),
      total: totalRows[0]?.count ?? 0,
      page,
      limit,
      pages: Math.max(1, Math.ceil((totalRows[0]?.count ?? 0) / limit)),
    };
  }

  async getAdmin(id: string) {
    const row = await this.findDetailRow(id);
    return {
      ...toAdminDto(row),
      checksum: row.checksum,
      storedFilename: `${row.id}.pdf`,
      storageKey: row.storageKey,
    };
  }

  async create(input: UploadStudyMaterialInput, upload: UploadFile) {
    const subject = await this.findSubject(input.class_id, input.subject_id);
    assertPdfMimeType(upload.mimetype);
    const originalFilename = sanitizeOriginalFilename(upload.filename);
    assertPdfFilename(originalFilename);

    const id = newMaterialId();
    const storageKey = buildStorageKey(subject.grade, subject.name, id);
    const finalPath = resolveStoragePath(storageKey);
    await ensureStorageDirectory(finalPath);
    const tempPath = tempFilePathFor(finalPath);
    const inspector = new PdfInspector(maxPdfBytes());
    let published = false;

    try {
      await pipeline(upload.file, inspector, createWriteStream(tempPath, { flags: "wx" }));
      if (upload.file.truncated) {
        throw new PayloadTooLargeException({
          error: `PDF exceeds the maximum allowed size of ${Math.floor(maxPdfBytes() / (1024 * 1024))} MB`,
        });
      }
      inspector.assertValidPdf();

      // Atomic publish: readers never see a partially written PDF.
      await rename(tempPath, finalPath);
      published = true;

      await this.db.query(
        `INSERT INTO study_materials
           ("id", "subject_id", "title", "original_filename", "stored_filename",
            "storage_key", "mime_type", "file_size", "checksum")
         VALUES ($1, $2, $3, $4, $5, $6, 'application/pdf', $7, $8)`,
        [id, subject.id, input.title, originalFilename, id, storageKey, inspector.bytesWritten, inspector.checksum]
      );
      const row = await this.findDetailRow(id);
      return toAdminDto(row);
    } catch (error) {
      // No orphaned files: either the temp file or the just-published file is removed.
      await deleteFileQuietly(published ? finalPath : tempPath);
      throw error;
    }
  }

  async update(id: string, input: UpdateStudyMaterialInput) {
    const current = await this.findDetailRow(id);
    const nextSubjectId = input.subject_id ?? input.subjectId;
    const rawActive = input.is_active ?? input.isActive;
    const isActive =
      typeof rawActive === "boolean"
        ? rawActive
        : rawActive === undefined
          ? undefined
          : rawActive === "true" || rawActive === "1";

    let nextStorageKey = current.storageKey;
    let move: { from: string; to: string } | null = null;

    if (nextSubjectId && nextSubjectId !== current.subjectId) {
      // Subject reassignment stays within the material's class.
      const subject = await this.findSubject(current.classId, nextSubjectId);
      nextStorageKey = buildStorageKey(subject.grade, subject.name, id);
      const from = resolveStoragePath(current.storageKey);
      const to = resolveStoragePath(nextStorageKey);
      if (from !== to) {
        await mkdir(dirname(to), { recursive: true });
        await rename(from, to);
        move = { from, to };
      }
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (fragment: string, value: unknown) => {
      sets.push(fragment.replace("$N", `$${params.length + 1}`));
      params.push(value);
    };

    if (input.title !== undefined) add(`title = $N`, input.title);
    if (nextSubjectId !== undefined) add(`subject_id = $N`, nextSubjectId);
    if (isActive !== undefined) add(`is_active = $N`, isActive);
    if (move) add(`storage_key = $N`, nextStorageKey);
    if (sets.length === 0) return this.getAdmin(id);

    sets.push(`updated_at = NOW()`);
    params.push(id);

    try {
      const result = await this.db.query(
        `UPDATE study_materials SET ${sets.join(", ")} WHERE id = $${params.length}`,
        params
      );
      if (result.rowCount === 0) throw new NotFoundException({ error: "Study material not found" });
    } catch (error) {
      if (move) await rename(move.to, move.from).catch(() => undefined);
      throw error;
    }

    return this.getAdmin(id);
  }

  async delete(id: string) {
    const row = await this.findDetailRow(id);
    const filePath = resolveStoragePath(row.storageKey);
    const trashPath = `${filePath}.deleting-${randomUUID()}`;

    // Move aside first: a failed DB delete can be rolled back by moving it back.
    const moved = await rename(filePath, trashPath)
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false; // already missing: still clean the record
        throw error;
      });
    try {
      const result = await this.db.query(`DELETE FROM study_materials WHERE id = $1`, [id]);
      if (result.rowCount === 0) {
        if (moved) await rename(trashPath, filePath).catch(() => undefined);
        throw new NotFoundException({ error: "Study material not found" });
      }
    } catch (error) {
      if (moved) await rename(trashPath, filePath).catch(() => undefined);
      throw error;
    }
    if (moved) await deleteFileQuietly(trashPath);
    return { success: true };
  }

  // ------------------------------------------------------------- student --

  async listForStudent(
    classId: string,
    subjectId: string,
    userId: string,
    query: { page: number; limit: number }
  ) {
    const access = await this.db.queryOne<{
      subjectExists: boolean;
      activeClassId: string | null;
    }>(
      `SELECT EXISTS(
         SELECT 1 FROM "Subject" WHERE "id" = $1 AND "classId" = $2
       ) AS "subjectExists",
       (SELECT "activeClassId" FROM "StudentProfile" WHERE "userId" = $3) AS "activeClassId"`,
      [subjectId, classId, userId]
    );
    if (!access?.subjectExists) throw new NotFoundException({ error: "Subject not found for this class" });
    if (!access.activeClassId || access.activeClassId !== classId) {
      throw new BadRequestException({ error: "This material is not available for your class" });
    }

    const params = [subjectId, classId];
    const limit = query.limit ?? 20;
    const page = query.page ?? 1;
    const offset = (page - 1) * limit;
    const where = ` WHERE sm.is_active AND sm.subject_id = $1 AND s."classId" = $2`;

    const [{ rows: totalRows }, { rows }] = await Promise.all([
      this.db.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count ${MATERIAL_FROM}${where}`,
        params
      ),
      this.db.query<MaterialRow>(
        `SELECT ${MATERIAL_COLUMNS} ${MATERIAL_FROM}${where}
          ORDER BY sm.created_at DESC, sm.id DESC
          LIMIT $3 OFFSET $4`,
        [...params, limit, offset]
      ),
    ]);

    const total = totalRows[0]?.count ?? 0;
    return {
      items: rows.map(toStudentDto),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  /** Returns trusted metadata for streaming; never a filesystem path. */
  async getForStreaming(id: string, userId: string | null, isAdmin: boolean): Promise<{
    storageKey: string;
    originalFilename: string;
    mimeType: string;
    fileSize: number;
    checksum: string;
    updatedAt: string;
  }> {
    const row = await this.db.queryOne<StreamRow>(
      `SELECT sm.original_filename AS "originalFilename", sm.mime_type AS "mimeType",
              sm.file_size AS "fileSize", sm.storage_key AS "storageKey",
              sm.checksum, sm.updated_at AS "updatedAt", s."classId" AS "classId",
              (SELECT "activeClassId" FROM "StudentProfile" WHERE "userId" = $2) AS "activeClassId"
         FROM study_materials sm
         JOIN "Subject" s ON s.id = sm.subject_id
        WHERE sm.id = $1 AND sm.is_active`,
      [id, userId]
    );
    if (!row) throw new NotFoundException({ error: "Study material not found" });

    assertStorageKey(row.storageKey);
    if (!isAdmin && row.activeClassId !== row.classId) {
      throw new BadRequestException({ error: "This material is not available for your class" });
    }

    const filePath = resolveStoragePath(row.storageKey);
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile()) {
      throw new NotFoundException({ error: "Study material file is unavailable" });
    }

    return {
      storageKey: row.storageKey,
      originalFilename: row.originalFilename,
      mimeType: row.mimeType,
      fileSize: fileStat.size,
      checksum: row.checksum,
      updatedAt: toIso(row.updatedAt),
    };
  }
}

/** Used by the streaming controller to get the checked absolute path. */
export const streamFilePath = (storageKey: string): string => resolveStoragePath(storageKey);

/** Kept for tests that need to assert the physical file is gone. */
export const fileExists = async (storageKey: string): Promise<boolean> => {
  const path = resolveStoragePath(storageKey);
  return stat(path).then(() => true).catch(() => false);
};

export const removePhysicalFile = async (storageKey: string): Promise<void> =>
  unlink(resolveStoragePath(storageKey)).catch(() => undefined);
