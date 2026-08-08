import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const API_KEY  = import.meta.env.VITE_API_KEY || 'dev-key';

const client = axios.create({
  baseURL: API_BASE,
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY,
  },
});

// Response interceptor for error logging
client.interceptors.response.use(
  (res) => res,
  (err) => {
    console.error('[API Error]', err.response?.status || err.message, err.config?.url, err.response?.data || err);
    return Promise.reject(err);
  }
);

// ── Graph API ──
export const graphAPI = {
  getNodes:         (skip = 0, limit = 500) => client.get(`/graph/nodes?skip=${skip}&limit=${limit}`),
  getNeighbourhood: (id, hops = 2)          => client.get(`/graph/neighbourhood/${id}?hops=${hops}`),
  getStats:         ()                      => client.get('/graph/stats'),
  createConcept:    (data)                  => client.post('/graph/concept', data),
  updateConcept:    (id, data)              => client.put(`/graph/concept/${id}`, data),
  deleteConcept:    (id)                    => client.delete(`/graph/concept/${id}`),
  deleteSource:     (url)                   => client.delete(`/graph/source?source_url=${encodeURIComponent(url)}`),
  exportJSON:       ()                      => client.get('/graph/export/json', { responseType: 'blob' }),
};

// ── Ingest API ──
export const ingestAPI = {
  url:     (data) => client.post('/ingest/url', data),
  youtube: (data) => client.post('/ingest/youtube', data),
  text:    (data) => client.post('/ingest/text', data),
  pdf:     (file) => {
    const form = new FormData();
    form.append('file', file);
    return client.post('/ingest/pdf', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  voice:   (file) => {
    const form = new FormData();
    form.append('file', file);
    return client.post('/ingest/voice', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};

// ── Chat API ──
export const chatAPI = {
  send: (query, sessionId) => client.post('/chat', { query, session_id: sessionId }),
};

// ── Memory API ──
export const memoryAPI = {
  getAlerts:  (threshold = 0.7) => client.get(`/memory/alerts?threshold=${threshold}`),
  review:     (conceptId)       => client.post(`/memory/review/${conceptId}`),
};

// ── Digest API ──
export const digestAPI = {
  getToday:   ()          => client.get('/digest/today'),
  getHistory: (days = 30) => client.get(`/digest/history?days=${days}`),
};

// ── Pipeline API ──
export const pipelineAPI = {
  getStatus: () => client.get('/pipeline/status'),
  trigger:   () => client.post('/pipeline/trigger'),
};

// ── Gap Analysis API ──
export const gapAPI = {
  analyse: (jobDescription) => client.post('/gaps', { job_description: jobDescription }),
};

// ── Report API ──
export const reportAPI = {
  getWeeklyReport: () => client.get('/report/weekly', { responseType: 'blob' }),
};

// ── Playground API ──
export const playgroundAPI = {
  getPrompts: () => client.get('/playground/prompts'),
  savePrompt: (type, prompt) => client.post('/playground/prompts', { type, prompt }),
  testPrompt: (prompt, sampleText) => client.post('/playground', { prompt, sample_text: sampleText }),
};

export default client;
