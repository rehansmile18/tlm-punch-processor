import { Schema, model, Types } from "mongoose";

export interface SiteDoc {
  _id: Types.ObjectId;
  siteId: string; // external reference id used as Assignment targetType=LOCATION's targetIds value in TLM
  clientId: Types.ObjectId;
  name: string;
  timezone: string; // fallback when a punch omits its own timezone
  createdAt: Date;
  updatedAt: Date;
}

const siteSchema = new Schema<SiteDoc>(
  {
    siteId: { type: String, required: true, trim: true },
    clientId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true },
    timezone: { type: String, required: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: "sites" }
);

siteSchema.index({ clientId: 1, siteId: 1 }, { unique: true });

export const Site = model<SiteDoc>("Site", siteSchema);
