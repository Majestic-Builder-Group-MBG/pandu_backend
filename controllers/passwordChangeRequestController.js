const { buildListResponse } = require('../utils/listResponse');
const { passwordChangeService } = require('../services/passwordChangeService');

const listPasswordChangeRequestInbox = async (req, res) => {
  try {
    const rows = await passwordChangeService.listInbox(req.user);
    const mapped = rows.map((row) => ({
      ...row,
      capabilities: {
        can_view: true,
        can_issue_otp: ['pending', 'otp_issued'].includes(row.status),
        can_reject: ['pending', 'otp_issued'].includes(row.status)
      }
    }));

    const list = buildListResponse(mapped, req.query);
    return res.json({ success: true, data: list.data, meta: list.meta });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Gagal mengambil inbox permintaan ganti password'
    });
  }
};

const issuePasswordChangeOtp = async (req, res) => {
  try {
    const data = await passwordChangeService.issueOtp({
      approver: req.user,
      requestId: req.params.requestId
    });

    return res.json({
      success: true,
      message: 'OTP berhasil dibuat. Sampaikan OTP ke user secara manual.',
      data
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Gagal menerbitkan OTP'
    });
  }
};

const rejectPasswordChangeRequest = async (req, res) => {
  try {
    const data = await passwordChangeService.rejectRequest({
      approver: req.user,
      requestId: req.params.requestId,
      reason: req.body && req.body.reason
    });

    return res.json({
      success: true,
      message: 'Permintaan ganti password berhasil ditolak',
      data
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Gagal menolak permintaan ganti password'
    });
  }
};

module.exports = {
  listPasswordChangeRequestInbox,
  issuePasswordChangeOtp,
  rejectPasswordChangeRequest
};
