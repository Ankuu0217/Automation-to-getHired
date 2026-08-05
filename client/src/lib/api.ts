import type {
  ApiError,
  ApplicationDetailEnvelope,
  ApplicationListResponse,
  ApplicationUpdateInput,
  ContactDetailEnvelope,
  ContactsResponse,
  DraftUpdateInput,
  EmailTemplateCreateInput,
  EmailTemplateUpdateInput,
  ExtractionUpdateInput,
  FunnelAnalyticsResponse,
  GmailConnectResponse,
  GmailStatusResponse,
  ImportJobInput,
  JobPostResponse,
  JobPostSummary,
  LoginInput,
  MarkRepliedResponse,
  ProfileResponse,
  PublicUser,
  RegisterInput,
  ResponseTimeAnalyticsResponse,
  ResumeParseResponse,
  SendJobInput,
  SendJobResponse,
  TemplateAnalyticsResponse,
  TemplateDeletedResponse,
  TemplateEnvelope,
  TemplateListResponse,
  TimingAnalyticsResponse,
  ToneAnalyticsResponse,
  UpdateProfileInput,
  UpdateSettingsInput,
  UploadJobResponse,
} from '@jobmail/shared';

import { useAuthStore } from '@/stores/auth';

/**
 * API base URL. Defaults to the same-origin `/api/v1` path, which the Vite
 * dev server proxies to the backend (see vite.config.ts) so the httpOnly
 * auth cookies stay same-origin in development.
 */
const BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') || '/api/v1';

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Paths whose own 401 must NOT trigger a refresh attempt (would loop). */
const REFRESH_EXEMPT_PATHS = new Set(['/auth/login', '/auth/register', '/auth/refresh']);

interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** JSON-serializable payload, or FormData for multipart uploads. */
  body?: unknown;
}

let refreshPromise: Promise<boolean> | null = null;

/** Attempt exactly one token refresh; concurrent callers share the promise. */
function attemptRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then((res) => res.ok)
      .catch(() => false)
      .then((ok) => {
        refreshPromise = null;
        return ok;
      });
  }
  return refreshPromise;
}

function handleSessionExpired(): void {
  useAuthStore.getState().clear();
  const path = window.location.pathname;
  if (path !== '/login' && path !== '/register') {
    window.location.assign('/login');
  }
}

export async function api<T>(path: string, options: RequestOptions = {}, retried = false): Promise<T> {
  const { body, headers, ...rest } = options;
  const isFormData = body instanceof FormData;

  const res = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    credentials: 'include',
    headers: {
      // Never set Content-Type for FormData — the browser adds the multipart boundary.
      ...(body !== undefined && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
  });

  if (res.status === 401 && !retried && !REFRESH_EXEMPT_PATHS.has(path)) {
    const refreshed = await attemptRefresh();
    if (refreshed) {
      return api<T>(path, options, true);
    }
    handleSessionExpired();
  }

  if (!res.ok) {
    let code = 'UNKNOWN_ERROR';
    let message = `Request failed with status ${res.status}`;
    let details: unknown;
    try {
      const data = (await res.json()) as Partial<ApiError>;
      if (data?.error) {
        code = data.error.code ?? code;
        message = data.error.message ?? message;
        details = data.error.details;
      }
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new ApiRequestError(res.status, code, message, details);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

/* ── Typed endpoints ────────────────────────────────────────────── */

export function register(input: RegisterInput) {
  return api<{ user: PublicUser }>('/auth/register', { method: 'POST', body: input });
}

export function login(input: LoginInput) {
  return api<{ user: PublicUser }>('/auth/login', { method: 'POST', body: input });
}

export function logout() {
  return api<{ ok: true }>('/auth/logout', { method: 'POST' });
}

export function me() {
  return api<{ user: PublicUser }>('/auth/me');
}

export function updateSettings(input: UpdateSettingsInput) {
  return api<{ user: PublicUser }>('/auth/settings', { method: 'PATCH', body: input });
}

/** Danger zone — deletes the account and all data; the server clears cookies (204). */
export function deleteAccount() {
  return api<void>('/auth/account', { method: 'DELETE' });
}

export function getProfile() {
  return api<{ profile: ProfileResponse }>('/profile');
}

export function updateProfile(input: UpdateProfileInput) {
  return api<{ profile: ProfileResponse }>('/profile', { method: 'PUT', body: input });
}

export function uploadResume(file: File) {
  const formData = new FormData();
  formData.append('resume', file);
  return api<ResumeParseResponse>('/profile/resume', { method: 'POST', body: formData });
}

/** Authenticated same-origin PDF URL — usable directly as `<a href download>` (cookies ride along). */
export function downloadResumeUrl(): string {
  return `${BASE_URL}/profile/resume/download`;
}

/* ── Jobs (M2: screenshot upload → extraction review) ───────────── */

export function uploadJobScreenshot(file: File) {
  const formData = new FormData();
  formData.append('screenshot', file);
  return api<UploadJobResponse>('/jobs/upload', { method: 'POST', body: formData });
}

/** Pasted-JD import — same 202 { jobPostId } contract as the screenshot upload. */
export function importJob(input: ImportJobInput) {
  return api<UploadJobResponse>('/jobs/import', { method: 'POST', body: input });
}

export function getJob(id: string) {
  return api<{ job: JobPostResponse }>(`/jobs/${id}`);
}

export function listJobs() {
  return api<{ jobs: JobPostSummary[] }>('/jobs');
}

export function updateJobExtraction(id: string, input: ExtractionUpdateInput) {
  return api<{ job: JobPostResponse }>(`/jobs/${id}/extraction`, { method: 'PUT', body: input });
}

/** Authenticated same-origin image URL — usable directly as `<img src>`. */
export function jobScreenshotUrl(id: string) {
  return `${BASE_URL}/jobs/${id}/screenshot`;
}

/* ── M3: email generation, draft edits, send ────────────────────── */

export function generateJobEmail(id: string) {
  return api<{ job: JobPostResponse }>(`/jobs/${id}/generate-email`, { method: 'POST' });
}

/** Manual edit ({ subject?, bodyText? }) or tone regenerate ({ tone }). */
export function updateJobDraft(id: string, input: DraftUpdateInput) {
  return api<{ job: JobPostResponse }>(`/jobs/${id}/draft`, { method: 'PUT', body: input });
}

export function sendJob(id: string, input: SendJobInput = {}) {
  return api<SendJobResponse>(`/jobs/${id}/send`, { method: 'POST', body: input });
}

/* ── M3: Gmail OAuth ────────────────────────────────────────────── */

export function connectGmail() {
  return api<GmailConnectResponse>('/gmail/connect');
}

export function disconnectGmail() {
  return api<GmailStatusResponse>('/gmail/disconnect', { method: 'DELETE' });
}

/* ── M4: applications pipeline (Kanban + detail drawer) ─────────── */

export function listApplications() {
  return api<ApplicationListResponse>('/applications');
}

export function getApplication(id: string) {
  return api<ApplicationDetailEnvelope>(`/applications/${id}`);
}

/** Stage, notes and/or interview fields — at least one (enforced server-side). */
export function updateApplication(id: string, input: ApplicationUpdateInput) {
  return api<ApplicationDetailEnvelope>(`/applications/${id}`, { method: 'PATCH', body: input });
}

/** Manual reply marking — sets repliedAt, advances applied → hr_screen. */
export function markApplicationReplied(id: string) {
  return api<MarkRepliedResponse>(`/applications/${id}/mark-replied`, { method: 'POST' });
}

/* ── Phase 4: recruiter contacts (mini-CRM) ─────────────────────── */

export function getContacts() {
  return api<ContactsResponse>('/contacts');
}

export function getContact(email: string) {
  return api<ContactDetailEnvelope>(`/contacts/${encodeURIComponent(email)}`);
}

/* ── M5: outreach templates (CRUD + per-template stats) ─────────── */

export function listTemplates() {
  return api<TemplateListResponse>('/templates');
}

export function createTemplate(input: EmailTemplateCreateInput) {
  return api<TemplateEnvelope>('/templates', { method: 'POST', body: input });
}

export function updateTemplate(id: string, input: EmailTemplateUpdateInput) {
  return api<TemplateEnvelope>(`/templates/${id}`, { method: 'PUT', body: input });
}

/** Mark a template the default — the server unsets the user's other defaults. */
export function setDefaultTemplate(id: string) {
  return updateTemplate(id, { isDefault: true });
}

export function deleteTemplate(id: string) {
  return api<TemplateDeletedResponse>(`/templates/${id}`, { method: 'DELETE' });
}

/* ── M5: funnel analytics ───────────────────────────────────────── */

export function getFunnelAnalytics() {
  return api<FunnelAnalyticsResponse>('/analytics/funnel');
}

/* ── Phase 5: analytics upgrades ────────────────────────────────── */

/** Send hour-of-day vs open rate — all 24 slots + bestHour. */
export function getTimingAnalytics() {
  return api<TimingAnalyticsResponse>('/analytics/timing');
}

/** Per-template sends/opens/replies aggregated from application data. */
export function getTemplateAnalytics() {
  return api<TemplateAnalyticsResponse>('/analytics/by-template');
}

/** Reply rate by template tone. */
export function getToneAnalytics() {
  return api<ToneAnalyticsResponse>('/analytics/by-tone');
}

/** sentAt → repliedAt latency histogram + median hours. */
export function getResponseTimeAnalytics() {
  return api<ResponseTimeAnalyticsResponse>('/analytics/response-time');
}
