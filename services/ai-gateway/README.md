# Heka AI Gateway

This Cloudflare Worker replaces the local OmniRoute Docker container for the Heka demo. It keeps `GROQ_API_KEY` in Cloudflare's encrypted secret store and exposes only the structured-planning endpoint Heka needs.

## Deploy

```powershell
cd services/ai-gateway
npm install
npx wrangler login
npx wrangler secret put GROQ_API_KEY
npm run deploy
```

Copy the resulting `https://…workers.dev` URL into `VITE_HEKA_AI_GATEWAY_URL` before building Heka. Do not commit a key or a `.dev.vars` file.

This is a hackathon gateway, not an authentication system. Before a public launch, add user authentication and rate limiting.
