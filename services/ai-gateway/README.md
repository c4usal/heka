# Heka AI Gateway

Cloudflare Worker that holds planner provider secrets and exposes Heka's structured-planning endpoint. Inspired by open search agents like [Scira](https://github.com/zaidmukaddam/scira), it gathers free DuckDuckGo + Wikipedia context before calling the LLM.

## Provider order

1. **OpenAI** (`OPENAI_API_KEY`) — primary
2. **Groq** (`GROQ_API_KEY`) — fallback on retryable failures
3. **Gemini** (`GEMINI_API_KEY`) — optional tertiary fallback

## Deploy

```powershell
cd services/ai-gateway
npm install
npx wrangler login
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GROQ_API_KEY
# optional
npx wrangler secret put GEMINI_API_KEY
npm run deploy
```

Optional vars in `wrangler.jsonc`:

- `OPENAI_MODEL` (default `gpt-4.1-mini`)
- `GROQ_MODEL` (default `openai/gpt-oss-120b`)

Copy the resulting `https://…workers.dev` URL into `VITE_HEKA_AI_GATEWAY_URL` if you override the built-in gateway. Do not commit keys or a `.dev.vars` file.

This is a hackathon gateway, not an authentication system. Before a public launch, add user authentication and rate limiting.
