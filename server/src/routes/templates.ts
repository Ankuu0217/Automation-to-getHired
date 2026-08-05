import { Router } from 'express';
import mongoose from 'mongoose';
import {
  emailTemplateCreateSchema,
  emailTemplateUpdateSchema,
  ErrorCodes,
  type EmailTemplateCreateInput,
  type EmailTemplateResponse,
  type EmailTemplateUpdateInput,
  type TemplateDeletedResponse,
  type TemplateEnvelope,
  type TemplateListResponse,
} from '@jobmail/shared';
import { EmailTemplate, type IEmailTemplate } from '../models/EmailTemplate';
import { AppError } from '../middleware/error';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';

/**
 * Templates API (SPEC §6) — CRUD for outreach templates with per-template
 * stats. Invariant: at most one default per user — setting isDefault unsets
 * the user's other templates first.
 */
export const templatesRouter = Router();

templatesRouter.use(requireAuth);

function toDto(template: IEmailTemplate): EmailTemplateResponse {
  return {
    id: String(template._id),
    name: template.name,
    tone: template.tone,
    subjectTemplate: template.subjectTemplate,
    bodyTemplate: template.bodyTemplate,
    isDefault: template.isDefault,
    stats: {
      sent: template.stats.sent,
      opened: template.stats.opened,
      replied: template.stats.replied,
    },
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}

/** Ownership-scoped lookup; cross-user access is indistinguishable from missing. */
async function findOwnTemplate(userId: string, id: string): Promise<IEmailTemplate> {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError(404, ErrorCodes.NOT_FOUND, 'Template not found');
  }
  const template = await EmailTemplate.findOne({ _id: id, userId });
  if (!template) throw new AppError(404, ErrorCodes.NOT_FOUND, 'Template not found');
  return template;
}

/** Single-default invariant: clear the flag on all of the user's templates. */
async function unsetOtherDefaults(userId: string, exceptId?: mongoose.Types.ObjectId): Promise<void> {
  await EmailTemplate.updateMany(
    { userId, isDefault: true, ...(exceptId ? { _id: { $ne: exceptId } } : {}) },
    { $set: { isDefault: false } },
  );
}

/** GET /templates — list with stats, default first then newest. */
templatesRouter.get('/', async (req, res, next) => {
  try {
    const templates = await EmailTemplate.find({ userId: req.userId! }).sort({
      isDefault: -1,
      createdAt: -1,
    });
    const body: TemplateListResponse = { templates: templates.map(toDto) };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

/** POST /templates — create; isDefault unsets the previous default. */
templatesRouter.post('/', validate(emailTemplateCreateSchema), async (req, res, next) => {
  try {
    const input = req.body as EmailTemplateCreateInput;
    if (input.isDefault) await unsetOtherDefaults(req.userId!);
    const template = await EmailTemplate.create({ userId: req.userId!, ...input });
    const body: TemplateEnvelope = { template: toDto(template) };
    res.status(201).json(body);
  } catch (err) {
    next(err);
  }
});

/** PUT /templates/:id — update fields; isDefault: true unsets other defaults. */
templatesRouter.put('/:id', validate(emailTemplateUpdateSchema), async (req, res, next) => {
  try {
    const template = await findOwnTemplate(req.userId!, req.params.id);
    const input = req.body as EmailTemplateUpdateInput;

    if (input.isDefault === true) await unsetOtherDefaults(req.userId!, template._id);

    if (input.name !== undefined) template.name = input.name;
    if (input.tone !== undefined) template.tone = input.tone;
    if (input.subjectTemplate !== undefined) template.subjectTemplate = input.subjectTemplate;
    if (input.bodyTemplate !== undefined) template.bodyTemplate = input.bodyTemplate;
    if (input.isDefault !== undefined) template.isDefault = input.isDefault;
    await template.save();

    const body: TemplateEnvelope = { template: toDto(template) };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

/** DELETE /templates/:id — remove (stats history goes with it). */
templatesRouter.delete('/:id', async (req, res, next) => {
  try {
    const template = await findOwnTemplate(req.userId!, req.params.id);
    await template.deleteOne();
    const body: TemplateDeletedResponse = { deleted: true };
    res.json(body);
  } catch (err) {
    next(err);
  }
});
