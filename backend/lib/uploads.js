const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');

const DATA_DIR = process.env.DATA_DIR || '/data';
const MAX_MB = Math.max(1, Number.parseInt(process.env.UPLOAD_MAX_MB || '50', 10));
const MAX_BYTES = MAX_MB * 1024 * 1024;

const MIME_BY_TYPE = {
  image: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  sound: new Set(['audio/mpeg', 'audio/wav', 'audio/ogg']),
  video: new Set(['video/mp4', 'video/webm', 'video/quicktime'])
};

const EXT_BY_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov'
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const bodyType = req.body && req.body.body_type;
    if (!['image', 'sound', 'video', 'text'].includes(bodyType)) {
      return cb(new Error('invalid_body_type'));
    }
    if (bodyType === 'text') return cb(new Error('unexpected_file'));
    if (!MIME_BY_TYPE[bodyType].has(file.mimetype)) {
      return cb(new Error('invalid_file_type'));
    }
    cb(null, true);
  }
});

function ensureUploadDirs() {
  for (const dir of ['images', 'sound', 'video']) {
    fs.mkdirSync(path.join(DATA_DIR, 'uploads', 'media', dir), { recursive: true });
  }
}

function randomName(ext) {
  return `${crypto.randomUUID()}.${ext}`;
}

async function persistUploadedFile(file, bodyType) {
  if (!file) return null;
  ensureUploadDirs();

  if (!MIME_BY_TYPE[bodyType] || !MIME_BY_TYPE[bodyType].has(file.mimetype)) {
    const err = new Error('invalid_file_type');
    err.code = 'INVALID_UPLOAD';
    throw err;
  }

  const dir = path.join(DATA_DIR, 'uploads', 'media', bodyType === 'image' ? 'images' : bodyType);
  let ext = EXT_BY_MIME[file.mimetype];
  let publicPath;

  if (bodyType === 'image') {
    // Images are deliberately normalized to WebP after a max-1600px resize.
    ext = 'webp';
    const filename = randomName(ext);
    const diskPath = path.join(dir, filename);
    await sharp(file.buffer)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 84 })
      .toFile(diskPath);
    publicPath = `/uploads/media/images/${filename}`;
    return { filePath: publicPath, fileMime: 'image/webp' };
  }

  const filename = randomName(ext);
  const diskPath = path.join(dir, filename);
  fs.writeFileSync(diskPath, file.buffer);
  publicPath = `/uploads/media/${bodyType}/${filename}`;
  return { filePath: publicPath, fileMime: file.mimetype };
}

function deletePublicMediaPath(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/media/')) return;
  const relative = publicPath.replace(/^\/uploads\/media\//, '');
  const root = path.resolve(path.join(DATA_DIR, 'uploads', 'media'));
  const diskPath = path.resolve(path.join(root, relative));
  if (diskPath === root || !diskPath.startsWith(`${root}${path.sep}`)) return;
  try { fs.unlinkSync(diskPath); } catch (_) {}
}

function uploadErrorHandler(err, _req, res, next) {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'upload_error' : 'upload_error' });
  }
  if (['invalid_body_type', 'unexpected_file', 'invalid_file_type'].includes(err.message)) {
    return res.status(400).json({ error: err.message });
  }
  return next(err);
}

module.exports = {
  upload,
  persistUploadedFile,
  deletePublicMediaPath,
  uploadErrorHandler,
  MAX_BYTES
};
