import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 8787);
const OPENAI_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-5.4-mini';
const MAX_BODY = 2 * 1024 * 1024;

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(body));
}

function getApiKey(req, body) {
  const header = req.headers['authorization'];
  if (typeof header === 'string' && /^Bearer\s+\S+$/i.test(header)) {
    return header.replace(/^Bearer\s+/i, '').trim();
  }
  if (typeof body?.apiKey === 'string') return body.apiKey.trim();
  return '';
}

async function readJson(req) {
  return await new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (Buffer.byteLength(data, 'utf8') > MAX_BODY) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('INVALID_JSON')); }
    });
    req.on('error', reject);
  });
}

async function openAIRequest(apiKey, payload, timeoutMs = 30000) {
  if (!apiKey) throw new Error('API_KEY_MISSING');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('REQUEST_TIMEOUT');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function extractOutputText(data) {
  if (typeof data?.output_text === 'string' && data.output_text) return data.output_text;
  const parts = [];
  for (const item of (data?.output || [])) {
    for (const content of (item?.content || [])) {
      if (typeof content?.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('');
}

function sseWrite(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function handleTest(req, res, body) {
  const apiKey = getApiKey(req, body);
  const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : DEFAULT_MODEL;
  if (!apiKey) return sendJson(res, 400, { ok: false, code: 'API_KEY_MISSING', message: 'أدخل مفتاح OpenAI API أولاً.' });

  const started = Date.now();
  try {
    const upstream = await openAIRequest(apiKey, {
      model,
      instructions: 'You are performing an API connectivity test. Reply with exactly: JARVIS API CONNECTED',
      input: 'Connection test',
      reasoning: { effort: 'none' },
      store: false
    }, 20000);

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const upstreamMessage = data?.error?.message || `OpenAI HTTP ${upstream.status}`;
      return sendJson(res, 502, {
        ok: false,
        code: 'OPENAI_ERROR',
        status: upstream.status,
        message: upstreamMessage,
        latencyMs: Date.now() - started
      });
    }

    return sendJson(res, 200, {
      ok: true,
      model,
      latencyMs: Date.now() - started,
      response: extractOutputText(data)
    });
  } catch (err) {
    const code = err?.message || 'REQUEST_FAILED';
    return sendJson(res, 502, {
      ok: false,
      code,
      message: code === 'REQUEST_TIMEOUT' ? 'انتهت مهلة الاتصال بـ OpenAI.' : 'تعذر الاتصال بخدمة OpenAI.',
      latencyMs: Date.now() - started
    });
  }
}


async function handleVision(req, res, body) {
  const apiKey = getApiKey(req, body);
  const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : DEFAULT_MODEL;
  const prompt = typeof body?.prompt === 'string' && body.prompt.trim() ? body.prompt.trim() : 'صف ما تراه في الصورة باختصار وبدقة.';
  const image = typeof body?.image === 'string' ? body.image : '';

  if (!apiKey) return sendJson(res, 400, { ok: false, code: 'API_KEY_MISSING', message: 'أدخل مفتاح OpenAI API أولاً.' });
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) {
    return sendJson(res, 400, { ok: false, code: 'IMAGE_INVALID', message: 'صيغة الصورة غير صالحة.' });
  }

  const started = Date.now();
  try {
    const upstream = await openAIRequest(apiKey, {
      model,
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: image, detail: 'auto' }
        ]
      }],
      reasoning: { effort: 'none' },
      store: false
    }, 45000);

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return sendJson(res, 502, {
        ok: false,
        code: 'OPENAI_ERROR',
        status: upstream.status,
        message: data?.error?.message || `OpenAI HTTP ${upstream.status}`,
        latencyMs: Date.now() - started
      });
    }

    return sendJson(res, 200, {
      ok: true,
      model,
      latencyMs: Date.now() - started,
      text: extractOutputText(data)
    });
  } catch (err) {
    return sendJson(res, 502, {
      ok: false,
      code: err?.message || 'REQUEST_FAILED',
      message: err?.message === 'REQUEST_TIMEOUT' ? 'انتهت مهلة تحليل الصورة.' : 'تعذر تحليل الصورة عبر OpenAI.',
      latencyMs: Date.now() - started
    });
  }
}

async function handleChat(req, res, body) {
  const apiKey = getApiKey(req, body);
  const model = typeof body?.model === 'string' && body.model.trim() ? body.model.trim() : DEFAULT_MODEL;
  const instructions = typeof body?.instructions === 'string' ? body.instructions : '';
  const input = typeof body?.input === 'string' ? body.input : '';

  if (!apiKey) return sendJson(res, 400, { ok: false, code: 'API_KEY_MISSING', message: 'أدخل مفتاح OpenAI API أولاً.' });
  if (!input.trim()) return sendJson(res, 400, { ok: false, code: 'INPUT_MISSING', message: 'لم يصل نص الرسالة.' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  req.on('close', () => controller.abort());

  try {
    const upstream = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        instructions,
        input,
        reasoning: { effort: 'none' },
        stream: true,
        store: false
      }),
      signal: controller.signal
    });

    if (!upstream.ok || !upstream.body) {
      const errData = await upstream.json().catch(() => ({}));
      sseWrite(res, {
        type: 'error',
        code: 'OPENAI_ERROR',
        status: upstream.status,
        message: errData?.error?.message || `OpenAI HTTP ${upstream.status}`
      });
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;

        try {
          const event = JSON.parse(raw);
          if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
            sseWrite(res, { type: 'delta', text: event.delta });
          } else if (event.type === 'response.completed') {
            sseWrite(res, { type: 'completed' });
          } else if (event.type === 'error' || event.type === 'response.failed') {
            sseWrite(res, { type: 'error', code: 'MODEL_ERROR', message: event.message || event.error?.message || 'فشل توليد الرد.' });
          }
        } catch {
          // Ignore malformed SSE fragments; stream continues.
        }
      }
    }

    sseWrite(res, { type: 'done' });
    res.end();
  } catch (err) {
    sseWrite(res, {
      type: 'error',
      code: err?.name === 'AbortError' ? 'REQUEST_TIMEOUT' : 'REQUEST_FAILED',
      message: err?.name === 'AbortError' ? 'انتهت مهلة الرد أو تم إلغاء الطلب.' : 'فقد الاتصال بخدمة OpenAI.'
    });
    res.end();
  } finally {
    clearTimeout(timeout);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, service: 'JARVIS Web AI Gateway', model: DEFAULT_MODEL });
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(html);
  }

  if (req.method === 'POST' && (url.pathname === '/api/test' || url.pathname === '/api/chat' || url.pathname === '/api/vision')) {
    try {
      const body = await readJson(req);
      if (url.pathname === '/api/test') return await handleTest(req, res, body);
      if (url.pathname === '/api/vision') return await handleVision(req, res, body);
      return await handleChat(req, res, body);
    } catch (err) {
      const message = err?.message === 'BODY_TOO_LARGE' ? 'الطلب كبير جدًا.' : 'بيانات الطلب غير صالحة.';
      return sendJson(res, 400, { ok: false, code: err?.message || 'BAD_REQUEST', message });
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`JARVIS Web AI Gateway running on http://localhost:${PORT}`);
});
