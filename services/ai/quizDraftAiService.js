const fs = require('fs');
const path = require('path');
const https = require('https');
const pdfParse = require('pdf-parse');

const db = require('../../config/db');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const createHttpError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const parseJsonSafe = (rawValue) => {
  try {
    return JSON.parse(rawValue);
  } catch (error) {
    return null;
  }
};

class QuizDraftAiService {
  constructor() {
    this.appRoot = path.join(__dirname, '..', '..');
    this.storageRoot = path.join(this.appRoot, 'storage');
    this.defaultModel = process.env.OPENROUTER_MODEL || 'openai/gpt-oss-120b:free';
    this.maxContextChars = 40000;
  }

  getAbsoluteStoragePath(relativePath) {
    const absolutePath = path.resolve(this.appRoot, String(relativePath || ''));
    const storageRootNormalized = `${this.storageRoot}${path.sep}`;
    const absoluteNormalized = `${absolutePath}${path.sep}`;

    if (!absoluteNormalized.startsWith(storageRootNormalized)) {
      return null;
    }

    return absolutePath;
  }

  async extractPdfText(relativePath) {
    const absolutePath = this.getAbsoluteStoragePath(relativePath);
    if (!absolutePath) {
      return { ok: false, reason: 'invalid_file_path' };
    }

    if (!fs.existsSync(absolutePath)) {
      return { ok: false, reason: 'file_not_found' };
    }

    try {
      const dataBuffer = fs.readFileSync(absolutePath);
      const parsed = await pdfParse(dataBuffer);
      const text = String(parsed && parsed.text ? parsed.text : '').trim();
      if (!text) {
        return { ok: false, reason: 'empty_pdf_text' };
      }

      return { ok: true, text };
    } catch (error) {
      return { ok: false, reason: 'pdf_parse_failed' };
    }
  }

  async getSessionContents({ moduleId, sessionId, contentIds }) {
    let whereSql = `
      WHERE sc.session_id = ?
        AND ms.module_id = ?
    `;
    const params = [sessionId, moduleId];

    if (Array.isArray(contentIds) && contentIds.length > 0) {
      const placeholders = contentIds.map(() => '?').join(',');
      whereSql += ` AND sc.id IN (${placeholders})`;
      params.push(...contentIds);
    }

    const [rows] = await db.query(
      `SELECT sc.id, sc.session_id, sc.content_type, sc.title, sc.file_path, sc.mime_type, sc.url, sc.text_content
       FROM session_contents sc
       JOIN module_sessions ms ON ms.id = sc.session_id
       ${whereSql}
       ORDER BY sc.id ASC`,
      params
    );

    return rows;
  }

  async buildContextFromSessionContents({ moduleId, sessionId, contentIds, manualContext }) {
    const rows = await this.getSessionContents({ moduleId, sessionId, contentIds });
    const requestedSet = new Set(Array.isArray(contentIds) ? contentIds : []);

    if (requestedSet.size > 0) {
      const foundSet = new Set(rows.map((row) => Number(row.id)));
      const missingIds = [...requestedSet].filter((id) => !foundSet.has(id));
      if (missingIds.length > 0) {
        throw createHttpError(
          400,
          `Sebagian content_ids tidak ditemukan pada sesi ini: ${missingIds.join(', ')}`
        );
      }
    }

    const usedContentIds = [];
    const skippedContentIds = [];
    const warnings = [];
    const contextChunks = [];

    for (const row of rows) {
      const contentId = Number(row.id);

      if (row.content_type === 'text') {
        const textValue = String(row.text_content || '').trim();
        if (!textValue) {
          skippedContentIds.push({ content_id: contentId, reason: 'empty_text_content' });
          warnings.push(`content_id=${contentId} text_content kosong, konten dilewati`);
          continue;
        }

        usedContentIds.push(contentId);
        contextChunks.push(
          `[SESSION_CONTENT_TEXT id=${contentId}${row.title ? ` title="${String(row.title).trim()}"` : ''}]\n${textValue}`
        );
        continue;
      }

      if (row.content_type === 'file') {
        const mimeType = String(row.mime_type || '').toLowerCase();

        if (mimeType === 'application/pdf') {
          const extracted = await this.extractPdfText(row.file_path);
          if (!extracted.ok) {
            skippedContentIds.push({ content_id: contentId, reason: extracted.reason });
            warnings.push(`content_id=${contentId} gagal ekstrak PDF (${extracted.reason})`);
            continue;
          }

          usedContentIds.push(contentId);
          contextChunks.push(
            `[SESSION_CONTENT_PDF id=${contentId}${row.title ? ` title="${String(row.title).trim()}"` : ''}]\n${extracted.text}`
          );
          continue;
        }

        if (mimeType.startsWith('image/') || mimeType.startsWith('video/')) {
          skippedContentIds.push({ content_id: contentId, reason: 'unsupported_file_type' });
          warnings.push(`content_id=${contentId} tipe file belum didukung untuk generate otomatis (${mimeType || 'unknown'})`);
          continue;
        }

        skippedContentIds.push({ content_id: contentId, reason: 'unsupported_file_type' });
        warnings.push(`content_id=${contentId} tipe file belum didukung untuk generate otomatis (${mimeType || 'unknown'})`);
        continue;
      }

      if (row.content_type === 'url') {
        skippedContentIds.push({ content_id: contentId, reason: 'unsupported_content_type' });
        warnings.push(`content_id=${contentId} tipe konten url belum didukung untuk generate otomatis`);
        continue;
      }

      skippedContentIds.push({ content_id: contentId, reason: 'unsupported_content_type' });
      warnings.push(`content_id=${contentId} tipe konten tidak dikenali dan dilewati`);
    }

    const normalizedManualContext = String(manualContext || '').trim();
    const hasAutoContext = contextChunks.length > 0;
    const usedManualContext = Boolean(normalizedManualContext);

    if (!hasAutoContext && !usedManualContext) {
      throw createHttpError(
        400,
        'Konten sesi tidak dapat diproses otomatis. Isi manual_context untuk fallback konteks quiz.'
      );
    }

    if (usedManualContext) {
      contextChunks.push(`[MANUAL_CONTEXT]\n${normalizedManualContext}`);
    }

    const joined = contextChunks.join('\n\n---\n\n');
    const contextText = joined.length > this.maxContextChars
      ? joined.slice(0, this.maxContextChars)
      : joined;

    return {
      contextText,
      sourceSummary: {
        source_mode: 'session_contents',
        used_content_ids: usedContentIds,
        skipped_content_ids: skippedContentIds,
        used_manual_context: usedManualContext
      },
      warnings
    };
  }

  async requestOpenRouter({ model, messages, temperature }) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw createHttpError(500, 'OPENROUTER_API_KEY belum diset di environment');
    }

    const payload = {
      model,
      messages,
      temperature,
      max_tokens: 2500
    };

    const body = JSON.stringify(payload);
    const requestUrl = new URL(OPENROUTER_URL);

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          protocol: requestUrl.protocol,
          hostname: requestUrl.hostname,
          path: `${requestUrl.pathname}${requestUrl.search}`,
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
          },
          timeout: 60000
        },
        (res) => {
          let raw = '';
          res.on('data', (chunk) => {
            raw += chunk;
          });

          res.on('end', () => {
            const parsed = parseJsonSafe(raw);
            if (res.statusCode < 200 || res.statusCode >= 300) {
              const reason = parsed && parsed.error && parsed.error.message
                ? parsed.error.message
                : `OpenRouter request gagal (status=${res.statusCode})`;
              reject(createHttpError(502, reason));
              return;
            }

            if (!parsed) {
              reject(createHttpError(502, 'Response OpenRouter tidak valid JSON'));
              return;
            }

            resolve(parsed);
          });
        }
      );

      req.on('timeout', () => {
        req.destroy(createHttpError(504, 'Timeout saat memanggil OpenRouter'));
      });

      req.on('error', (error) => {
        reject(error.status ? error : createHttpError(502, `Gagal memanggil OpenRouter: ${error.message}`));
      });

      req.write(body);
      req.end();
    });
  }

  extractTextFromOpenRouterResponse(responseBody) {
    const choice = responseBody
      && Array.isArray(responseBody.choices)
      && responseBody.choices.length > 0
      ? responseBody.choices[0]
      : null;

    if (!choice || !choice.message || choice.message.content === undefined || choice.message.content === null) {
      throw createHttpError(502, 'OpenRouter tidak mengembalikan konten draft soal');
    }

    const content = choice.message.content;
    if (typeof content === 'string') {
      return content.trim();
    }

    if (Array.isArray(content)) {
      const text = content
        .map((item) => {
          if (!item) return '';
          if (typeof item === 'string') return item;
          if (item.type === 'text' && item.text) return String(item.text);
          return '';
        })
        .join('')
        .trim();

      return text;
    }

    return String(content).trim();
  }

  parseDraftJson(rawText) {
    const direct = parseJsonSafe(rawText);
    if (direct) {
      return direct;
    }

    const fenced = rawText.match(/```json\s*([\s\S]*?)```/i) || rawText.match(/```\s*([\s\S]*?)```/i);
    if (fenced && fenced[1]) {
      const parsed = parseJsonSafe(fenced[1].trim());
      if (parsed) {
        return parsed;
      }
    }

    throw createHttpError(502, 'Output AI bukan JSON valid');
  }

  buildPointPlan({ mcqCount, essayCount }) {
    const entries = [];
    for (let i = 0; i < mcqCount; i += 1) {
      entries.push({ type: 'mcq', weight: 1 });
    }
    for (let i = 0; i < essayCount; i += 1) {
      entries.push({ type: 'essay', weight: 2 });
    }

    if (entries.length === 0) {
      throw createHttpError(400, 'Jumlah soal tidak boleh 0');
    }

    const totalWeight = entries.reduce((sum, item) => sum + item.weight, 0);
    const points = [];
    let runningTotal = 0;

    for (let i = 0; i < entries.length; i += 1) {
      const isLast = i === entries.length - 1;
      const rawPoint = (entries[i].weight / totalWeight) * 100;
      const point = isLast
        ? Number((100 - runningTotal).toFixed(2))
        : Number(rawPoint.toFixed(2));

      runningTotal += point;
      points.push(point);
    }

    const mcqPoints = points.slice(0, mcqCount);
    const essayPoints = points.slice(mcqCount);

    return { mcqPoints, essayPoints };
  }

  inferQuizMetaFromContext(contextText) {
    const cleaned = String(contextText || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('[') && line !== '---')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) {
      return {
        title: 'Kuis Pemahaman Materi Sesi',
        description: 'Evaluasi pemahaman materi pada sesi ini.'
      };
    }

    const topic = cleaned.slice(0, 80).replace(/[.,;:!?]+$/, '').trim();
    const safeTopic = topic || 'Materi Sesi';

    return {
      title: `Kuis ${safeTopic}`,
      description: `Evaluasi pemahaman konsep utama tentang ${safeTopic}.`
    };
  }

  normalizeQuizMeta(draftJson, contextText) {
    const fromAiTitle = draftJson && draftJson.quiz_title
      ? String(draftJson.quiz_title).trim()
      : '';
    const fromAiDescription = draftJson && draftJson.quiz_description
      ? String(draftJson.quiz_description).trim()
      : '';

    const fallback = this.inferQuizMetaFromContext(contextText);

    const title = fromAiTitle || fallback.title;
    const description = fromAiDescription || fallback.description;

    return {
      title: title.slice(0, 255),
      description: description.slice(0, 1500)
    };
  }

  normalizeDraftOutput(draftJson, { mcqCount, essayCount, contextText }) {
    const draft = draftJson && draftJson.draft && typeof draftJson.draft === 'object'
      ? draftJson.draft
      : draftJson;

    const pointPlan = this.buildPointPlan({ mcqCount, essayCount });
    const quizMeta = this.normalizeQuizMeta(draftJson, contextText);

    const mcqRaw = Array.isArray(draft && draft.mcq) ? draft.mcq : [];
    const essayRaw = Array.isArray(draft && draft.essay) ? draft.essay : [];

    const normalizedMcq = mcqRaw.slice(0, mcqCount).map((item, index) => {
      const questionText = String(item && item.question_text ? item.question_text : '').trim();
      if (!questionText) {
        throw createHttpError(502, `Output AI tidak valid: mcq[${index}] question_text kosong`);
      }

      const optionsRaw = Array.isArray(item && item.options) ? item.options : [];
      if (optionsRaw.length < 3 || optionsRaw.length > 5) {
        throw createHttpError(502, `Output AI tidak valid: mcq[${index}] options harus 3 sampai 5 item`);
      }

      const normalizedOptions = optionsRaw.map((option, optionIndex) => ({
        option_text: String(option && option.option_text ? option.option_text : '').trim(),
        is_correct: Boolean(option && option.is_correct),
        sort_order: optionIndex + 1
      }));

      if (!normalizedOptions.some((option) => option.is_correct)) {
        throw createHttpError(502, `Output AI tidak valid: mcq[${index}] harus punya minimal 1 jawaban benar`);
      }

      return {
        sort_order: index + 1,
        question_type: 'mcq',
        question_text: questionText,
        points: pointPlan.mcqPoints[index],
        options: normalizedOptions
      };
    });

    const normalizedEssay = essayRaw.slice(0, essayCount).map((item, index) => {
      const questionText = String(item && item.question_text ? item.question_text : '').trim();
      if (!questionText) {
        throw createHttpError(502, `Output AI tidak valid: essay[${index}] question_text kosong`);
      }

      return {
        sort_order: normalizedMcq.length + index + 1,
        question_type: 'essay',
        question_text: questionText,
        points: pointPlan.essayPoints[index],
        rubric_hint: item && item.rubric_hint ? String(item.rubric_hint).trim() : null
      };
    });

    if (normalizedMcq.length < mcqCount || normalizedEssay.length < essayCount) {
      throw createHttpError(502, 'Output AI tidak memenuhi jumlah soal yang diminta');
    }

    return {
      quiz_title: quizMeta.title,
      quiz_description: quizMeta.description,
      mcq: normalizedMcq,
      essay: normalizedEssay,
      totals: {
        mcq_count: normalizedMcq.length,
        essay_count: normalizedEssay.length,
        points_total: Number((
          normalizedMcq.reduce((sum, item) => sum + Number(item.points || 0), 0)
          + normalizedEssay.reduce((sum, item) => sum + Number(item.points || 0), 0)
        ).toFixed(2))
      }
    };
  }

  buildSystemPrompt() {
    return [
      'Anda adalah AI penyusun soal kuis untuk LMS.',
      'Aturan wajib:',
      '1) Gunakan hanya konteks yang diberikan user. Jangan gunakan konteks eksternal.',
      '2) Hasilkan hanya JSON valid tanpa markdown, tanpa komentar, tanpa teks tambahan.',
      '3) Struktur JSON wajib:',
      '{',
      '  "quiz_title": "judul kuis berbasis konteks",',
      '  "quiz_description": "deskripsi singkat kuis berbasis konteks",',
      '  "mcq": [',
      '    {',
      '      "question_text": "...",',
      '      "options": [',
      '        { "option_text": "...", "is_correct": false },',
      '        { "option_text": "...", "is_correct": true }',
      '      ]',
      '    }',
      '  ],',
      '  "essay": [',
      '    {',
      '      "question_text": "...",',
      '      "rubric_hint": "..."',
      '    }',
      '  ]',
      '}',
      '4) MCQ wajib punya opsi bervariasi per soal: 3, 4, atau 5 opsi (jangan selalu sama).',
      '5) Setiap MCQ minimal 1 jawaban benar.',
      '6) Pertanyaan essay harus singkat, natural, dan opini/alasan sederhana (tanpa pertanyaan panjang berlapis).',
      '7) Quiz title dan description harus relevan langsung dengan konteks sesi, tidak generik.',
      '8) Jangan menghasilkan jawaban kosong.',
      '9) Bahasa mengikuti locale dari user request.'
    ].join('\n');
  }

  buildUserPrompt({ contextText, mcqCount, essayCount, difficulty, locale }) {
    return [
      `Buat ${mcqCount} soal MCQ dan ${essayCount} soal essay.`,
      `Difficulty: ${difficulty}.`,
      `Locale: ${locale}.`,
      '',
      'KONTEKS MATERI (isolasi sesi):',
      contextText
    ].join('\n');
  }

  async generateDraft({ moduleId, sessionId, contentIds, manualContext, mcqCount, essayCount, difficulty, locale }) {
    const contextResult = await this.buildContextFromSessionContents({
      moduleId,
      sessionId,
      contentIds,
      manualContext
    });

    const model = this.defaultModel;
    const responseBody = await this.requestOpenRouter({
      model,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: this.buildSystemPrompt()
        },
        {
          role: 'user',
          content: this.buildUserPrompt({
            contextText: contextResult.contextText,
            mcqCount,
            essayCount,
            difficulty,
            locale
          })
        }
      ]
    });

    const rawText = this.extractTextFromOpenRouterResponse(responseBody);
    const parsedJson = this.parseDraftJson(rawText);
    const draft = this.normalizeDraftOutput(parsedJson, { mcqCount, essayCount, contextText: contextResult.contextText });

    return {
      model,
      source_summary: contextResult.sourceSummary,
      warnings: contextResult.warnings,
      draft
    };
  }
}

module.exports = {
  quizDraftAiService: new QuizDraftAiService(),
  createHttpError
};
