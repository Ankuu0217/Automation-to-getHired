import mongoose, { Schema, type Document, type Types } from 'mongoose';

export interface IProfile extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  fullName: string;
  headline: string;
  phone: string;
  location: string;
  yearsExp: number | null;
  skills: string[];
  links: { linkedin: string; github: string; portfolio: string };
  summary: string;
  signature: string;
  resumeFile: {
    path: string;
    originalName: string;
    parsedText: string;
    uploadedAt: Date;
  } | null;
  preferredRoles: string[];
  noticePeriod: string;
  currentCTC: string;
  expectedCTC: string;
  createdAt: Date;
  updatedAt: Date;
}

const profileSchema = new Schema<IProfile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    fullName: { type: String, default: '' },
    headline: { type: String, default: '' },
    phone: { type: String, default: '' },
    location: { type: String, default: '' },
    yearsExp: { type: Number, default: null, min: 0, max: 60 },
    skills: { type: [String], default: [] },
    links: {
      linkedin: { type: String, default: '' },
      github: { type: String, default: '' },
      portfolio: { type: String, default: '' },
    },
    summary: { type: String, default: '' },
    signature: { type: String, default: '' },
    resumeFile: {
      type: new Schema(
        {
          path: { type: String, required: true },
          originalName: { type: String, required: true },
          parsedText: { type: String, default: '' },
          uploadedAt: { type: Date, default: Date.now },
        },
        { _id: false },
      ),
      default: null,
    },
    preferredRoles: { type: [String], default: [] },
    noticePeriod: { type: String, default: '' },
    currentCTC: { type: String, default: '' },
    expectedCTC: { type: String, default: '' },
  },
  { timestamps: true },
);

export const Profile =
  (mongoose.models.Profile as mongoose.Model<IProfile>) ??
  mongoose.model<IProfile>('Profile', profileSchema);
