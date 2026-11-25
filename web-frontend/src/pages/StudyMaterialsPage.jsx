import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Maximize2,
} from 'lucide-react';
import { getClassById, getSubjectById } from '../services/curriculumService';
import {
  buildStudentViewUrl,
  extractErrorMessage,
  getStudentMaterials,
} from '../services/studyMaterialsService';
import { formatFileSize } from '../lib/format';
import styles from './StudyMaterialsPage.css';

const PAGE_SIZE = 8;

export const StudyMaterialsPage = () => {
  const { classId = '', subjectId = '' } = useParams();
  const schoolClass = useMemo(() => getClassById(classId), [classId]);
  const subject = useMemo(() => getSubjectById(classId, subjectId), [classId, subjectId]);

  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [previewId, setPreviewId] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getStudentMaterials(classId, subjectId, { page, limit: PAGE_SIZE })
      .then((result) => active && setData(result || { items: [], total: 0, pages: 1 }))
      .catch((err) => active && setError(extractErrorMessage(err)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [classId, subjectId, page]);

  const previewMaterial = data.items.find((item) => item.id === previewId);

  return (
    <div className={styles.page}>
      <Link to={`/courses/${classId}/${subjectId}`} className={styles.backLink}>
        <ArrowLeft size={16} /> Back to Subject
      </Link>

      <section className={styles.hero}>
        <div className={styles.heroIcon}>
          <BookOpen size={30} />
        </div>
        <div className={styles.heroText}>
          <span className={styles.eyebrow}>SCERT Study Materials</span>
          <h1 className={styles.title}>
            {subject?.name || 'Study Materials'} — PDF Library
          </h1>
          <p className={styles.subtitle}>
            {schoolClass?.title || `Class ${classId}`} · Official textbooks and reference PDFs
            uploaded by your administrators.
          </p>
        </div>
      </section>

      {error && (
        <div className={styles.errorBox} role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className={styles.stateBox}>
          <Loader2 size={28} className={styles.spin} />
          <span>Loading study materials…</span>
        </div>
      ) : data.items.length === 0 && !error ? (
        <div className={styles.stateBox}>
          <FileText size={34} />
          <strong>No PDFs uploaded yet</strong>
          <span>Your admin has not added study materials for this subject.</span>
        </div>
      ) : (
        <div className={styles.grid}>
          {data.items.map((material) => (
            <article key={material.id} className={styles.card}>
              <div className={styles.cardTop}>
                <div className={styles.pdfIcon}>
                  <FileText size={22} />
                </div>
                <span className={styles.pdfBadge}>PDF</span>
              </div>

              <h2 className={styles.cardTitle}>{material.title}</h2>
              <p className={styles.filename}>{material.originalFilename}</p>

              <div className={styles.meta}>
                <span>{formatFileSize(material.fileSize)}</span>
                <span>Uploaded {new Date(material.createdAt).toLocaleDateString()}</span>
              </div>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => window.open(buildStudentViewUrl(material.id), '_blank', 'noopener,noreferrer')}
                >
                  <ExternalLink size={15} /> View PDF
                </button>
                <a
                  className={styles.secondaryButton}
                  href={buildStudentViewUrl(material.id, { download: true })}
                  download
                >
                  <Download size={15} /> Download
                </a>
                <button
                  type="button"
                  className={styles.iconButton}
                  title="Preview in page"
                  aria-label={`Preview ${material.title}`}
                  onClick={() => setPreviewId(previewId === material.id ? null : material.id)}
                >
                  <Maximize2 size={16} />
                </button>
              </div>

              {previewId === material.id && previewMaterial && (
                <div className={styles.viewerWrap}>
                  <iframe
                    title={`${previewMaterial.title} PDF preview`}
                    src={buildStudentViewUrl(previewMaterial.id)}
                    className={styles.viewer}
                  />
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {data.pages > 1 && (
        <div className={styles.pagination}>
          <button
            type="button"
            className={styles.pageButton}
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            Previous
          </button>
          <span className={styles.pageLabel}>
            Page {page} of {data.pages}
          </span>
          <button
            type="button"
            className={styles.pageButton}
            disabled={page >= data.pages}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
};
