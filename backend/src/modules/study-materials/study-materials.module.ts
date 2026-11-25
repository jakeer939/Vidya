import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AdminTokenGuard } from "../support/admin-token.guard";
import { AdminStudyMaterialsController } from "./admin-study-materials.controller";
import { PdfViewGuard } from "./pdf-view.guard";
import { StudentStudyMaterialsController } from "./student-study-materials.controller";
import { StudyMaterialsService } from "./study-materials.service";

@Module({
  imports: [ConfigModule],
  controllers: [AdminStudyMaterialsController, StudentStudyMaterialsController],
  providers: [StudyMaterialsService, PdfViewGuard, AdminTokenGuard],
  exports: [StudyMaterialsService],
})
export class StudyMaterialsModule {}
