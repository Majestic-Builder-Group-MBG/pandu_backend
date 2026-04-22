const db = require('../../config/db');

class SessionContentService {
  async getSessionContentFileByIds(moduleId, sessionId, contentId) {
    const [rows] = await db.query(
      `SELECT sc.id, sc.file_path, sc.mime_type, ms.open_at
       FROM session_contents sc
       JOIN module_sessions ms ON ms.id = sc.session_id
       WHERE sc.id = ? AND sc.session_id = ? AND ms.module_id = ? AND sc.content_type = 'file'`,
      [contentId, sessionId, moduleId]
    );

    return rows[0] || null;
  }

  isDirectPublicViewAllowed(mimeType) {
    const normalizedMimeType = String(mimeType || '').toLowerCase();
    if (!normalizedMimeType) {
      return false;
    }

    if (normalizedMimeType.startsWith('image/')) {
      return false;
    }

    if (normalizedMimeType.startsWith('video/')) {
      return false;
    }

    return true;
  }

  getFileKind(mimeType) {
    const normalizedMimeType = String(mimeType || '').toLowerCase();

    if (!normalizedMimeType) {
      return null;
    }

    if (normalizedMimeType.startsWith('image/')) {
      return 'image';
    }

    if (normalizedMimeType.startsWith('video/')) {
      return 'video';
    }

    if (normalizedMimeType === 'application/pdf') {
      return 'document';
    }

    return 'other';
  }

  buildSessionContentResponse(contentRow, moduleId, sessionId) {
    const fileDownloadUrl = contentRow && contentRow.file_path
      ? `/api/modules/${moduleId}/sessions/${sessionId}/contents/${contentRow.id}/file`
      : null;

    const fileKind = contentRow && contentRow.content_type === 'file'
      ? this.getFileKind(contentRow.mime_type)
      : null;

    const isMedia = fileKind === 'image' || fileKind === 'video';
    const isPublicViewSupported = Boolean(
      contentRow &&
      contentRow.content_type === 'file' &&
      this.isDirectPublicViewAllowed(contentRow.mime_type)
    );

    return {
      ...contentRow,
      file_download_url: fileDownloadUrl,
      file_kind: fileKind,
      is_media: isMedia,
      is_public_view_supported: isPublicViewSupported,
      should_use_public_view_url: isPublicViewSupported
    };
  }
}

module.exports = {
  sessionContentService: new SessionContentService()
};
