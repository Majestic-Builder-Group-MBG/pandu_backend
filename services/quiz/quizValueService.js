class QuizValueService {
  toBoolean(value) {
    if (typeof value === 'boolean') return value;
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  toNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  parseJsonField(value, fieldName) {
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value === 'object') {
      return value;
    }

    try {
      return JSON.parse(String(value));
    } catch (error) {
      const err = new Error(`${fieldName} harus berupa JSON valid`);
      err.status = 400;
      throw err;
    }
  }

  normalizeQuestionOptions(rawOptions) {
    if (!Array.isArray(rawOptions)) {
      const error = new Error('options wajib berupa array untuk question_type=mcq');
      error.status = 400;
      throw error;
    }

    if (rawOptions.length < 2) {
      const error = new Error('options minimal 2 item untuk question_type=mcq');
      error.status = 400;
      throw error;
    }

    const normalized = rawOptions.map((option, index) => {
      const optionText = option && option.option_text ? String(option.option_text).trim() : '';
      if (!optionText) {
        const error = new Error(`option_text pada options[${index}] wajib diisi`);
        error.status = 400;
        throw error;
      }

      return {
        option_text: optionText,
        is_correct: this.toBoolean(option && option.is_correct),
        sort_order: Number.isInteger(Number(option && option.sort_order)) && Number(option.sort_order) > 0
          ? Number(option.sort_order)
          : index + 1
      };
    });

    if (!normalized.some((option) => option.is_correct)) {
      const error = new Error('minimal satu option harus memiliki is_correct=true');
      error.status = 400;
      throw error;
    }

    return normalized;
  }
}

module.exports = {
  quizValueService: new QuizValueService()
};
