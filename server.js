import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8787);
const GROQ_URL =
  'https://api.groq.com/openai/v1/chat/completions';

const MODELS = {
  default: 'openai/gpt-oss-20b',
  fast: 'openai/gpt-oss-20b',
  powerful: 'openai/gpt-oss-120b',
  'gpt-oss-20b': 'openai/gpt-oss-20b',
  'gpt-oss-120b': 'openai/gpt-oss-120b'
};

const DEFAULT_MODEL = MODELS.default;
const MAX_BODY = 2 * 1024 * 1024;

function sendJson(res, status, data) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(data));
}

function getApiKey(req, body = {}) {
  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (match) return match[1].trim();
  if (typeof body.apiKey === 'string') return body.apiKey.trim();

  return process.env.GROQ_API_KEY?.trim() || '';
}

function normalizeModel(value) {
  const model = typeof value === 'string' ? value.trim() : '';

  if (!model) return DEFAULT_MODEL;
  if (MODELS[model.toLowerCase()]) {
    return MODELS[model.toLowerCase()];
  }

  // Compatibility with the existing JARVIS UI:
  // its old model name is mapped to Groq's 20B model.
  if (/^(gpt-|o[1-9]|chatgpt-)/i.test(model)) {
    return DEFAULT_MODEL;
  }

  if (model.startsWith('openai/gpt-oss-20b')) {
    return MODELS['gpt-oss-20b'];
  }

  if (model.startsWith('openai/gpt-oss-120b')) {
    return MODELS['gpt-oss-120b'];
  }

  // Do not silently send unknown model IDs.
  throw new Error('MODEL_NOT_SUPPORTED');
}

async function readJson(req) {
  let raw = '';

  for await (const chunk of req) {
    raw += chunk.toString('utf8');

    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY) {
      throw new Error('BODY_TOO_LARGE');
    }
  }

  if (!raw.trim()) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('INVALID_JSON');
  }
}

async function groqRequest(apiKey, payload, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('REQUEST_TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readResponse(response) {
  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  return { text, data };
}

function errorMessage(data, text, fallback) {
  return data?.error?.message ||
    data?.message ||
    (text && text.slice(0, 1000)) ||
    fallback;
}

function sse(res, payload) {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

function resolveErrorStatus(error) {
  if (error.message === 'BODY_TOO_LARGE') return 413;
  if (error.message === 'INVALID_JSON') return 400;
  if (error.message === 'MODEL_NOT_SUPPORTED') return 400;
  return 500;
}

// ------------------------------------------------------------
// API TEST
// ------------------------------------------------------------

async function handleTest(req, res, body) {
  const apiKey = getApiKey(req, body);

  if (!apiKey) {
    return sendJson(res, 400, {
      ok: false,
      code: 'API_KEY_MISSING',
      message: 'أدخل Groq API Key أولاً.'
    });
  }

  let model;

  try {
    model = normalizeModel(body.model);
  } catch (error) {
    return sendJson(res, 400, {
      ok: false,
      code: error.message,
      message: 'الموديل غير مدعوم. اختر أحد موديلات GPT-OSS.'
    });
  }

  const started = Date.now();

  try {
    const response = await groqRequest(apiKey, {
      model,
      messages: [
        {
          role: 'user',
          content: 'Reply with exactly: JARVIS GROQ CONNECTED'
        }
      ],
      max_completion_tokens: 64,
      stream: false
    }, 30000);

    const { text, data } = await readResponse(response);

    if (!response.ok) {
      return sendJson(res, response.status, {
        ok: false,
        provider: 'groq',
        code: data?.error?.code || 'GROQ_ERROR',
        status: response.status,
        model,
        message: errorMessage(
          data,
          text,
          `Groq returned HTTP ${response.status}`
        ),
        latencyMs: Date.now() - started
      });
    }

    return sendJson(res, 200, {
      ok: true,
      provider: 'groq',
      model: data.model || model,
      response: data.choices?.[0]?.message?.content || '',
      latencyMs: Date.now() - started
    });
  } catch (error) {
    return sendJson(res, 502, {
      ok: false,
      provider: 'groq',
      code: error.message || 'REQUEST_FAILED',
      message: error.message === 'REQUEST_TIMEOUT'
        ? 'انتهت مهلة الاتصال بـ Groq.'
        : 'تعذر الاتصال بخدمة Groq.',
      latencyMs: Date.now() - started
    });
  }
}

// ------------------------------------------------------------
// STREAMING CHAT
// ------------------------------------------------------------

async function handleChat(req, res, body) {
  const apiKey = getApiKey(req, body);

  if (!apiKey) {
    return sendJson(res, 400, {
      ok: false,
      code: 'API_KEY_MISSING',
      message: 'أدخل Groq API Key أولاً.'
    });
  }

  let model;

  try {
    model = normalizeModel(body.model);
  } catch (error) {
    return sendJson(res, 400, {
      ok: false,
      code: error.message,
      message: 'الموديل غير مدعوم.'
    });
  }

  const input = typeof body.input === 'string'
    ? body.input.trim()
    : typeof body.message === 'string'
      ? body.message.trim()
      : '';

  const instructions = typeof body.instructions === 'string'
    ? body.instructions.trim()
    : '';

  if (!input) {
    return sendJson(res, 400, {
      ok: false,
      code: 'INPUT_MISSING',
      message: 'لم يصل نص الرسالة.'
    });
  }

  const messages = [];

  if (instructions) {
    messages.push({ role: 'system', content: instructions });
  }

  messages.push({ role: 'user', content: input });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  res.flushHeaders?.();

  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const upstream = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        max_completion_tokens: 4096
      }),
      signal: controller.signal
    });

    if (!upstream.ok || !upstream.body) {
      const { text, data } = await readResponse(upstream);

      sse(res, {
        type: 'error',
        code: data?.error?.code || 'GROQ_ERROR',
        status: upstream.status,
        message: errorMessage(
          data,
          text,
          `Groq returned HTTP ${upstream.status}`
        )
      });

      sse(res, { type: 'done' });
      return res.end();
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;

        const raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;

        let event;

        try {
          event = JSON.parse(raw);
        } catch {
          continue;
        }

        if (event.error) {
          sse(res, {
            type: 'error',
            code: event.error.code || 'MODEL_ERROR',
            message: event.error.message || 'فشل توليد الرد.'
          });
          continue;
        }

        const delta = event.choices?.[0]?.delta?.content;

        if (typeof delta === 'string' && delta) {
          // Preserve a simple event for JARVIS clients.
          sse(res, { type: 'delta', text: delta });

          // Also provide the OpenAI-compatible event shape.
          sse(res, {
            type: 'response.output_text.delta',
            delta
          });
        }
      }
    }

    sse(res, { type: 'completed' });
    sse(res, { type: 'done' });
    res.end();
  } catch (error) {
    if (!res.writableEnded) {
      sse(res, {
        type: 'error',
        code: error.name === 'AbortError'
          ? 'REQUEST_TIMEOUT'
          : 'REQUEST_FAILED',
        message: error.name === 'AbortError'
          ? 'انتهت مهلة الرد أو تم إلغاء الطلب.'
          : 'تعذر الاتصال بخدمة Groq.'
      });

      sse(res, { type: 'done' });
      res.end();
    }
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------
// VISION
// ------------------------------------------------------------
// GPT-OSS 20B and 120B are text models.
// Keep the route so the existing frontend does not break.

function handleVision(res) {
  return sendJson(res, 501, {
    ok: false,
    code: 'VISION_NOT_SUPPORTED',
    message: 'الموديلان GPT-OSS 20B و120B لا يدعمان إدخال الصور.'
  });
}

// ------------------------------------------------------------
// SERVER
// ------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(
    req.url || '/',
    `http://${req.headers.host || 'localhost'}`
  );

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'JARVIS Web AI Gateway',
      provider: 'Groq',
      endpoint: GROQ_URL,
      defaultModel: DEFAULT_MODEL,
      availableModels: [
        'openai/gpt-oss-20b',
        'openai/gpt-oss-120b'
      ]
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/models') {
    return sendJson(res, 200, {
      ok: true,
      provider: 'Groq',
      models: MODELS
    });
  }

  if (
    req.method === 'GET' &&
    (url.pathname === '/' || url.pathname === '/index.html')
  ) {
    const indexPath = path.join(__dirname, 'index.html');

    if (!fs.existsSync(indexPath)) {
      return sendJson(res, 500, {
        ok: false,
        code: 'INDEX_NOT_FOUND',
        message: 'index.html غير موجود.'
      });
    }

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });

    return res.end(fs.readFileSync(indexPath));
  }

  if (
    req.method === 'POST' &&
    ['/api/test', '/api/chat', '/api/vision'].includes(url.pathname)
  ) {
    let body;

    try {
      body = await readJson(req);
    } catch (error) {
      return sendJson(res, resolveErrorStatus(error), {
        ok: false,
        code: error.message,
        message: error.message === 'BODY_TOO_LARGE'
          ? 'حجم الطلب أكبر من المسموح.'
          : 'تعذر قراءة JSON للطلب.'
      });
    }

    if (url.pathname === '/api/test') {
      return handleTest(req, res, body);
    }

    if (url.pathname === '/api/chat') {
      return handleChat(req, res, body);
    }

    return handleVision(res);
  }

  return sendJson(res, 404, {
    ok: false,
    code: 'NOT_FOUND',
    message: 'المسار غير موجود.'
  });
});

server.listen(PORT, () => {
  console.log(`JARVIS Gateway listening on port ${PORT}`);
  console.log('Provider: Groq');
  console.log(`Default model: ${DEFAULT_MODEL}`);
});
