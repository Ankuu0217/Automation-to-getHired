import { Router } from 'express';
import mongoose from 'mongoose';
import {
  ErrorCodes,
  type ContactDetailResponse,
  type ContactResponse,
  type ContactsResponse,
} from '@jobmail/shared';
import { Application } from '../models/Application';
import { AppError } from '../middleware/error';
import { requireAuth } from '../middleware/auth';

/**
 * Recruiter contacts (Phase 4 mini-CRM). Read-only views derived entirely
 * from the user's Applications joined to their JobPosts — there is NO
 * Contact model. A "contact" is the recruiter address an application
 * actually targeted: Application.hrEmail, stamped from JobPost.hrEmail at
 * send time (services/jobs/sendEmail.ts), so drafts that were never sent
 * do not appear here.
 */
export const contactsRouter = Router();

contactsRouter.use(requireAuth);

/** Shape of one $group row coming back from the contacts aggregation. */
interface ContactRow {
  _id: string;
  names: (string | null)[];
  companies: (string | null)[];
  roles: (string | null)[];
  outreachCount: number;
  lastContactedAt: Date | null;
  anyReplied: boolean | null;
}

/** Distinct non-empty strings, alphabetized ($addToSet order is unstable). */
function cleanSet(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0))].sort();
}

/**
 * GET /contacts — every recruiter the user has applied to, grouped by the
 * targeted address. One aggregation pipeline + small JS shaping.
 */
contactsRouter.get('/', async (req, res, next) => {
  try {
    const rows = await Application.aggregate<ContactRow>([
      // Ownership scoping FIRST — aggregate() bypasses mongoose casting.
      { $match: { userId: new mongoose.Types.ObjectId(req.userId!) } },
      {
        $lookup: {
          from: 'jobposts',
          localField: 'jobPostId',
          foreignField: '_id',
          as: 'jobPost',
        },
      },
      { $unwind: { path: '$jobPost', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          // The Application snapshots hrName/company/role at send time; fall
          // back to the (possibly later-corrected) JobPost extraction.
          resolvedName: { $ifNull: ['$hrName', '$jobPost.extraction.hrName'] },
          resolvedCompany: { $ifNull: ['$company', '$jobPost.extraction.company'] },
          resolvedRole: { $ifNull: ['$role', '$jobPost.extraction.role'] },
          lastSentAt: { $max: '$emails.sentAt' },
          replied: {
            $anyElementTrue: [
              { $map: { input: '$emails', as: 'e', in: { $ne: ['$$e.repliedAt', null] } } },
            ],
          },
        },
      },
      // Most recent application first so `names` favors fresh data.
      { $sort: { updatedAt: -1 } },
      {
        $group: {
          _id: '$hrEmail',
          names: { $push: '$resolvedName' },
          companies: { $addToSet: '$resolvedCompany' },
          roles: { $addToSet: '$resolvedRole' },
          outreachCount: { $sum: 1 },
          lastContactedAt: { $max: '$lastSentAt' },
          anyReplied: { $max: '$replied' },
        },
      },
      // Desc sort naturally puts null lastContactedAt last (BSON null < Date).
      { $sort: { lastContactedAt: -1, _id: 1 } },
    ]);

    const contacts: ContactResponse[] = rows.map((row) => ({
      email: row._id,
      name: row.names.find((n): n is string => typeof n === 'string' && n.length > 0) ?? null,
      companies: cleanSet(row.companies),
      roles: cleanSet(row.roles),
      outreachCount: row.outreachCount,
      lastContactedAt: row.lastContactedAt ? row.lastContactedAt.toISOString() : null,
      anyReplied: row.anyReplied === true,
    }));

    const body: ContactsResponse = { contacts };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /contacts/:email — the full outreach history to one address.
 * Express URL-decodes route params already; we only normalize case.
 * Cross-user lookups are indistinguishable from never-contacted (404).
 */
contactsRouter.get('/:email', async (req, res, next) => {
  try {
    const email = req.params.email.trim().toLowerCase();
    const applications = await Application.find({ userId: req.userId!, hrEmail: email }).sort({
      createdAt: -1,
    });
    if (applications.length === 0) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, 'Contact not found');
    }

    const contact: ContactDetailResponse = {
      email,
      name: applications.map((a) => a.hrName).find((n) => n) ?? null,
      applications: applications.map((a) => ({
        id: String(a._id),
        company: a.company,
        role: a.role,
        stage: a.stage,
        emails: a.emails.map((e) => ({
          kind: e.kind,
          sentAt: e.sentAt?.toISOString() ?? null,
          openedAt: e.openedAt?.toISOString() ?? null,
          repliedAt: e.repliedAt?.toISOString() ?? null,
        })),
      })),
    };

    res.json({ contact });
  } catch (err) {
    next(err);
  }
});
