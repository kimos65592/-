import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(v => v.trim()).filter(Boolean);

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(cors({
  origin(origin, callback) {
    // Set ALLOWED_ORIGINS in deployment for the exact GitHub Pages/custom-domain origin.
    // No Origin is commonly used by health checks and server-to-server requests.
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by this TTS server.'), false);
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'jarvis-tts', provider: 'ElevenLabs', configured: Boolean(ELEVENLABS_API_KEY) });
});

app.use('/api/tts', rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many TTS requests. Please wait a few minutes.' }
}));

app.post('/api/tts', async (req, res) => {
  if (!ELEVENLABS_API_KEY) {
    return res.status(503).json({ error: 'Server is missing ELEVENLABS_API_KEY environment variable.' });
  }

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const voiceId = typeof req.body?.voiceId === 'string' ? req.body.voiceId.trim() : '';
  const requestedModel = typeof req.body?.modelId === 'string' ? req.body.modelId : 'eleven_multilingual_v2';
  const modelId = ['eleven_multilingual_v2', 'eleven_flash_v2_5'].includes(requestedModel)
    ? requestedModel : 'eleven_multilingual_v2';
  const speed = Number(req.body?.speed || 0.96);

  if (!text) return res.status(400).json({ error: 'Text is required.' });
  if (text.length > 4500) return res.status(413).json({ error: 'Text is too long. Maximum 4500 characters per request.' });
  if (!voiceId || voiceId.length > 160) return res.status(400).json({ error: 'A valid ElevenLabs Voice ID is required.' });

  try {
    const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_22050_32`, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: 0.58,
          similarity_boost: 0.78,
          style: 0.22,
          use_speaker_boost: true,
          speed: Math.max(0.85, Math.min(1.15, Number.isFinite(speed) ? speed : 0.96))
        }
      })
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      return res.status(upstream.status).json({ error: `ElevenLabs request failed (${upstream.status}).`, detail: detail.slice(0, 1200) });
    }

    res.status(200);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    for await (const chunk of upstream.body) {
      if (res.destroyed) break;
      res.write(Buffer.from(chunk));
    }
    if (!res.destroyed) res.end();
  } catch (error) {
    console.error('TTS proxy error:', error?.message || error);
    if (!res.headersSent) res.status(502).json({ error: 'TTS provider connection failed.' });
    else res.destroy(error);
  }
});

app.use((err, _req, res, _next) => {
  if (err?.message?.includes('Origin is not allowed')) return res.status(403).json({ error: err.message });
  console.error('Server error:', err?.message || err);
  res.status(500).json({ error: 'Internal TTS server error.' });
});

app.listen(PORT, () => console.log(`JARVIS TTS server listening on port ${PORT}`));
