import { z } from "zod";

const resourceId = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid id");

const displayTitle = z.string().trim().min(1, "Title is required").max(255);

/** multipart/form-data fields (snake_case primary, camelCase accepted too). */
export const uploadStudyMaterialSchema = z.object({
  class_id: resourceId,
  subject_id: resourceId,
  title: displayTitle,
});

export type UploadStudyMaterialInput = z.infer<typeof uploadStudyMaterialSchema>;

export const updateStudyMaterialSchema = z
  .object({
    title: displayTitle.optional(),
    subject_id: resourceId.optional(),
    subjectId: resourceId.optional(),
    is_active: z.union([z.boolean(), z.enum(["true", "false", "1", "0"])]).optional(),
    isActive: z.union([z.boolean(), z.enum(["true", "false", "1", "0"])]).optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.subject_id !== undefined ||
      value.subjectId !== undefined ||
      value.is_active !== undefined ||
      value.isActive !== undefined,
    { message: "At least one field must be provided" }
  );

export type UpdateStudyMaterialInput = z.infer<typeof updateStudyMaterialSchema>;

const pagination = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

export const adminListQuerySchema = z.object({
  class_id: resourceId.optional(),
  classId: resourceId.optional(),
  subject_id: resourceId.optional(),
  subjectId: resourceId.optional(),
  search: z.string().trim().max(120).optional(),
  ...pagination,
});

export type AdminListQuery = z.infer<typeof adminListQuerySchema>;

export const studentListQuerySchema = z.object(pagination);
export type StudentListQuery = z.infer<typeof studentListQuerySchema>;
