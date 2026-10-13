# سيرفر الصوت العصبي لـ JARVIS

هذا المجلد يحتوي على واجهة JARVIS المعدّلة وسيرفر TTS وسيط. مفتاح ElevenLabs يبقى في إعدادات استضافة السيرفر ولا يُحفظ داخل HTML.

## 1) إنشاء صوت JARVIS خاص بك

في ElevenLabs افتح Voice Design وأنشئ صوتاً جديداً بوصف قريب من التالي. الهدف صوت أصلي مستوحى من أسلوب المساعد السينمائي، وليس نسخاً مطابقاً لصوت ممثل أو شخصية محمية:

> A distinctive original adult male AI assistant voice. Deep, warm baritone, controlled and composed, exceptionally clear diction, calm confidence, precise consonants, measured pace, subtle smooth synthetic resonance, restrained emotion, polished cinematic presence. Fluent clear Modern Standard Arabic and natural international/British English pronunciation. Avoid exaggerated bass, robotic distortion, or imitation of any existing actor or fictional character.

استمع إلى المعاينات واختر الأنسب، ثم احفظ الصوت في مكتبتك وانسخ **Voice ID**. قد تختلف جودة العربية بين الأصوات؛ اختبر نصاً عربياً وإنجليزياً قبل اعتماد الصوت.

## 2) نشر السيرفر

ارفع `server.js` و`package.json` إلى مستودع GitHub خاص بالمشروع، ثم أنشئ Web Service على منصة استضافة Node.js تدعم متغيرات البيئة.

- Build command: `npm install`
- Start command: `npm start`
- Runtime: Node.js 20 أو أحدث

أضف متغير البيئة السري:

- `ELEVENLABS_API_KEY` = مفتاح API من حسابك في ElevenLabs
- `ALLOWED_ORIGINS` = أصل موقع الواجهة، مثل `https://USERNAME.github.io` (اكتب الأصل فقط بلا مسار المشروع). يمكن تركه فارغاً أثناء الاختبار، لكن الأفضل تحديد الأصل الدقيق بعد النشر.

لا تضع مفتاح ElevenLabs في HTML أو في مستودع GitHub.

بعد النشر اختبر `https://YOUR-SERVER/api/health`. يجب أن ترى JSON يحتوي `ok: true` و`configured: true`.

## 3) توصيل الواجهة

افتح ملف `Jarvis_HF_AI_Assistant_LiveVoice.html`، ثم إعدادات جارفس:

- رابط سيرفر TTS: `https://YOUR-SERVER`
- Voice ID: المعرّف الذي حفظته في ElevenLabs
- نموذج النطق: ابدأ بـ `Multilingual v2` للعربية والإنجليزية، ثم جرّب Flash v2.5 إذا أردت سرعة أعلى وكان مناسباً لصوتك.

اضغط **حفظ والتطبيق** ثم **اختبار صوت جارفس**. ستُنطق الرسائل النصية والصوتية بصوت TTS، والجمل تُرسل بالتتابع أثناء توليد رد النموذج.

## ملاحظات

- استخدام ElevenLabs قد يستهلك الرصيد/الحد الشهري لحسابك؛ راجع لوحة الاستخدام لديهم.
- السيرفر يحدّ النص إلى 4500 حرف لكل طلب ويطبّق تحديداً أولياً للمعدل (40 طلباً لكل 10 دقائق لكل عنوان IP).
- CORS ليس بديلاً كاملاً عن حماية الاستخدام؛ اضبط `ALLOWED_ORIGINS` على عنوان واجهتك الفعلي، وراقب الاستهلاك.
- هذا السيرفر يمرّر صوت ElevenLabs إلى المتصفح؛ لا يخزن نصوص المحادثة أو الملفات الصوتية.
