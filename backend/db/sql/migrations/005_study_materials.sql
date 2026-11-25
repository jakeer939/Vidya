-- Study materials (PDF) metadata.
-- PDF binaries live on the local filesystem; this table stores metadata and a
-- relative storage key only. Existing SchoolClass / Subject tables are reused.

CREATE TABLE IF NOT EXISTS study_materials (
    id                UUID        PRIMARY KEY,
    subject_id        TEXT        NOT NULL
                                  REFERENCES "Subject" ("id")
                                  ON DELETE CASCADE ON UPDATE CASCADE,
    title             VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    stored_filename   VARCHAR(36)  NOT NULL UNIQUE,
    storage_key       TEXT         NOT NULL UNIQUE,
    mime_type         VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
    file_size         BIGINT       NOT NULL CHECK (file_size > 0),
    checksum          VARCHAR(64)  NOT NULL,
    is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT study_materials_mime_pdf_check
      CHECK (mime_type = 'application/pdf'),
    CONSTRAINT study_materials_checksum_format_check
      CHECK (checksum ~ '^[0-9a-f]{64}$')
);

COMMENT ON TABLE study_materials IS
  'Metadata and relative file references for uploaded PDF study materials. The files themselves are stored outside the public static directories.';
COMMENT ON COLUMN study_materials.storage_key IS
  'Relative key under UPLOAD_DIR, e.g. 6/mathematics/<uuid>.pdf. Never an absolute filesystem path.';

-- Query patterns:
--   * student listing: subject_id + is_active + newest first
--   * admin listing/filter: optional subject_id, is_active, newest first
-- The composite partial index covers both filtering and the ORDER BY, so no
-- separate single-column index is needed. The PK/unique constraints already
-- provide the id / stored_filename / storage_key indexes.
CREATE INDEX IF NOT EXISTS study_materials_subject_active_created_idx
    ON study_materials (subject_id, created_at DESC, id DESC)
    WHERE is_active;

-- Admin "all materials" listing sorts by created_at and may filter by is_active
-- in application-level queries; keep it small and partial-free only where it
-- actually helps (newest-first scans over active rows are covered above).
CREATE INDEX IF NOT EXISTS study_materials_created_idx
    ON study_materials (created_at DESC, id DESC);
