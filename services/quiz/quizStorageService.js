const fs = require('fs');
const path = require('path');

class QuizStorageService {
  constructor() {
    this.storageRoot = path.join(__dirname, '..', '..', 'storage');
    this.appRoot = path.join(__dirname, '..', '..');
  }

  ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  removeFileSafe(filePath) {
    if (filePath && fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  }

  moduleFolder(moduleId) {
    return path.join(this.storageRoot, 'modules', String(moduleId));
  }

  sessionFolder(moduleId, sessionId) {
    return path.join(this.moduleFolder(moduleId), 'sessions', String(sessionId));
  }

  quizFolder(moduleId, sessionId) {
    return path.join(this.sessionFolder(moduleId, sessionId), 'quiz');
  }

  moveTempFileTo(tempPath, targetDir) {
    this.ensureDir(targetDir);
    const fileName = path.basename(tempPath);
    const finalPath = path.join(targetDir, fileName);
    fs.renameSync(tempPath, finalPath);
    return finalPath;
  }

  toRelativeStoragePath(absPath) {
    return path.relative(this.appRoot, absPath).replace(/\\/g, '/');
  }

  toAbsolutePath(relativePath) {
    return path.join(this.appRoot, relativePath);
  }
}

module.exports = {
  quizStorageService: new QuizStorageService()
};
