# J.A.R.V.I.S Mark V — Web OpenAI Test

This version keeps the existing Mark V web UI and cognitive/memory code, but replaces direct Gemini browser calls with a small Node.js AI gateway using OpenAI's Responses API.

## Model

Default: `gpt-5.4-mini`

Reasoning is explicitly set to `none` for this speed-first test build.

## Run

Requires Node.js 20+.

```bash
npm start
```

Open `http://localhost:8787`.

## API key

The browser asks for an OpenAI API key. The key is NOT hard-coded into the project and is never placed in the OpenAI URL. It is sent to the local gateway in the request header/body and is not persisted by the server.

## Important

This is a web validation build only. No Android/Gradle/APK files are included or changed here.
