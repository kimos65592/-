import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8787);

const HF_URL =
  'https://router.huggingface.co/v1/chat/completions';

// ============================================================
// Hugging Face Models
// ============================================================

const MODEL_ALIASES = Object.freeze({
  default:
    'openai/gpt-oss-120b:fastest',

  'gpt-oss':
    'openai/gpt-oss-120b:fastest',

  'deepseek-r1':
    'deepseek-ai/DeepSeek-R1:fastest',

  llama:
    'meta-llama/Llama-3.1-8B-Instruct:fastest',

  glm:
    'zai-org/GLM-5.3:fastest',

  vision:
    'zai-org/GLM-5.3-Flash:baseten'
});

const DEFAULT_MODEL =
  MODEL_ALIASES.default;

const VISION_MODEL =
  MODEL_ALIASES.vision;

// ============================================================
// Limits
// ============================================================

const MAX_BODY =
  8 * 1024 * 1024;

const TEST_TIMEOUT_MS =
  30000;

const CHAT_TIMEOUT_MS =
  120000;

const VISION_TIMEOUT_MS =
  60000;


// ============================================================
// JSON RESPONSE
// ============================================================

function sendJson(
  res,
  status,
  body
) {
  if (res.headersSent) {
    return;
  }

  res.writeHead(
    status,
    {
      'Content-Type':
        'application/json; charset=utf-8',

      'Cache-Control':
        'no-store',

      'X-Content-Type-Options':
        'nosniff'
    }
  );

  res.end(
    JSON.stringify(body)
  );
}


// ============================================================
// API KEY
// ============================================================

function getApiKey(
  req,
  body = {}
) {
  const authorization =
    req.headers.authorization;

  if (
    typeof authorization ===
    'string'
  ) {
    const match =
      authorization.match(
        /^Bearer\s+(.+)$/i
      );

    if (match?.[1]) {
      return match[1].trim();
    }
  }

  if (
    typeof body.apiKey ===
    'string' &&
    body.apiKey.trim()
  ) {
    return body.apiKey.trim();
  }

  // Optional server environment token.
  // Runtime token still has priority.
  if (
    typeof process.env.HF_TOKEN ===
    'string' &&
    process.env.HF_TOKEN.trim()
  ) {
    return process.env.HF_TOKEN.trim();
  }

  return '';
}


// ============================================================
// MODEL NORMALIZATION
// ============================================================

function normalizeModel(
  value,
  options = {}
) {
  const {
    vision = false
  } = options;

  const raw =
    typeof value ===
    'string'
      ? value.trim()
      : '';

  if (!raw) {
    return vision
      ? VISION_MODEL
      : DEFAULT_MODEL;
  }

  const alias =
    MODEL_ALIASES[
      raw.toLowerCase()
    ];

  if (alias) {
    return alias;
  }

  // Existing JARVIS page still sends
  // its old OpenAI model name.
  //
  // Example:
  // gpt-5.4-mini
  //
  // Automatically translate it to
  // the Hugging Face default.

  if (
    /^(gpt-|o[1-9]|o[34]-|chatgpt-)/i
      .test(raw)
  ) {
    return vision
      ? VISION_MODEL
      : DEFAULT_MODEL;
  }

  // Legacy Gemini names.
  if (
    /^gemini[-_]/i.test(raw)
  ) {
    return vision
      ? VISION_MODEL
      : DEFAULT_MODEL;
  }

  // A real Hugging Face model ID
  // normally contains "/".
  //
  // Example:
  // openai/gpt-oss-120b:fastest
  // deepseek-ai/DeepSeek-R1:fastest

  if (
    raw.includes('/')
  ) {
    return raw;
  }

  return vision
    ? VISION_MODEL
    : DEFAULT_MODEL;
}


// ============================================================
// READ JSON BODY
// ============================================================

async function readJson(req) {
  return await new Promise(
    (resolve, reject) => {
      let body = '';
      let settled = false;

      const fail =
        (error) => {
          if (settled) {
            return;
          }

          settled = true;
          reject(error);
        };

      req.on(
        'data',
        (chunk) => {
          body += chunk;

          if (
            Buffer.byteLength(
              body,
              'utf8'
            ) > MAX_BODY
          ) {
            fail(
              new Error(
                'BODY_TOO_LARGE'
              )
            );

            req.destroy();
          }
        }
      );

      req.on(
        'end',
        () => {
          if (settled) {
            return;
          }

          settled = true;

          if (!body.trim()) {
            resolve({});
            return;
          }

          try {
            resolve(
              JSON.parse(body)
            );
          } catch {
            reject(
              new Error(
                'INVALID_JSON'
              )
            );
          }
        }
      );

      req.on(
        'error',
        fail
      );
    }
  );
}


// ============================================================
// ABORT CONTROLLER
// ============================================================

function makeController(
  timeoutMs
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  return {
    controller,
    timer
  };
}


// ============================================================
// HUGGING FACE REQUEST
// ============================================================

async function hfRequest(
  apiKey,
  payload,
  timeoutMs
) {
  if (!apiKey) {
    throw new Error(
      'API_KEY_MISSING'
    );
  }

  const {
    controller,
    timer
  } =
    makeController(
      timeoutMs
    );

  try {
    return await fetch(
      HF_URL,
      {
        method:
          'POST',

        headers: {
          Authorization:
            `Bearer ${apiKey}`,

          'Content-Type':
            'application/json',

          Accept:
            'application/json'
        },

        body:
          JSON.stringify(
            payload
          ),

        signal:
          controller.signal
      }
    );
  } catch (error) {
    if (
      error?.name ===
      'AbortError'
    ) {
      throw new Error(
        'REQUEST_TIMEOUT'
      );
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}


// ============================================================
// READ HF RESPONSE
// ============================================================

async function readUpstreamBody(
  response
) {
  const text =
    await response
      .text()
      .catch(
        () => ''
      );

  let data = null;

  if (text) {
    try {
      data =
        JSON.parse(text);
    } catch {
      data = null;
    }
  }

  return {
    text,
    data
  };
}


// ============================================================
// EXTRACT ERROR
// ============================================================

function upstreamErrorMessage(
  data,
  text,
  fallback
) {
  if (
    typeof data?.error ===
      'string' &&
    data.error.trim()
  ) {
    return data.error.trim();
  }

  if (
    typeof data?.error?.message ===
      'string' &&
    data.error.message.trim()
  ) {
    return data.error.message.trim();
  }

  if (
    typeof data?.message ===
      'string' &&
    data.message.trim()
  ) {
    return data.message.trim();
  }

  if (
    text &&
    text.trim()
  ) {
    return text
      .trim()
      .slice(0, 1000);
  }

  return fallback;
}


// ============================================================
// EXTRACT CHAT TEXT
// ============================================================

function extractChatText(
  data
) {
  const content =
    data
      ?.choices?.[0]
      ?.message?.content;

  if (
    typeof content ===
    'string'
  ) {
    return content;
  }

  if (
    Array.isArray(content)
  ) {
    return content
      .map(
        (part) => {
          if (
            typeof part ===
            'string'
          ) {
            return part;
          }

          return typeof part?.text ===
            'string'
            ? part.text
            : '';
        }
      )
      .join('');
  }

  return '';
}


// ============================================================
// SSE
// ============================================================

function sse(
  res,
  payload
) {
  if (
    res.writableEnded
  ) {
    return;
  }

  res.write(
    `data: ${JSON.stringify(payload)}\n\n`
  );
}


// ============================================================
// OPEN SSE
// ============================================================

function openSse(
  res
) {
  res.writeHead(
    200,
    {
      'Content-Type':
        'text/event-stream; charset=utf-8',

      'Cache-Control':
        'no-cache, no-store, must-revalidate',

      Connection:
        'keep-alive',

      'X-Accel-Buffering':
        'no'
    }
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
    getApiKey(
      req,
      body
    );

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

  const model =
    normalizeModel(
      body?.model
    );

  const started =
    Date.now();

  try {
    const response =
      await hfRequest(
        apiKey,
        {
          model,

          messages: [
            {
              role:
                'user',

              content:
                'Reply with exactly: JARVIS HF CONNECTED'
            }
          ],

          stream:
            false,

          max_tokens:
            32
        },

        TEST_TIMEOUT_MS
      );

    const {
      text,
      data
    } =
      await readUpstreamBody(
        response
      );

    if (
      !response.ok
    ) {
      return sendJson(
        res,
        response.status,
        {
          ok: false,

          provider:
            'huggingface',

          code:
            data?.error?.code ||
            data?.code ||
            'HF_ERROR',

          status:
            response.status,

          model,

          message:
            upstreamErrorMessage(
              data,
              text,
              `Hugging Face HTTP ${response.status}`
            ),

          latencyMs:
            Date.now() -
            started
        }
      );
    }

    return sendJson(
      res,
      200,
      {
        ok: true,

        provider:
          'huggingface',

        model,

        latencyMs:
          Date.now() -
          started,

        response:
          extractChatText(
            data
          ),

        requestId:
          response
            .headers
            .get(
              'x-request-id'
            ) ||
          null
      }
    );

  } catch (error) {
    const code =
      error?.message ||
      'REQUEST_FAILED';

    return sendJson(
      res,
      502,
      {
        ok: false,

        provider:
          'huggingface',

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
// CHAT
// ============================================================

async function handleChat(
  req,
  res,
  body
) {
  const apiKey =
    getApiKey(
      req,
      body
    );

  const input =
    typeof body?.input ===
      'string'

      ? body.input.trim()

      : typeof body?.message ===
          'string'

        ? body.message.trim()

        : '';

  const instructions =
    typeof body?.instructions ===
      'string'

      ? body.instructions.trim()

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

  if (!input) {
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

  const model =
    normalizeModel(
      body?.model
    );

  const messages = [];

  if (
    instructions
  ) {
    messages.push(
      {
        role:
          'system',

        content:
          instructions
      }
    );
  }

  messages.push(
    {
      role:
        'user',

      content:
        input
    }
  );

  openSse(res);

  const {
    controller,
    timer
  } =
    makeController(
      CHAT_TIMEOUT_MS
    );

  const abortUpstream =
    () => {
      if (
        !res.writableEnded
      ) {
        controller.abort();
      }
    };

  res.once(
    'close',
    abortUpstream
  );

  try {
    const upstream =
      await fetch(
        HF_URL,
        {
          method:
            'POST',

          headers: {
            Authorization:
              `Bearer ${apiKey}`,

            'Content-Type':
              'application/json',

            Accept:
              'text/event-stream'
          },

          body:
            JSON.stringify(
              {
                model,

                messages,

                stream:
                  true
              }
            ),

          signal:
            controller.signal
        }
      );

    if (
      !upstream.ok ||
      !upstream.body
    ) {
      const {
        text,
        data
      } =
        await readUpstreamBody(
          upstream
        );

      sse(
        res,
        {
          type:
            'error',

          code:
            data?.error?.code ||
            data?.code ||
            'HF_ERROR',

          status:
            upstream.status,

          message:
            upstreamErrorMessage(
              data,
              text,
              `Hugging Face HTTP ${upstream.status}`
            )
        }
      );

      sse(
        res,
        {
          type:
            'done'
        }
      );

      res.end();

      return;
    }

    const reader =
      upstream
        .body
        .getReader();

    const decoder =
      new TextDecoder(
        'utf-8'
      );

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
            stream:
              true
          }
        );

      const lines =
        buffer.split(
          /\r?\n/
        );

      buffer =
        lines.pop() ||
        '';

      for (
        const rawLine of lines
      ) {
        const line =
          rawLine.trim();

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

        if (!raw) {
          continue;
        }

        if (
          raw ===
          '[DONE]'
        ) {
          continue;
        }

        let event;

        try {
          event =
            JSON.parse(
              raw
            );
        } catch {
          continue;
        }

        if (
          event?.error
        ) {
          const message =
            upstreamErrorMessage(
              event,
              '',
              'فشل توليد الرد.'
            );

          sse(
            res,
            {
              type:
                'error',

              code:
                event
                  ?.error
                  ?.code ||
                'MODEL_ERROR',

              message
            }
          );

          continue;
        }

        const delta =
          event
            ?.choices?.[0]
            ?.delta?.content;

        if (
          typeof delta ===
            'string' &&
          delta
        ) {

          // Custom JARVIS event.
          sse(
            res,
            {
              type:
                'delta',

              text:
                delta
            }
          );

          // OpenAI-compatible event shape
          // for compatibility with the
          // existing JARVIS parser.
          sse(
            res,
            {
              type:
                'response.output_text.delta',

              delta
            }
          );
        }
      }
    }

    sse(
      res,
      {
        type:
          'completed'
      }
    );

    sse(
      res,
      {
        type:
          'response.completed'
      }
    );

    sse(
      res,
      {
        type:
          'done'
      }
    );

    res.end();

  } catch (error) {

    const code =
      error?.name ===
      'AbortError'

        ? 'REQUEST_TIMEOUT'

        : error?.message ||
          'REQUEST_FAILED';

    if (
      !res.writableEnded
    ) {

      sse(
        res,
        {
          type:
            'error',

          code,

          message:
            code ===
            'REQUEST_TIMEOUT'

              ? 'انتهت مهلة الرد أو تم إلغاء الطلب.'

              : 'فقد الاتصال بخدمة Hugging Face.'
        }
      );

      sse(
        res,
        {
          type:
            'done'
        }
      );

      res.end();
    }

  } finally {

    clearTimeout(
      timer
    );

    res.removeListener(
      'close',
      abortUpstream
    );
  }
}


// ============================================================
// IMAGE VALIDATION
// ============================================================

function validateImageDataUrl(
  image
) {
  return (
    typeof image ===
      'string' &&

    /^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i
      .test(image)
  );
}


// ============================================================
// VISION
// ============================================================

async function handleVision(
  req,
  res,
  body
) {
  const apiKey =
    getApiKey(
      req,
      body
    );

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

  const image =
    typeof body?.image ===
      'string'

      ? body.image.trim()

      : '';

  const prompt =
    typeof body?.prompt ===
        'string' &&
      body.prompt.trim()

      ? body.prompt.trim()

      : 'صف ما تراه في الصورة باختصار وبدقة.';

  if (
    !validateImageDataUrl(
      image
    )
  ) {
    return sendJson(
      res,
      400,
      {
        ok: false,

        code:
          'IMAGE_INVALID',

        message:
          'صيغة الصورة غير صالحة. استخدم JPEG أو PNG أو WEBP بصيغة base64 data URL.'
      }
    );
  }

  const model =
    normalizeModel(
      body?.model,
      {
        vision:
          true
      }
    );

  const started =
    Date.now();

  try {

    const response =
      await hfRequest(
        apiKey,
        {
          model,

          messages: [
            {
              role:
                'user',

              content: [
                {
                  type:
                    'text',

                  text:
                    prompt
                },

                {
                  type:
                    'image_url',

                  image_url: {
                    url:
                      image
                  }
                }
              ]
            }
          ],

          stream:
            false,

          max_tokens:
            512
        },

        VISION_TIMEOUT_MS
      );

    const {
      text,
      data
    } =
      await readUpstreamBody(
        response
      );

    if (
      !response.ok
    ) {
      return sendJson(
        res,
        response.status,
        {
          ok: false,

          provider:
            'huggingface',

          code:
            data?.error?.code ||
            data?.code ||
            'HF_ERROR',

          status:
            response.status,

          model,

          message:
            upstreamErrorMessage(
              data,
              text,
              `Hugging Face HTTP ${response.status}`
            ),

          latencyMs:
            Date.now() -
            started
        }
      );
    }

    return sendJson(
      res,
      200,
      {
        ok: true,

        provider:
          'huggingface',

        model,

        latencyMs:
          Date.now() -
          started,

        text:
          extractChatText(
            data
          )
      }
    );

  } catch (error) {

    const code =
      error?.message ||
      'REQUEST_FAILED';

    return sendJson(
      res,
      502,
      {
        ok: false,

        provider:
          'huggingface',

        code,

        message:
          code ===
          'REQUEST_TIMEOUT'

            ? 'انتهت مهلة تحليل الصورة.'

            : 'تعذر تحليل الصورة عبر Hugging Face.',

        latencyMs:
          Date.now() -
          started
      }
    );
  }
}


// ============================================================
// SERVE INDEX
// ============================================================

function serveIndex(
  res
) {
  const indexPath =
    path.join(
      __dirname,
      'index.html'
    );

  if (
    !fs.existsSync(
      indexPath
    )
  ) {
    return sendJson(
      res,
      500,
      {
        ok: false,

        code:
          'INDEX_NOT_FOUND',

        message:
          'index.html غير موجود.'
      }
    );
  }

  const html =
    fs.readFileSync(
      indexPath
    );

  res.writeHead(
    200,
    {
      'Content-Type':
        'text/html; charset=utf-8',

      'Cache-Control':
        'no-store',

      'X-Content-Type-Options':
        'nosniff'
    }
  );

  res.end(
    html
  );
}


// ============================================================
// MODELS ENDPOINT
// ============================================================

function serveModels(
  res
) {
  return sendJson(
    res,
    200,
    {
      ok: true,

      provider:
        'huggingface',

      models:
        {
          ...MODEL_ALIASES
        },

      endpoint:
        HF_URL
    }
  );
}


// ============================================================
// HTTP SERVER
// ============================================================

const server =
  http.createServer(
    async (
      req,
      res
    ) => {

      const url =
        new URL(
          req.url ||
            '/',
          `http://${req.headers.host || 'localhost'}`
        );


      // --------------------------------------------------------
      // HEALTH
      // --------------------------------------------------------

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

            endpoint:
              HF_URL,

            defaultModel:
              DEFAULT_MODEL,

            visionModel:
              VISION_MODEL
          }
        );
      }


      // --------------------------------------------------------
      // MODELS
      // --------------------------------------------------------

      if (
        req.method === 'GET' &&
        url.pathname ===
          '/api/models'
      ) {
        return serveModels(
          res
        );
      }


      // --------------------------------------------------------
      // INDEX
      // --------------------------------------------------------

      if (
        req.method === 'GET' &&
        (
          url.pathname === '/' ||
          url.pathname ===
            '/index.html'
        )
      ) {
        return serveIndex(
          res
        );
      }


      // --------------------------------------------------------
      // API ROUTES
      // --------------------------------------------------------

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
            await readJson(
              req
            );


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
              '/api/chat'
          ) {
            return await handleChat(
              req,
              res,
              body
            );
          }


          return await handleVision(
            req,
            res,
            body
          );

        } catch (error) {

          if (
            res.headersSent
          ) {
            return;
          }


          if (
            error?.message ===
            'BODY_TOO_LARGE'
          ) {
            return sendJson(
              res,
              413,
              {
                ok: false,

                code:
                  'BODY_TOO_LARGE',

                message:
                  'الطلب كبير جدًا.'
              }
            );
          }


          if (
            error?.message ===
            'INVALID_JSON'
          ) {
            return sendJson(
              res,
              400,
              {
                ok: false,

                code:
                  'INVALID_JSON',

                message:
                  'بيانات الطلب ليست JSON صحيحة.'
              }
            );
          }


          return sendJson(
            res,
            400,
            {
              ok: false,

              code:
                error?.message ||
                'BAD_REQUEST',

              message:
                'تعذر قراءة الطلب.'
            }
          );
        }
      }


      // --------------------------------------------------------
      // 404
      // --------------------------------------------------------

      return sendJson(
        res,
        404,
        {
          ok: false,

          code:
            'NOT_FOUND',

          message:
            'المسار غير موجود.'
        }
      );
    }
  );


// ============================================================
// START
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

    console.log(
      `Vision model: ${VISION_MODEL}`
    );
  }
);
