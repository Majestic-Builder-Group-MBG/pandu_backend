const db = require('../config/db');
const { pushService } = require('./pushService');

class ReminderDispatcherService {
  constructor() {
    this.intervalHandle = null;
    this.isRunning = false;
    this.intervalMs = Number(process.env.REMINDER_DISPATCH_INTERVAL_MS || 60000);
  }

  async dispatchTick() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    try {
      const [targets] = await db.query(
        `SELECT sr.id AS reminder_id, sr.user_id, sr.module_id, sr.session_id, sr.notify_before_minutes,
           ms.title AS session_title, ms.open_at,
           m.name AS module_name
         FROM session_reminders sr
         JOIN module_sessions ms ON ms.id = sr.session_id
         JOIN modules m ON m.id = sr.module_id
         WHERE sr.enabled = 1
           AND sr.channel = 'in_app'
           AND ms.open_at IS NOT NULL
           AND NOW() BETWEEN DATE_SUB(ms.open_at, INTERVAL COALESCE(sr.notify_before_minutes, 0) MINUTE) AND ms.open_at`
      );

      for (const target of targets) {
        const [existsRows] = await db.query(
          `SELECT id
           FROM in_app_notifications
           WHERE user_id = ?
             AND type = 'session_reminder'
             AND JSON_EXTRACT(payload_json, '$.reminder_id') = CAST(? AS JSON)
           LIMIT 1`,
          [target.user_id, String(target.reminder_id)]
        );

        if (existsRows.length > 0) {
          continue;
        }

        const title = 'Pengingat Sesi';
        const message = target.notify_before_minutes
          ? `Sesi "${target.session_title}" pada modul "${target.module_name}" akan dibuka ${target.notify_before_minutes} menit lagi.`
          : `Sesi "${target.session_title}" pada modul "${target.module_name}" sudah dibuka.`;

        const payload = {
          reminder_id: target.reminder_id,
          module_id: target.module_id,
          session_id: target.session_id,
          open_at: target.open_at,
          notify_before_minutes: target.notify_before_minutes
        };

        await db.query(
          `INSERT INTO in_app_notifications (user_id, type, title, message, payload_json)
           VALUES (?, 'session_reminder', ?, ?, ?)`,
          [target.user_id, title, message, JSON.stringify(payload)]
        );

        const [subs] = await db.query(
          `SELECT id, endpoint, p256dh, auth
           FROM push_subscriptions
           WHERE user_id = ? AND is_active = 1`,
          [target.user_id]
        );

        if (subs.length > 0 && pushService.isEnabled()) {
          for (const sub of subs) {
            const pushPayload = {
              title: 'Sesi sudah dibuka',
              body: `Session ${target.session_title} di ${target.module_name} sekarang tersedia.`,
              url: `/courses/${target.module_id}?sessionId=${target.session_id}`,
              tag: `session-open-${target.module_id}-${target.session_id}`,
              icon: '/pwa-icon-192.png'
            };

            const result = await pushService.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: {
                  p256dh: sub.p256dh,
                  auth: sub.auth
                }
              },
              pushPayload
            );

            if (result.ok) {
              await db.query('UPDATE push_subscriptions SET last_success_at = NOW() WHERE id = ?', [sub.id]);
              continue;
            }

            await db.query('UPDATE push_subscriptions SET last_error_at = NOW() WHERE id = ?', [sub.id]);

            if (result.statusCode === 404 || result.statusCode === 410) {
              await db.query('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
            }
          }
        }
      }
    } catch (error) {
      console.error(`[reminder-dispatcher] ${error.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  start() {
    if (this.intervalHandle) {
      return;
    }

    const enabled = String(process.env.REMINDER_DISPATCH_ENABLED || 'true').trim().toLowerCase() === 'true';
    if (!enabled) {
      console.log('[reminder-dispatcher] disabled by REMINDER_DISPATCH_ENABLED=false');
      return;
    }

    this.dispatchTick();
    this.intervalHandle = setInterval(() => {
      this.dispatchTick();
    }, this.intervalMs);

    console.log(`[reminder-dispatcher] started interval=${this.intervalMs}ms`);
  }
}

module.exports = {
  reminderDispatcherService: new ReminderDispatcherService()
};
