import { Router } from 'express';
import multer from 'multer';
import {
  ErrorCodes,
  profileUpdateSchema,
  type ProfileResponse,
  type ResumeFileMeta,
  type ResumeParseResponse,
} from '@jobmail/shared';
import { Profile, type IProfile } from '../models/Profile';
import { AppError } from '../middleware/error';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { uploadLimiter } from '../middleware/rateLimit';
import { uploadGate } from '../middleware/uploadGate';
import { parseResumePdf } from '../services/resumeParser';
import { getFile, putFile, removeFile, StorageNotFoundError } from '../services/storage';

export const profileRouter = Router();

profileRouter.use(requireAuth);

// PDF magic bytes: %PDF-
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);

// Memory storage: the PDF is sniffed + parsed from RAM and then written once
// to the storage layer (ImageKit or local disk) — never to a temp file.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    // First gate: declared MIME type. Real sniffing happens on the saved file.
    if (file.mimetype !== 'application/pdf') {
      cb(new AppError(400, ErrorCodes.BAD_REQUEST, 'Only PDF files are accepted'));
      return;
    }
    cb(null, true);
  },
});

function resumeFileMeta(profile: IProfile): ResumeFileMeta | null {
  if (!profile.resumeFile) return null;
  return {
    originalName: profile.resumeFile.originalName,
    uploadedAt: profile.resumeFile.uploadedAt.toISOString(),
    parsedText: profile.resumeFile.parsedText,
  };
}

function toDto(profile: IProfile): ProfileResponse {
  return {
    fullName: profile.fullName,
    headline: profile.headline,
    phone: profile.phone,
    location: profile.location,
    yearsExp: profile.yearsExp,
    skills: profile.skills,
    links: {
      linkedin: profile.links.linkedin,
      github: profile.links.github,
      portfolio: profile.links.portfolio,
    },
    summary: profile.summary,
    signature: profile.signature,
    resumeFile: resumeFileMeta(profile),
    preferredRoles: profile.preferredRoles,
    noticePeriod: profile.noticePeriod,
    currentCTC: profile.currentCTC,
    expectedCTC: profile.expectedCTC,
  };
}

async function getOrCreateProfile(userId: string): Promise<IProfile> {
  const existing = await Profile.findOne({ userId });
  if (existing) return existing;
  return Profile.create({ userId });
}

profileRouter.get('/', async (req, res, next) => {
  try {
    const profile = await getOrCreateProfile(req.userId!);
    res.json({ profile: toDto(profile) });
  } catch (err) {
    next(err);
  }
});

profileRouter.put('/', validate(profileUpdateSchema), async (req, res, next) => {
  try {
    const profile = await getOrCreateProfile(req.userId!);
    const body = req.body as Record<string, unknown>;
    for (const [key, value] of Object.entries(body)) {
      if (key === 'links' && value && typeof value === 'object') {
        profile.links = { ...profile.links, ...(value as IProfile['links']) };
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (profile as any)[key] = value;
      }
    }
    await profile.save();
    res.json({ profile: toDto(profile) });
  } catch (err) {
    next(err);
  }
});

/**
 * Authenticated resume download — streams the stored PDF back to its owner
 * (mirrors the screenshot streaming route in routes/jobs.ts). No resume on
 * the profile, or a file gone from disk, are both a 404 RESUME_NOT_FOUND.
 */
profileRouter.get('/resume/download', async (req, res, next) => {
  try {
    const profile = await Profile.findOne({ userId: req.userId });
    const resumeFile = profile?.resumeFile;
    if (!resumeFile) {
      throw new AppError(404, ErrorCodes.RESUME_NOT_FOUND, 'No resume uploaded');
    }
    let file: Buffer;
    try {
      file = await getFile(resumeFile.path);
    } catch (err) {
      if (err instanceof StorageNotFoundError) {
        throw new AppError(404, ErrorCodes.RESUME_NOT_FOUND, 'Resume file not found');
      }
      throw err;
    }
    // Header-safe filename: printable ASCII only, no quotes/backslashes/CRLF.
    const safeName =
      resumeFile.originalName
        .replace(/[^\x20-\x7e]/g, '')
        .replace(/["\\]/g, '')
        .trim() || 'resume.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Length', String(file.length));
    res.end(file);
  } catch (err) {
    next(err);
  }
});

/**
 * Resume upload: PDF only, 10 MB cap, magic-byte sniffed. Parses the PDF,
 * stores text on the profile, and returns naive prefill suggestions
 * (skills / summary / name / email / phone) so the UI can preview them.
 */
profileRouter.post('/resume', uploadLimiter, uploadGate, upload.single('resume'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError(400, ErrorCodes.BAD_REQUEST, 'No file uploaded (field: resume)');
    const buffer = req.file.buffer;

    // MIME sniff: verify PDF magic bytes, not just the declared type (spec §8).
    if (buffer.length < 5 || !buffer.subarray(0, 5).equals(PDF_MAGIC)) {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, 'File is not a valid PDF');
    }

    let parsed;
    try {
      parsed = await parseResumePdf(buffer);
    } catch {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, 'Could not extract text from this PDF');
    }

    // Only persist the file once it has proven to be a parseable PDF.
    const storageKey = await putFile(buffer, {
      kind: 'resumes',
      userId: req.userId!,
      fileName: req.file.originalname.toLowerCase().endsWith('.pdf')
        ? req.file.originalname
        : `${req.file.originalname}.pdf`,
      mimeType: 'application/pdf',
    });

    const profile = await getOrCreateProfile(req.userId!);
    const previousKey = profile.resumeFile?.path ?? null;
    profile.resumeFile = {
      path: storageKey,
      originalName: req.file.originalname,
      parsedText: parsed.text,
      uploadedAt: new Date(),
    };
    try {
      await profile.save();
    } catch (err) {
      await removeFile(storageKey); // don't orphan the upload
      throw err;
    }
    // Remove the replaced resume only after the new one is safely referenced.
    if (previousKey && previousKey !== storageKey) void removeFile(previousKey);

    const result: ResumeParseResponse = {
      profile: toDto(profile),
      resumeFile: resumeFileMeta(profile)!,
      prefill: parsed.prefill,
    };
    res.json(result);
  } catch (err) {
    next(err);
  }
});
