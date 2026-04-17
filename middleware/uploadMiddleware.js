const fs = require('fs');
const path = require('path');
const multer = require('multer');

const tempUploadDir = path.join(__dirname, '..', 'storage', 'temp');
fs.mkdirSync(tempUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tempUploadDir),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const allowedMimeTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/ogg'
]);

const fileFilter = (req, file, cb) => {
  if (allowedMimeTypes.has(file.mimetype)) {
    cb(null, true);
    return;
  }

  cb(new Error('Tipe file tidak didukung. Gunakan PDF, JPG/PNG/WEBP, atau video MP4/WEBM/OGG'));
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 200 * 1024 * 1024
  }
});

module.exports = upload;
