import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { FastifyRequest } from "fastify";
import { verifyAccessToken, type JwtPayload } from "../../auth/jwt";
import { isStudent } from "../../auth/roles";

export type PdfViewRequest = FastifyRequest & {
  user?: JwtPayload;
  pdfAdmin?: boolean;
};

/**
 * PDF viewers cannot send Authorization headers on <iframe>/<embed> requests,
 * so this guard also accepts a short-lived access token as `access_token`.
 * The existing support admin token (`x-admin-token` or `admin_token`) is also
 * accepted so admins can preview uploads from the management screen.
 */
@Injectable()
export class PdfViewGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<PdfViewRequest>();
    const query = req.query as Record<string, unknown> | undefined;
    const bearer = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice("Bearer ".length).trim()
      : undefined;
    const queryToken =
      typeof query?.access_token === "string" ? query.access_token : undefined;
    const token = bearer || queryToken;

    if (token) {
      try {
        const payload = verifyAccessToken(token, this.config);
        if (isStudent(payload)) {
          req.user = payload;
          return true;
        }
      } catch {
        // fall through to the admin token check
      }
    }

    const adminToken =
      (req.headers["x-admin-token"] as string | undefined) ??
      (typeof query?.admin_token === "string" ? query.admin_token : undefined);
    const expected = (process.env.ADMIN_TOKEN || "vidya-admin-secret").trim();
    if (adminToken && adminToken === expected) {
      req.pdfAdmin = true;
      return true;
    }

    throw new UnauthorizedException({ error: "Unauthorized" });
  }
}
