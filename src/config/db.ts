import mongoose from "mongoose";
import { env } from "./env";

export async function connectDb(): Promise<typeof mongoose> {
  mongoose.set("strictQuery", true);

  mongoose.connection.on("error", (err) => console.error("MongoDB connection error:", err.message));
  mongoose.connection.on("disconnected", () => console.warn("MongoDB disconnected"));
  mongoose.connection.on("reconnected", () => console.log("MongoDB reconnected"));

  return mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: 10_000,
  });
}
