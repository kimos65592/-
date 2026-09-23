import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8787);

const HF_URL =
  'https://router.huggingface.co/v1/chat/completions';

const DEFAULT_MODEL =
  'openai/gpt-oss-120b:fastest';

const MAX_BODY =
  2 * 1024 * 1024;


// ============================================================
// JSON RESPONSE
// ============================================================

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });

  res.end(JSON.stringify(body));
}


// ============================================================
// API KEY
// ============================================================

function getApiKey(req, body) {
  const header =
    req.headers['authorization'];

  if (
    typeof header === 'string' &&
    /^Bearer\s+\S+$/i.test(header)
  ) {
    return header
      .replace(/^Bearer\s+/i, '')
      .trim();
  }

  if (
    typeof body?.apiKey === 'string'
  ) {
    return body.apiKey.trim();
  }

  return '';
}


// ============================================================
// READ JSON
// ============================================================

async function readJson(req) {
  return await new Promise((resolve, reject) => {
    let data = '';

    req.on('data', chunk => {
      data += chunk;

      if (
        Buffer.byteLength(data, 'utf8') >
        MAX_BODY
      ) {
        reject(
          new Error('BODY_TOO_LARGE')
        );

        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        resolve(
          data
            ? JSON.parse(data)
            : {}
        );
      } catch {
        reject(
          new Error('INVALID_JSON')
        );
      }
    });

    req.on('error', reject);
  });
}


// ============================================================
// HUGGING FACE REQUEST
// ============================================================

async function huggingFaceRequest(
  apiKey,
  payload,
  timeoutMs = 30000
) {
  if (!apiKey) {
    throw new Error(
      'API_KEY_MISSING'
    );
  }

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {
    return await fetch(
      HF_URL,
      {
        method: 'POST',

        headers: {
          'Authorization':
            `Bearer ${apiKey}`,

          'Content-Type':
            'application/json'
        },

        body: JSON.stringify(
          payload
        ),

        signal:
          controller.signal
      }
    );

  } catch (err) {

    if (
      err?.name ===
      'AbortError'
    ) {
      throw new Error(
        'REQUEST_TIMEOUT'
      );
    }

    throw err;

  } finally {

    clearTimeout(timer);
  }
}


// ============================================================
// SSE
// ============================================================

function sseWrite(
  res,
  payload
) {
  res.write(
    `data: ${JSON.stringify(payload)}\n\n`
  );
}


// ============================================================
// API TEST
// ============================================================

async function handleTest(
  req,
  res,
  body
) {
  const apiKey =
    getApiKey(req, body);

  const model =
    typeof body?.model === 'string' &&
    body.model.trim()
      ? body.model.trim()
      : DEFAULT_MODEL;

  if (!apiKey) {
    return sendJson(
      res,
      400,
      {
        ok: false,

        code:
          'API_KEY_MISSING',

        message:
          'أدخل Hugging Face Token أولاً.'
      }
    );
  }

  const started =
    Date.now();

  try {

    const upstream =
      await huggingFaceRequest(
        apiKey,
        {
          model,

          messages: [
            {
              role: 'user',

              content:
                'Reply with exactly: JARVIS HF CONNECTED'
            }
          ],

          stream: false
        },

        30000
      );


    const data =
      await upstream
        .json()
        .catch(() => ({}));


    if (!upstream.ok) {

      return sendJson(
        res,
        upstream.status,
        {
          ok: false,

          code:
            data?.error?.code ||
            'HF_ERROR',

          status:
            upstream.status,

          message:
            data?.error?.message ||
            `Hugging Face HTTP ${upstream.status}`,

          latencyMs:
            Date.now() -
            started
        }
      );
    }


    const responseText =
      data
        ?.choices?.[0]
        ?.message?.content ||
      '';


    return sendJson(
      res,
      200,
      {
        ok: true,

        model,

        latencyMs:
          Date.now() -
          started,

        response:
          responseText
      }
    );

  } catch (err) {

    const code =
      err?.message ||
      'REQUEST_FAILED';


    return sendJson(
      res,
      502,
      {
        ok: false,

        code,

        message:
          code ===
          'REQUEST_TIMEOUT'

            ? 'انتهت مهلة الاتصال بـ Hugging Face.'

            : 'تعذر الاتصال بخدمة Hugging Face.',

        latencyMs:
          Date.now() -
          started
      }
    );
  }
}


// ============================================================
// VISION
// ============================================================
//
// Vision is intentionally disabled here because support for
// image input depends on the selected Hugging Face model/provider.
// This prevents the old OpenAI code from being called.
// ============================================================

async function handleVision(
  req,
  res,
  body
) {
  return sendJson(
    res,
    501,
    {
      ok: false,

      code:
        'VISION_NOT_CONFIGURED',

      message:
        'تحليل الصور عبر Hugging Face لم يتم تفعيله بعد.'
    }
  );
}


// ============================================================
// CHAT
// ============================================================

async function handleChat(
  req,
  res,
  body
) {
  const apiKey =
    getApiKey(req, body);


  const model =
    typeof body?.model === 'string' &&
    body.model.trim()
      ? body.model.trim()
      : DEFAULT_MODEL;


  const instructions =
    typeof body?.instructions === 'string'
      ? body.instructions
      : '';


  const input =
    typeof body?.input === 'string'
      ? body.input
      : '';


  if (!apiKey) {

    return sendJson(
      res,
      400,
      {
        ok: false,

        code:
          'API_KEY_MISSING',

        message:
          'أدخل Hugging Face Token أولاً.'
      }
    );
  }


  if (!input.trim()) {

    return sendJson(
      res,
      400,
      {
        ok: false,

        code:
          'INPUT_MISSING',

        message:
          'لم يصل نص الرسالة.'
      }
    );
  }


  // ----------------------------------------------------------
  // SSE HEADERS
  // ----------------------------------------------------------

  res.writeHead(
    200,
    {
      'Content-Type':
        'text/event-stream; charset=utf-8',

      'Cache-Control':
        'no-cache, no-store, must-revalidate',

      'Connection':
        'keep-alive',

      'X-Accel-Buffering':
        'no'
    }
  );


  const controller =
    new AbortController();


  const timeout =
    setTimeout(
      () => controller.abort(),
      90000
    );


  req.on(
    'close',
    () => {
      controller.abort();
    }
  );


  try {

    // --------------------------------------------------------
    // BUILD MESSAGES
    // --------------------------------------------------------

    const messages = [];


    if (instructions.trim()) {

      messages.push(
        {
          role: 'system',

          content:
            instructions
        }
      );
    }


    messages.push(
      {
        role: 'user',

        content:
          input
      }
    );


    // --------------------------------------------------------
    // HUGGING FACE STREAM
    // --------------------------------------------------------

    const upstream =
      await fetch(
        HF_URL,
        {
          method: 'POST',

          headers: {
            'Authorization':
              `Bearer ${apiKey}`,

            'Content-Type':
              'application/json'
          },

          body: JSON.stringify(
            {
              model,

              messages,

              stream: true
            }
          ),

          signal:
            controller.signal
        }
      );


    // --------------------------------------------------------
    // ERROR FROM HUGGING FACE
    // --------------------------------------------------------

    if (
      !upstream.ok ||
      !upstream.body
    ) {

      const errorData =
        await upstream
          .json()
          .catch(() => ({}));


      sseWrite(
        res,
        {
          type:
            'error',

          code:
            errorData?.error?.code ||
            'HF_ERROR',

          status:
            upstream.status,

          message:
            errorData?.error?.message ||
            `Hugging Face HTTP ${upstream.status}`
        }
      );


      res.end();

      return;
    }


    // --------------------------------------------------------
    // READ STREAM
    // --------------------------------------------------------

    const reader =
      upstream.body.getReader();


    const decoder =
      new TextDecoder();


    let buffer = '';


    while (true) {

      const {
        done,
        value
      } =
        await reader.read();


      if (done) {
        break;
      }


      buffer +=
        decoder.decode(
          value,
          {
            stream: true
          }
        );


      const lines =
        buffer.split('\n');


      buffer =
        lines.pop() || '';


      for (
        const rawLine of lines
      ) {

        const line =
          rawLine.trimEnd();


        if (
          !line.startsWith(
            'data:'
          )
        ) {
          continue;
        }


        const raw =
          line
            .slice(5)
            .trim();


        if (
          !raw ||
          raw === '[DONE]'
        ) {
          continue;
        }


        try {

          const event =
            JSON.parse(raw);


          // ------------------------------------------------
          // TEXT DELTA
          // ------------------------------------------------

          const delta =
            event
              ?.choices?.[0]
              ?.delta?.content;


          if (
            typeof delta ===
              'string' &&
            delta
          ) {

            sseWrite(
              res,
              {
                type:
                  'delta',

                text:
                  delta
              }
            );
          }


          // ------------------------------------------------
          // STREAM ERROR
          // ------------------------------------------------

          if (
            event?.error
          ) {

            sseWrite(
              res,
              {
                type:
                  'error',

                code:
                  event
                    .error
                    .code ||
                  'MODEL_ERROR',

                message:
                  event
                    .error
                    .message ||
                  'فشل توليد الرد.'
              }
            );
          }


        } catch {

          // Ignore incomplete SSE fragments.

        }
      }
    }


    // --------------------------------------------------------
    // COMPLETE
    // --------------------------------------------------------

    sseWrite(
      res,
      {
        type:
          'completed'
      }
    );


    sseWrite(
      res,
      {
        type:
          'done'
      }
    );


    res.end();


  } catch (err) {

    sseWrite(
      res,
      {
        type:
          'error',

        code:
          err?.name ===
          'AbortError'

            ? 'REQUEST_TIMEOUT'

            : 'REQUEST_FAILED',

        message:
          err?.name ===
          'AbortError'

            ? 'انتهت مهلة الرد أو تم إلغاء الطلب.'

            : 'فقد الاتصال بخدمة Hugging Face.'
      }
    );


    res.end();


  } finally {

    clearTimeout(
      timeout
    );
  }
}


// ============================================================
// HTTP SERVER
// ============================================================

const server =
  http.createServer(
    async (req, res) => {

      const url =
        new URL(
          req.url || '/',
          `http://${req.headers.host || 'localhost'}`
        );


      // ======================================================
      // HEALTH
      // ======================================================

      if (
        req.method === 'GET' &&
        url.pathname ===
          '/api/health'
      ) {

        return sendJson(
          res,
          200,
          {
            ok: true,

            service:
              'JARVIS Web AI Gateway',

            provider:
              'Hugging Face',

            model:
              DEFAULT_MODEL
          }
        );
      }


      // ======================================================
      // INDEX
      // ======================================================

      if (
        req.method === 'GET' &&
        (
          url.pathname === '/' ||
          url.pathname ===
            '/index.html'
        )
      ) {

        const html =
          fs.readFileSync(
            path.join(
              __dirname,
              'index.html'
            )
          );


        res.writeHead(
          200,
          {
            'Content-Type':
              'text/html; charset=utf-8',

            'Cache-Control':
              'no-store'
          }
        );


        return res.end(
          html
        );
      }


      // ======================================================
      // API ROUTES
      // ======================================================

      if (
        req.method === 'POST' &&
        (
          url.pathname ===
            '/api/test' ||

          url.pathname ===
            '/api/chat' ||

          url.pathname ===
            '/api/vision'
        )
      ) {

        try {

          const body =
            await readJson(req);


          if (
            url.pathname ===
              '/api/test'
          ) {

            return await handleTest(
              req,
              res,
              body
            );
          }


          if (
            url.pathname ===
              '/api/vision'
          ) {

            return await handleVision(
              req,
              res,
              body
            );
          }


          return await handleChat(
            req,
            res,
            body
          );


        } catch (err) {

          const message =
            err?.message ===
              'BODY_TOO_LARGE'

              ? 'الطلب كبير جدًا.'

              : 'بيانات الطلب غير صالحة.';


          return sendJson(
            res,
            400,
            {
              ok: false,

              code:
                err?.message ||
                'BAD_REQUEST',

              message
            }
          );
        }
      }


      // ======================================================
      // 404
      // ======================================================

      res.writeHead(
        404,
        {
          'Content-Type':
            'text/plain; charset=utf-8'
        }
      );


      res.end(
        'Not Found'
      );
    }
);


// ============================================================
// START SERVER
// ============================================================

server.listen(
  PORT,
  () => {
    console.log(
      `JARVIS Web AI Gateway running on http://localhost:${PORT}`
    );

    console.log(
      `Provider: Hugging Face`
    );

    console.log(
      `Default model: ${DEFAULT_MODEL}`
    );
  }
);
