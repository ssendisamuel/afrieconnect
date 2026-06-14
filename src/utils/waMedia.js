const fs = require('fs');
const path = require('path');

function resolveMediaPath(storedPath) {
  if (!storedPath) return null;
  if (path.isAbsolute(storedPath)) return storedPath;
  return path.join(process.cwd(), storedPath);
}

function buildWhatsAppContent(message, media) {
  if (!media?.path) {
    return { text: message || '' };
  }

  const filePath = resolveMediaPath(media.path);
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('Media file not found');
  }

  const buffer = fs.readFileSync(filePath);
  const mimetype = media.mimetype || 'application/octet-stream';
  const filename = media.filename || path.basename(filePath);
  const caption = message?.trim() || undefined;

  if (mimetype.startsWith('image/')) {
    return { image: buffer, caption, mimetype };
  }
  if (mimetype.startsWith('video/')) {
    return { video: buffer, caption, mimetype };
  }
  if (mimetype.startsWith('audio/')) {
    return { audio: buffer, mimetype, ptt: mimetype.includes('ogg') || mimetype.includes('amr') };
  }

  return {
    document: buffer,
    mimetype,
    fileName: filename,
    caption
  };
}

function mediaTypeLabel(mimetype) {
  if (!mimetype) return null;
  if (mimetype.startsWith('image/')) return 'Image';
  if (mimetype.startsWith('video/')) return 'Video';
  if (mimetype.startsWith('audio/')) return 'Audio';
  return 'Document';
}

module.exports = { resolveMediaPath, buildWhatsAppContent, mediaTypeLabel };
