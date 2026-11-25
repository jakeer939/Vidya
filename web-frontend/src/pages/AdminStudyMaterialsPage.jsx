import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  FileText,
  FileUp,
  Loader2,
  Pencil,
  Search,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { formatFileSize } from '../lib/format';
import {
  buildAdminViewUrl,
  deleteStudyMaterial,
  extractErrorMessage,
  getAdminClasses,
  getAdminMaterials,
  getAdminSubjects,
  getAdminToken,
  setAdminToken,
  updateStudyMaterial,
  uploadStudyMaterial,
} from '../services/studyMaterialsService';
import styles from './AdminStudyMaterialsPage.css';

const PAGE_SIZE = 10;
const MAX_FILE_BYTES =
  Number(import.meta.env.VITE_MAX_PDF_SIZE_MB || 50) * 1024 * 1024;
const EMPTY_LIST = { items: [], total: 0, page: 1, pages: 1 };

export const AdminStudyMaterialsPage = () => {
  const [tokenInput, setTokenInput] = useState(() => getAdminToken());
  const [token, setToken] = useState(() => getAdminToken());

  const [classes, setClasses] = useState([]);
  const [uploadSubjects, setUploadSubjects] = useState([]);
  const [filterSubjects, setFilterSubjects] = useState([]);
  const [form, setForm] = useState({ classId: '', subjectId: '', title: '', file: null });
  const [fileInputKey, setFileInputKey] = useState(0);

  const [notice, setNotice] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const uploadingRef = useRef(false);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ classId: '', subjectId: '', page: 1 });
  const [list, setList] = useState(EMPTY_LIST);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  const [editing, setEditing] = useState(null);
  const [editSubjects, setEditSubjects] = useState([]);
  const [savingEdit, setSavingEdit] = useState(false);

  const showNotice = useCallback((type, message) => {
    setNotice({ type, message });
    if (message) window.setTimeout(() => setNotice(null), 5000);
  }, []);

  // ---- connected data ----------------------------------------------------
  useEffect(() => {
    if (!token) {
      setClasses([]);
      setList(EMPTY_LIST);
      return undefined;
    }
    let active = true;
    getAdminClasses()
      .then((rows) => active && setClasses(rows || []))
      .catch((err) => active && showNotice('error', extractErrorMessage(err)));
    return () => {
      active = false;
    };
  }, [token, showNotice]);

  useEffect(() => {
    if (!token || !form.classId) {
      setUploadSubjects([]);
      return undefined;
    }
    let active = true;
    getAdminSubjects(form.classId)
      .then((rows) => active && setUploadSubjects(rows || []))
      .catch((err) => active && showNotice('error', extractErrorMessage(err)));
    return () => {
      active = false;
    };
  }, [token, form.classId, showNotice]);

  useEffect(() => {
    if (!token || !filters.classId) {
      setFilterSubjects([]);
      return undefined;
    }
    let active = true;
    getAdminSubjects(filters.classId)
      .then((rows) => active && setFilterSubjects(rows || []))
      .catch(() => active && setFilterSubjects([]));
    return () => {
      active = false;
    };
  }, [token, filters.classId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setFilters((prev) => ({ ...prev, page: 1 }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!token) return undefined;
    let active = true;
    setListLoading(true);
    setListError('');
    getAdminMaterials({
      class_id: filters.classId || undefined,
      subject_id: filters.subjectId || undefined,
      search: search || undefined,
      page: filters.page,
      limit: PAGE_SIZE,
    })
      .then((data) => active && setList(data || EMPTY_LIST))
      .catch((err) => active && setListError(extractErrorMessage(err)))
      .finally(() => active && setListLoading(false));
    return () => {
      active = false;
    };
  }, [token, filters.classId, filters.subjectId, filters.page, search, refreshKey]);

  useEffect(() => {
    if (!editing || !editing.classId) {
      setEditSubjects([]);
      return undefined;
    }
    let active = true;
    getAdminSubjects(editing.classId)
      .then((rows) => active && setEditSubjects(rows || []))
      .catch(() => active && setEditSubjects([]));
    return () => {
      active = false;
    };
  }, [editing?.classId]);

  // ---- actions -----------------------------------------------------------
  const handleConnect = () => {
    const value = tokenInput.trim();
    if (!value) {
      showNotice('error', 'Enter the admin access token to continue.');
      return;
    }
    setAdminToken(value);
    setToken(value);
    showNotice('success', 'Admin session connected.');
  };

  const handleUpload = async (event) => {
    event.preventDefault();
    if (uploadingRef.current) return;

    if (!form.classId || !form.subjectId || !form.title.trim() || !form.file) {
      showNotice('error', 'Select a class, subject, title and PDF file.');
      return;
    }
    const isPdf =
      form.file.type === 'application/pdf' ||
      form.file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      showNotice('error', 'Please choose a PDF file.');
      return;
    }
    if (form.file.size > MAX_FILE_BYTES) {
      showNotice('error', `File is too large (max ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)} MB).`);
      return;
    }

    uploadingRef.current = true;
    setUploading(true);
    setProgress(0);
    try {
      await uploadStudyMaterial({
        classId: form.classId,
        subjectId: form.subjectId,
        title: form.title.trim(),
        file: form.file,
        onProgress: setProgress,
      });
      setForm({ classId: '', subjectId: '', title: '', file: null });
      setFileInputKey((key) => key + 1);
      setProgress(0);
      setFilters((prev) => ({ ...prev, page: 1 }));
      setRefreshKey((key) => key + 1);
      showNotice('success', 'PDF uploaded successfully.');
    } catch (err) {
      showNotice('error', extractErrorMessage(err));
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  };

  const handleDelete = async (material) => {
    if (!window.confirm(`Delete "${material.title}"? This removes the PDF file permanently.`)) return;
    try {
      await deleteStudyMaterial(material.id);
      setRefreshKey((key) => key + 1);
      showNotice('success', 'Study material deleted.');
    } catch (err) {
      showNotice('error', extractErrorMessage(err));
    }
  };

  const handleSaveEdit = async () => {
    if (!editing || savingEdit) return;
    setSavingEdit(true);
    try {
      await updateStudyMaterial(editing.id, {
        title: editing.title.trim(),
        subject_id: editing.subjectId,
        is_active: editing.isActive,
      });
      setEditing(null);
      setRefreshKey((key) => key + 1);
      showNotice('success', 'Study material updated.');
    } catch (err) {
      showNotice('error', extractErrorMessage(err));
    } finally {
      setSavingEdit(false);
    }
  };

  const pageNumbers = useMemo(() => {
    const total = list.pages || 1;
    return Array.from({ length: Math.min(total, 5) }, (_, index) => {
      const start = Math.max(1, Math.min((list.page || 1) - 2, total - 4));
      return start + index;
    }).filter((page) => page <= total);
  }, [list.page, list.pages]);

  return (
    <div className={styles.page}>
      <section className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Vidya Admin</span>
          <h1 className={styles.title}>Study Materials Management</h1>
          <p className={styles.subtitle}>
            Upload, organise and manage PDF textbooks for every class and subject.
          </p>
        </div>
        <div className={styles.adminTokenBox}>
          <label className={styles.tokenLabel} htmlFor="admin-token">
            Admin access token
          </label>
          <div className={styles.tokenRow}>
            <input
              id="admin-token"
              type="password"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="x-admin-token"
              className={styles.input}
              autoComplete="off"
            />
            <button type="button" className={styles.secondaryButton} onClick={handleConnect}>
              {token ? 'Update' : 'Connect'}
            </button>
          </div>
        </div>
      </section>

      {notice && (
        <div
          className={`${styles.notice} ${notice.type === 'error' ? styles.noticeError : styles.noticeSuccess}`}
          role="alert"
        >
          {notice.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          <span>{notice.message}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notification">
            <X size={16} />
          </button>
        </div>
      )}

      {!token && (
        <div className={styles.connectCallout}>
          <AlertCircle size={20} />
          <span>
            Enter the admin access token (ADMIN_TOKEN) above to load classes and manage PDFs.
          </span>
        </div>
      )}

      <div className={styles.layout}>
        {/* ------------------------------- upload card ---------------------- */}
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.iconBadge}>
              <UploadCloud size={20} />
            </div>
            <div>
              <h2 className={styles.cardTitle}>Upload PDF</h2>
              <p className={styles.cardSubtitle}>Files are stored securely with UUID names.</p>
            </div>
          </div>

          <form onSubmit={handleUpload} className={styles.form}>
            <label className={styles.field}>
              <span className={styles.label}>Class</span>
              <select
                className={styles.select}
                value={form.classId}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, classId: event.target.value, subjectId: '' }))
                }
                disabled={!token || uploading}
              >
                <option value="">Select a class</option>
                {classes.map((item) => (
                  <option key={item.id} value={item.id}>
                    Class {item.grade} — {item.title}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Subject</span>
              <select
                className={styles.select}
                value={form.subjectId}
                onChange={(event) => setForm((prev) => ({ ...prev, subjectId: event.target.value }))}
                disabled={!form.classId || uploading}
              >
                <option value="">Select a subject</option>
                {uploadSubjects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Display title</span>
              <input
                className={styles.input}
                type="text"
                maxLength={255}
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="e.g. Class 6 Mathematics Textbook"
                disabled={uploading}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>PDF file</span>
              <input
                key={fileInputKey}
                className={styles.fileInput}
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, file: event.target.files?.[0] || null }))
                }
                disabled={uploading}
              />
            </label>

            {form.file && (
              <div className={styles.selectedFile}>
                <FileText size={16} />
                <div>
                  <strong>{form.file.name}</strong>
                  <span>{formatFileSize(form.file.size)}</span>
                </div>
              </div>
            )}

            {uploading && (
              <div className={styles.progressBlock}>
                <div className={styles.progressTrack}>
                  <div className={styles.progressBar} style={{ width: `${progress}%` }} />
                </div>
                <span className={styles.progressLabel}>Uploading… {progress}%</span>
              </div>
            )}

            <button
              type="submit"
              className={styles.primaryButton}
              disabled={uploading || !token}
            >
              {uploading ? <Loader2 size={17} className={styles.spin} /> : <FileUp size={17} />}
              {uploading ? 'Uploading PDF…' : 'Upload PDF'}
            </button>
            <p className={styles.helperText}>
              Maximum {Math.floor(MAX_FILE_BYTES / 1024 / 1024)} MB. Backend validation is authoritative.
            </p>
          </form>
        </section>

        {/* ------------------------------- listing -------------------------- */}
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.iconBadge}>
              <FileText size={20} />
            </div>
            <div>
              <h2 className={styles.cardTitle}>Uploaded Materials</h2>
              <p className={styles.cardSubtitle}>
                {list.total} PDF{list.total === 1 ? '' : 's'} in the library
              </p>
            </div>
          </div>

          <div className={styles.filters}>
            <div className={styles.searchBox}>
              <Search size={16} />
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search title or filename"
                className={styles.searchInput}
              />
            </div>
            <select
              className={styles.select}
              value={filters.classId}
              onChange={(event) =>
                setFilters({ classId: event.target.value, subjectId: '', page: 1 })
              }
            >
              <option value="">All classes</option>
              {classes.map((item) => (
                <option key={item.id} value={item.id}>
                  Class {item.grade}
                </option>
              ))}
            </select>
            <select
              className={styles.select}
              value={filters.subjectId}
              onChange={(event) => setFilters((prev) => ({ ...prev, subjectId: event.target.value, page: 1 }))}
              disabled={!filters.classId}
            >
              <option value="">All subjects</option>
              {filterSubjects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          {listError && (
            <div className={styles.inlineError} role="alert">
              <AlertCircle size={17} /> {listError}
            </div>
          )}

          {listLoading ? (
            <div className={styles.stateBox}>
              <Loader2 size={26} className={styles.spin} />
              <span>Loading study materials…</span>
            </div>
          ) : list.items.length === 0 ? (
            <div className={styles.stateBox}>
              <FileText size={30} />
              <strong>No study materials found</strong>
              <span>Upload a PDF or adjust the filters above.</span>
            </div>
          ) : (
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Class / Subject</th>
                    <th>Original file</th>
                    <th>Size</th>
                    <th>Uploaded</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Title">
                        <strong>{item.title}</strong>
                        <span className={styles.cellSub}>UUID {item.id.slice(0, 8)}…</span>
                      </td>
                      <td data-label="Class / Subject">
                        Class {item.grade}
                        <span className={styles.cellSub}>{item.subjectName}</span>
                      </td>
                      <td data-label="Original file">
                        <span className={styles.filename}>{item.originalFilename}</span>
                      </td>
                      <td data-label="Size">{formatFileSize(item.fileSize)}</td>
                      <td data-label="Uploaded">
                        {new Date(item.createdAt).toLocaleDateString()}
                        <span className={styles.cellSub}>
                          {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </td>
                      <td data-label="Status">
                        <span className={item.isActive ? styles.activePill : styles.inactivePill}>
                          {item.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td data-label="Actions">
                        <div className={styles.actions}>
                          <button
                            type="button"
                            className={styles.iconButton}
                            title="View PDF"
                            aria-label={`View ${item.title}`}
                            onClick={() => window.open(buildAdminViewUrl(item.id), '_blank', 'noopener,noreferrer')}
                          >
                            <Eye size={16} />
                          </button>
                          <button
                            type="button"
                            className={styles.iconButton}
                            title="Edit metadata"
                            aria-label={`Edit ${item.title}`}
                            onClick={() =>
                              setEditing({
                                id: item.id,
                                title: item.title,
                                subjectId: item.subjectId,
                                classId: item.classId,
                                isActive: item.isActive,
                              })
                            }
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            type="button"
                            className={`${styles.iconButton} ${styles.deleteButton}`}
                            title="Delete PDF"
                            aria-label={`Delete ${item.title}`}
                            onClick={() => handleDelete(item)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {list.pages > 1 && (
            <div className={styles.pagination}>
              <button
                type="button"
                className={styles.pageButton}
                disabled={filters.page <= 1}
                onClick={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}
              >
                Previous
              </button>
              {pageNumbers.map((page) => (
                <button
                  key={page}
                  type="button"
                  className={`${styles.pageButton} ${page === list.page ? styles.pageButtonActive : ''}`}
                  onClick={() => setFilters((prev) => ({ ...prev, page }))}
                >
                  {page}
                </button>
              ))}
              <button
                type="button"
                className={styles.pageButton}
                disabled={filters.page >= list.pages}
                onClick={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}
              >
                Next
              </button>
            </div>
          )}
        </section>
      </div>

      {/* ------------------------------- edit dialog ----------------------- */}
      {editing && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => setEditing(null)}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-label="Edit study material"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h2>Edit Study Material</h2>
              <button type="button" onClick={() => setEditing(null)} aria-label="Close dialog">
                <X size={18} />
              </button>
            </div>
            <label className={styles.field}>
              <span className={styles.label}>Title</span>
              <input
                className={styles.input}
                value={editing.title}
                maxLength={255}
                onChange={(event) => setEditing((prev) => ({ ...prev, title: event.target.value }))}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Subject</span>
              <select
                className={styles.select}
                value={editing.subjectId}
                onChange={(event) => setEditing((prev) => ({ ...prev, subjectId: event.target.value }))}
              >
                {editSubjects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.switchRow}>
              <input
                type="checkbox"
                checked={editing.isActive}
                onChange={(event) => setEditing((prev) => ({ ...prev, isActive: event.target.checked }))}
              />
              <span>Available to students</span>
            </label>
            <div className={styles.modalActions}>
              <button type="button" className={styles.secondaryButton} onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={handleSaveEdit}
                disabled={savingEdit || !editing.title.trim() || !editing.subjectId}
              >
                {savingEdit ? <Loader2 size={16} className={styles.spin} /> : <CheckCircle2 size={16} />}
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
