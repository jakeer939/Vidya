# Study materials (PDF uploads)

This document covers the PDF study-material feature shared by the admin management screen and the student course screen.

## Architecture

- **Backend:** NestJS v11 + Fastify v5 (`backend/src/modules/study-materials/`).
- **Database:** PostgreSQL stores metadata and a relative storage key only. See `backend/db/sql/migrations/005_study_materials.sql`.
- **Files:** PDFs are streamed to local disk under `UPLOAD_DIR`; they are never placed in a public/static directory.
- **Physical filename:** `<uuid-v4>.pdf`. The original filename is kept in `original_filename` for display only.
- **Relative storage key:** `<grade>/<subject-slug>/<uuid>.pdf`, e.g. `6/mathematics/80cee706-de4e-431f-acb6-3fe7b37d805c.pdf`.
- **Frontend:** React JS/JSX + pure CSS in `web-frontend/src/pages/AdminStudyMaterialsPage.jsx` and `StudyMaterialsPage.jsx`.

The existing `DbService`, `JwtAuthGuard`, `StudentRoleGuard`, and `x-admin-token` admin mechanism are reused; no new auth or ORM layer was introduced.

## Configuration

Add these to the root `.env` (see `.env.example`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_TOKEN` | `vidya-admin-secret` | Shared secret for admin routes. Send it as `x-admin-token`. |
| `UPLOAD_DIR` | `./uploads/study-materials` (relative to the API process) | Root directory for PDF storage. |
| `MAX_PDF_SIZE_MB` | `50` | Per-file upload limit; capped at 500 MB. |

Change `ADMIN_TOKEN` in any non-local environment. The upload directory should be outside any directory served by `@fastify/static`; the app only serves `/uploads/avatars/...` statically.

Apply the migration once:

```bash
pnpm db:migrate
```

## API reference

Both `/api/...` and `/api/v1/...` variants are available for every route below.

### Admin (requires `x-admin-token`)

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/admin/classes` | Classes available for uploads. |
| `GET` | `/admin/classes/:classId/subjects` | Subjects for a class. |
| `POST` | `/admin/study-materials` | Upload a PDF (multipart). |
| `GET` | `/admin/study-materials` | Filter/paginate metadata. |
| `GET` | `/admin/study-materials/:id` | Full metadata for one PDF. |
| `PATCH` | `/admin/study-materials/:id` | Update `title`, `subject_id`, `is_active`. |
| `DELETE` | `/admin/study-materials/:id` | Delete metadata and physical file. |

Multipart fields: `class_id`, `subject_id`, `title`, `file`. **Send the three fields before the file part** because the multipart parser is serial and the request stream is handled without buffering the whole PDF in memory.

Admin list query parameters: `page` (default 1), `limit` (default 20, max 100), `class_id`, `subject_id`, `search`.

### Student (requires JWT)
| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/classes/:classId/subjects/:subjectId/materials` | Active PDFs for the student's active class. |
| `GET` | `/study-materials/:id/view` | Stream a PDF inline or as a download. |

Student list query parameters: `page`, `limit`. A student can only see materials whose subject belongs to their `activeClassId`.

The view endpoint accepts a JWT as `Authorization: Bearer <token>`, as `?access_token=<token>` (needed for browser `<iframe>`/`<embed>` viewers), or an admin token as `x-admin-token`/`?admin_token=`. It supports `Range: bytes=...` with `206 Partial Content`, `Accept-Ranges`, `ETag`, `Last-Modified`, `304`, and `416`. Add `?download=1` for `Content-Disposition: attachment`.

## Upload flow and validation

1. Verify the JWT/admin token and multipart content type.
2. Parse fields before the file stream; enforce part/field/file limits.
3. Confirm `class_id` and `subject_id` belong together in the database.
4. Reject filenames without a `.pdf` extension and MIME types other than `application/pdf`.
5. Stream through `PdfInspector`, which enforces the size limit, verifies `%PDF-` at byte zero, hashes the content with SHA-256, and counts bytes. The full file is never buffered in memory.
6. Write to a hidden `.part` file in the target directory, then atomically rename it to `<uuid>.pdf`.
7. Insert metadata. On any failure, the temp/partial file is removed.
8. Update moves the file if the subject changes (within the same class). Delete moves the file aside before removing the DB row, and rolls back if the DB delete fails.

All storage keys are matched against a strict regex before being resolved, and the resolved path must remain under `UPLOAD_DIR`. Absolute paths are never returned to clients.

## Manual smoke test

Run the API locally (`pnpm dev:api`), then use a small valid PDF:

```bash
TOKEN="vidya-admin-secret"
API="http://localhost:4000/api/v1"
PDF="./sample.pdf"

# Admin: create
curl -i -X POST "$API/admin/study-materials" \
  -H "x-admin-token: $TOKEN" \
  -F "class_id=class-6" \
  -F "subject_id=c6-maths" \
  -F "title=Mathematics Textbook" \
  -F "file=@$PDF;type=application/pdf"

# Admin: list / detail / update / delete
curl -s "$API/admin/study-materials?page=1&limit=20" -H "x-admin-token: $TOKEN"
curl -s "$API/admin/study-materials/<id>" -H "x-admin-token: $TOKEN"
curl -s -X PATCH "$API/admin/study-materials/<id>" \
  -H "Content-Type: application/json" -H "x-admin-token: $TOKEN" \
  -d '{"title":"Revised Textbook","is_active":false}'
curl -s -X DELETE "$API/admin/study-materials/<id>" -H "x-admin-token: $TOKEN"

# Rejection checks (expect HTTP 400)
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$API/admin/study-materials" \
  -H "x-admin-token: $TOKEN" \
  -F "class_id=class-6" -F "subject_id=c6-maths" -F "title=Bad" \
  -F "file=@./notes.txt;type=text/plain"
```

For the student endpoints, log in with a seeded class-6 student and use the returned access token:

```bash
LOGIN=$(curl -s -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"meera.iyer@vidya.test","password":"StudentDemo1!"}')
JWT=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).accessToken)' "$LOGIN")

curl -s "$API/classes/class-6/subjects/c6-maths/materials" \
  -H "Authorization: Bearer $JWT"

curl -s -i "$API/study-materials/<id>/view?access_token=$JWT" \
  -H 'Range: bytes=0-99'
```

Expected: list `200`, view `206` with `Content-Range: bytes 0-99/<size>`, an out-of-bounds range returns `416`, and a request without a token returns `401`.

Verify that metadata and files stay in sync:

```bash
node -e "const {Client}=require('pg');const c=new Client({host:'127.0.0.1',database:'vidya',user:'vidya',password:'vidya'});c.connect().then(()=>c.query('SELECT id, storage_key FROM study_materials')).then(r=>console.log(r.rows)).finally(()=>c.end())"
find "$UPLOAD_DIR" -type f -name '*.pdf'
```

## Automated checks

```bash
pnpm --dir backend typecheck
pnpm --dir backend test
pnpm --dir web-frontend build
```

The backend tests cover range parsing, storage-key/path safety, and streaming PDF validation. The frontend build verifies the admin and student pages and the API service compile cleanly.

## Frontend routes

- `/admin/materials` — admin upload/list/filter/edit/delete screen (linked from the header).
- `/courses/:classId/:subjectId/materials` — student PDF list and inline viewer (linked from subject details).

Both pages use only local CSS in `web-frontend/src/pages/AdminStudyMaterialsPage.css` and `StudyMaterialsPage.css`; no UI framework was added.
