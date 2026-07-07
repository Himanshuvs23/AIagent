import mongoose from "mongoose";

let connectionPromise = null;

export const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not configured");
  }

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(process.env.MONGO_URI).catch((error) => {
      connectionPromise = null;
      throw error;
    });
  }

  await connectionPromise;
  return mongoose.connection;
};
