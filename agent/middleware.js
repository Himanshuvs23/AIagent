import multer from "multer";
import cloudinary from "./config/cloudnary.js";
import { CloudinaryStorage } from "multer-storage-cloudinary";

const storage = new CloudinaryStorage({
  cloudinary: cloudinary ,
  params: {
    folder: "agent_uploads",
    allowed_formats: ["jpg", "jpeg", "png", "pdf", "txt", "doc", "docx"]
  }
});

export const upload = multer({ storage });