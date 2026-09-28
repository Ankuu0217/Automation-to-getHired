import { env } from '../config/env';
import { concurrencyGate } from './rateLimit';

/** One process-wide gate shared by every multipart upload route (resume + screenshots). */
export const uploadGate = concurrencyGate(env.UPLOAD_CONCURRENCY);
