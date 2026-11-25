import "@fastify/multipart";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiSecurity, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { AdminTokenGuard } from "../support/admin-token.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { maxPdfBytes } from "./pdf-storage";
import {
  adminListQuerySchema,
  updateStudyMaterialSchema,
  uploadStudyMaterialSchema,
  type AdminListQuery,
  type UpdateStudyMaterialInput,
} from "./study-materials.schemas";
import { StudyMaterialsService } from "./study-materials.service";

@ApiTags("admin · study materials")
@ApiSecurity("x-admin-token")
@Controller()
@UseGuards(AdminTokenGuard)
export class AdminStudyMaterialsController {
  constructor(
    @Inject(StudyMaterialsService) private readonly materials: StudyMaterialsService
  ) {}

  @Get(["api/admin/classes", "api/v1/admin/classes"])
  @ApiOperation({ summary: "Classes available for study material uploads" })
  listClasses() {
    return this.materials.listClasses();
  }

  @Get(["api/admin/classes/:classId/subjects", "api/v1/admin/classes/:classId/subjects"])
  @ApiOperation({ summary: "Subjects for a class (admin)" })
  listSubjects(@Param("classId") classId: string) {
    return this.materials.listSubjects(classId);
  }

  @Post(["api/admin/study-materials", "api/v1/admin/study-materials"])
  @ApiOperation({
    summary: "Upload a PDF study material (multipart: class_id, subject_id, title, file)",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["class_id", "subject_id", "title", "file"],
      properties: {
        class_id: { type: "string", example: "class-6" },
        subject_id: { type: "string", example: "c6-maths" },
        title: { type: "string", example: "Mathematics Textbook" },
        file: { type: "string", format: "binary" },
      },
    },
  })
  async upload(@Req() req: FastifyRequest) {
    if (!req.isMultipart()) {
      throw new BadRequestException({ error: "Expected multipart/form-data" });
    }

    // Keep value fields before the `file` part: @fastify/busboy parses serially,
    // so fields that appear after a file are not available until that file has
    // been consumed. The frontend and documented curl examples use this order.
    const file = await req.file({
      limits: { files: 1, parts: 10, fields: 6, fieldSize: 4096, fileSize: maxPdfBytes() },
    });
    if (!file || file.fieldname !== "file") {
      file?.file.resume();
      throw new BadRequestException({ error: "Exactly one 'file' field is required" });
    }

    const fields: Record<string, string> = {};
    for (const [name, part] of Object.entries(file.fields)) {
      const field = Array.isArray(part) ? part[0] : part;
      if (field?.type === "field" && field.value !== undefined) {
        fields[name] = String(field.value);
      }
    }

    const input = new ZodValidationPipe(uploadStudyMaterialSchema).transform({
      class_id: fields.class_id ?? fields.classId,
      subject_id: fields.subject_id ?? fields.subjectId,
      title: fields.title,
    });

    return this.materials.create(input, {
      mimetype: file.mimetype,
      filename: file.filename,
      file: file.file,
    });
  }

  @Get(["api/admin/study-materials", "api/v1/admin/study-materials"])
  @ApiOperation({ summary: "List uploaded PDFs with filtering and pagination" })
  list(
    @Query(new ZodValidationPipe(adminListQuerySchema))
    query: AdminListQuery
  ) {
    return this.materials.listAdmin(query);
  }

  @Get(["api/admin/study-materials/:id", "api/v1/admin/study-materials/:id"])
  @ApiOperation({ summary: "Get PDF metadata by id" })
  get(@Param("id") id: string) {
    return this.materials.getAdmin(id);
  }

  @Patch(["api/admin/study-materials/:id", "api/v1/admin/study-materials/:id"])
  @ApiOperation({ summary: "Update title, subject association or active status" })
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateStudyMaterialSchema)) body: UpdateStudyMaterialInput
  ) {
    return this.materials.update(id, body);
  }

  @Delete(["api/admin/study-materials/:id", "api/v1/admin/study-materials/:id"])
  @ApiOperation({ summary: "Delete PDF metadata and its physical file" })
  remove(@Param("id") id: string) {
    return this.materials.delete(id);
  }
}
