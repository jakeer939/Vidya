import { createReadStream } from "node:fs";
import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { JwtAuthGuard, type AuthedRequest } from "../../auth/jwt.guard";
import { StudentRoleGuard } from "../../auth/student-role.guard";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PdfViewGuard, type PdfViewRequest } from "./pdf-view.guard";
import { filenameForHeader, parseRangeHeader } from "./pdf-range";
import {
  studentListQuerySchema,
  type StudentListQuery,
} from "./study-materials.schemas";
import { streamFilePath, StudyMaterialsService } from "./study-materials.service";

@ApiTags("study materials")
@ApiBearerAuth()
@Controller()
export class StudentStudyMaterialsController {
  constructor(
    @Inject(StudyMaterialsService) private readonly materials: StudyMaterialsService
  ) {}

  @Get([
    "api/classes/:classId/subjects/:subjectId/materials",
    "api/v1/classes/:classId/subjects/:subjectId/materials",
  ])
  @ApiOperation({ summary: "Active PDF materials for a class & subject (paginated)" })
  @UseGuards(JwtAuthGuard, StudentRoleGuard)
  list(
    @Param("classId") classId: string,
    @Param("subjectId") subjectId: string,
    @Req() req: AuthedRequest,
    @Query(new ZodValidationPipe(studentListQuerySchema)) query: StudentListQuery
  ) {
    return this.materials.listForStudent(classId, subjectId, req.user!.sub, query);
  }

  @Get(["api/study-materials/:id/view", "api/v1/study-materials/:id/view"])
  @ApiOperation({
    summary: "Stream a PDF with HTTP Range support (inline or download=1)",
  })
  @UseGuards(PdfViewGuard)
  async view(
    @Param("id") id: string,
    @Req() req: PdfViewRequest,
    @Res() reply: FastifyReply,
    @Query("download") download?: string
  ) {
    const material = await this.materials.getForStreaming(
      id,
      req.user?.sub ?? null,
      !!req.pdfAdmin
    );
    const filePath = streamFilePath(material.storageKey);
    const range = parseRangeHeader(req.headers.range, material.fileSize);
    const safeName = filenameForHeader(material.originalFilename);
    const disposition = download === "1" || download === "true" ? "attachment" : "inline";

    reply.header("Content-Type", material.mimeType);
    reply.header(
      "Content-Disposition",
      `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(material.originalFilename)}`
    );
    reply.header("Accept-Ranges", "bytes");
    reply.header("Cache-Control", "private, max-age=60");
    reply.header("ETag", `"${material.checksum}"`);
    reply.header("Last-Modified", new Date(material.updatedAt).toUTCString());

    if (req.headers["if-none-match"] === `"${material.checksum}"`) {
      reply.code(304).send();
      return;
    }

    if (range.kind === "unsatisfiable") {
      reply
        .code(416)
        .header("Content-Type", "application/json")
        .header("Content-Range", `bytes */${material.fileSize}`)
        .send({ error: "Range not satisfiable" });
      return;
    }

    if (range.kind === "partial") {
      reply
        .code(206)
        .header("Content-Range", range.contentRange)
        .header("Content-Length", String(range.length));
    } else {
      reply.code(200).header("Content-Length", String(material.fileSize));
    }

    const stream = createReadStream(filePath,
      range.kind === "partial" ? { start: range.start, end: range.end } : {}
    );
    stream.on("error", () => {
      if (!reply.sent) reply.code(500).send({ error: "Could not stream PDF" });
    });
    reply.send(stream);
  }
}
