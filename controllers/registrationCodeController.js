const { registrationCodeService } = require('../services/registrationCodeService');
const { buildListResponse } = require('../utils/listResponse');

const createRegistrationCode = async (req, res) => {
  try {
    const createdCode = await registrationCodeService.createCode(req.user, req.body || {});

    return res.status(201).json({
      success: true,
      message: 'Kode registrasi berhasil dibuat',
      data: createdCode
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Gagal membuat kode registrasi'
    });
  }
};

const listRegistrationCodes = async (req, res) => {
  try {
    const rows = await registrationCodeService.listCodes(req.user);
    const mapped = rows.map((row) => ({
      ...row,
      capabilities: {
        can_view: true,
        can_revoke: true,
        can_view_usages: true,
        can_delete_expired: req.user.role === 'admin' || req.user.role === 'teacher'
      }
    }));
    const list = buildListResponse(mapped, req.query);

    return res.json({
      success: true,
      data: list.data,
      meta: list.meta
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Gagal mengambil daftar kode registrasi'
    });
  }
};

const revokeRegistrationCode = async (req, res) => {
  try {
    const data = await registrationCodeService.revokeCode(req.user, req.params.codeId);

    return res.json({
      success: true,
      message: 'Kode registrasi berhasil dinonaktifkan',
      data
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Gagal menonaktifkan kode registrasi'
    });
  }
};

const getRegistrationCodeUsages = async (req, res) => {
  try {
    const rows = await registrationCodeService.listCodeUsages(req.user, req.params.codeId);
    const mapped = rows.map((row) => ({
      ...row,
      capabilities: {
        can_view: true
      }
    }));
    const list = buildListResponse(mapped, req.query);

    return res.json({
      success: true,
      data: list.data,
      meta: list.meta
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Gagal mengambil riwayat penggunaan kode'
    });
  }
};

const getRegistrationCodeSummary = async (req, res) => {
  try {
    const summary = await registrationCodeService.getSummary(req.user);

    return res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Gagal mengambil ringkasan kode registrasi'
    });
  }
};

const archiveExpiredRegistrationCodes = async (req, res) => {
  try {
    const result = await registrationCodeService.archiveExpiredCodes(req.user);

    return res.json({
      success: true,
      message: 'Arsip kode registrasi kadaluarsa selesai',
      data: result
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Gagal mengarsipkan kode registrasi kadaluarsa'
    });
  }
};

const deleteExpiredRegistrationCodes = async (req, res) => {
  try {
    const result = await registrationCodeService.deleteExpiredCodes(req.user);

    return res.json({
      success: true,
      message: 'Hapus kode registrasi kadaluarsa selesai',
      data: result
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : 'Gagal menghapus kode registrasi kadaluarsa'
    });
  }
};

module.exports = {
  createRegistrationCode,
  listRegistrationCodes,
  getRegistrationCodeSummary,
  revokeRegistrationCode,
  getRegistrationCodeUsages,
  archiveExpiredRegistrationCodes,
  deleteExpiredRegistrationCodes
};
