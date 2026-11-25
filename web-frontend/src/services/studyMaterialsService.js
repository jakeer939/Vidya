import axios from 'axios';
import { API_BASE_URL, extractErrorMessage } from '../lib/apiClient';
import { storage } from '../lib/storage';

const ADMIN_TOKEN_KEY = 'vidya_admin_token';
const ADMIN_API = '/api/v1/admin';

/**
 * Admin calls use a small dedicated client: the student client would try to
 * refresh a JWT and redirect to /login on 401, which is wrong for admin tokens.
 */
const adminClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: { Accept: 'application/json' },
});

export const getAdminToken = () => sessionStorage.getItem(ADMIN_TOKEN_KEY) || '';
export const setAdminToken = (token) => {
  const value = String(token || '').trim();
  if (value) sessionStorage.setItem(ADMIN_TOKEN_KEY, value);
  else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
};

const adminHeaders = () => ({ 'x-admin-token': getAdminToken() });

export const getAdminClasses = async () => {
  const res = await adminClient.get(`${ADMIN_API}/classes`, { headers: adminHeaders() });
  return res.data;
};

export const getAdminSubjects = async (classId) => {
  const res = await adminClient.get(`${ADMIN_API}/classes/${encodeURIComponent(classId)}/subjects`, {
    headers: adminHeaders(),
  });
  return res.data;
};

export const getAdminMaterials = async (params) => {
  const res = await adminClient.get(`${ADMIN_API}/study-materials`, {
    headers: adminHeaders(),
    params,
  });
  return res.data;
};

export const uploadStudyMaterial = async ({ classId, subjectId, title, file, onProgress }) => {
  const form = new FormData();
  form.append('class_id', classId);
  form.append('subject_id', subjectId);
  form.append('title', title);
  form.append('file', file);

  const res = await adminClient.post(`${ADMIN_API}/study-materials`, form, {
    headers: { ...adminHeaders(), 'Content-Type': 'multipart/form-data' },
    timeout: 0,
    onUploadProgress: (event) => {
      if (!onProgress || !event.total) return;
      onProgress(Math.min(100, Math.round((event.loaded * 100) / event.total)));
    },
  });
  return res.data;
};

export const updateStudyMaterial = async (id, payload) => {
  const res = await adminClient.patch(`${ADMIN_API}/study-materials/${encodeURIComponent(id)}`, payload, {
    headers: adminHeaders(),
  });
  return res.data;
};

export const deleteStudyMaterial = async (id) => {
  await adminClient.delete(`${ADMIN_API}/study-materials/${encodeURIComponent(id)}`, {
    headers: adminHeaders(),
  });
};

export const getStudentMaterials = async (classId, subjectId, params) => {
  const res = await axios.get(
    `${API_BASE_URL}/api/v1/classes/${encodeURIComponent(classId)}/subjects/${encodeURIComponent(subjectId)}/materials`,
    {
      params,
      headers: { Authorization: `Bearer ${storage.getAccessToken()}` },
    }
  );
  return res.data;
};

/** The browser PDF viewer needs a URL; a short-lived JWT is passed in the query. */
export const buildStudentViewUrl = (id, { download = false } = {}) => {
  const params = new URLSearchParams();
  const token = storage.getAccessToken();
  if (token) params.set('access_token', token);
  if (download) params.set('download', '1');
  const query = params.toString();
  return `${API_BASE_URL}/api/v1/study-materials/${encodeURIComponent(id)}/view${query ? `?${query}` : ''}`;
};

export const buildAdminViewUrl = (id) =>
  `${API_BASE_URL}/api/v1/study-materials/${encodeURIComponent(id)}/view?admin_token=${encodeURIComponent(getAdminToken())}`;

export { extractErrorMessage };
