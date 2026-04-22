const webpush = require('web-push');

class PushService {
  constructor() {
    this.initialized = false;
    this.enabled = false;
  }

  init() {
    if (this.initialized) {
      return;
    }

    this.initialized = true;

    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT;

    if (!publicKey || !privateKey || !subject) {
      this.enabled = false;
      console.warn('[push] disabled: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT belum lengkap');
      return;
    }

    webpush.setVapidDetails(subject, publicKey, privateKey);
    this.enabled = true;
    console.log('[push] web push enabled');
  }

  isEnabled() {
    this.init();
    return this.enabled;
  }

  async sendNotification(subscription, payloadObject) {
    this.init();
    if (!this.enabled) {
      return { ok: false, skipped: true };
    }

    try {
      await webpush.sendNotification(subscription, JSON.stringify(payloadObject));
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        statusCode: error.statusCode,
        message: error.message
      };
    }
  }
}

module.exports = {
  pushService: new PushService()
};
