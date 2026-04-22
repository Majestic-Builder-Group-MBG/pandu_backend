const crypto = require('crypto');
const db = require('../config/db');
const { buildListResponse } = require('../utils/listResponse');

const hashEndpoint = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('hex');

const normalizeSubscriptionPayload = (body = {}) => {
  const subscription = body.subscription && typeof body.subscription === 'object'
    ? body.subscription
    : body;

  const endpoint = subscription && subscription.endpoint ? String(subscription.endpoint).trim() : '';
  const keys = subscription && subscription.keys && typeof subscription.keys === 'object' ? subscription.keys : {};
  const p256dh = keys.p256dh ? String(keys.p256dh).trim() : '';
  const auth = keys.auth ? String(keys.auth).trim() : '';

  if (!endpoint || !p256dh || !auth) {
    return { error: 'subscription endpoint dan keys (p256dh/auth) wajib diisi' };
  }

  return {
    endpoint,
    endpoint_hash: hashEndpoint(endpoint),
    p256dh,
    auth,
    user_agent: body.user_agent ? String(body.user_agent).slice(0, 512) : null,
    platform: body.platform ? String(body.platform).slice(0, 120) : null
  };
};

const savePushSubscription = async (req, res) => {
  try {
    const normalized = normalizeSubscriptionPayload(req.body || {});
    if (normalized.error) {
      return res.status(400).json({ success: false, message: normalized.error });
    }

    const [existingRows] = await db.query(
      'SELECT id, user_id FROM push_subscriptions WHERE endpoint_hash = ? LIMIT 1',
      [normalized.endpoint_hash]
    );

    if (existingRows.length > 0) {
      await db.query(
        `UPDATE push_subscriptions
         SET user_id = ?, endpoint = ?, p256dh = ?, auth = ?, user_agent = ?, platform = ?, is_active = 1
         WHERE id = ?`,
        [
          req.user.id,
          normalized.endpoint,
          normalized.p256dh,
          normalized.auth,
          normalized.user_agent,
          normalized.platform,
          existingRows[0].id
        ]
      );
    } else {
      await db.query(
        `INSERT INTO push_subscriptions
         (user_id, endpoint, endpoint_hash, p256dh, auth, user_agent, platform, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          req.user.id,
          normalized.endpoint,
          normalized.endpoint_hash,
          normalized.p256dh,
          normalized.auth,
          normalized.user_agent,
          normalized.platform
        ]
      );
    }

    const [rows] = await db.query(
      `SELECT id, endpoint, user_agent, platform, is_active, last_success_at, last_error_at, created_at, updated_at
       FROM push_subscriptions
       WHERE endpoint_hash = ? LIMIT 1`,
      [normalized.endpoint_hash]
    );

    return res.status(201).json({
      success: true,
      message: 'Push subscription berhasil disimpan',
      data: rows[0]
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal menyimpan push subscription', error: error.message });
  }
};

const deletePushSubscription = async (req, res) => {
  const body = req.body || {};
  const endpoint = body.endpoint ? String(body.endpoint).trim() : '';
  const endpointHash = body.endpoint_hash ? String(body.endpoint_hash).trim() : '';

  if (!endpoint && !endpointHash) {
    return res.status(400).json({ success: false, message: 'endpoint atau endpoint_hash wajib dikirim' });
  }

  const resolvedHash = endpointHash || hashEndpoint(endpoint);

  try {
    const [rows] = await db.query(
      'SELECT id FROM push_subscriptions WHERE endpoint_hash = ? AND user_id = ? LIMIT 1',
      [resolvedHash, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Push subscription tidak ditemukan' });
    }

    await db.query('DELETE FROM push_subscriptions WHERE id = ?', [rows[0].id]);
    return res.json({ success: true, message: 'Push subscription berhasil dihapus' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal menghapus push subscription', error: error.message });
  }
};

const listMyPushSubscriptions = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, endpoint, user_agent, platform, is_active, last_success_at, last_error_at, created_at, updated_at
       FROM push_subscriptions
       WHERE user_id = ?
       ORDER BY updated_at DESC`,
      [req.user.id]
    );

    const mapped = rows.map((row) => ({
      ...row,
      capabilities: {
        can_view: true,
        can_delete: true
      }
    }));

    const list = buildListResponse(mapped, req.query);
    return res.json({ success: true, data: list.data, meta: list.meta });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Gagal mengambil push subscriptions', error: error.message });
  }
};

module.exports = {
  savePushSubscription,
  deletePushSubscription,
  listMyPushSubscriptions,
  hashEndpoint
};
