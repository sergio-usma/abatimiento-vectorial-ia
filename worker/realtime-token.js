/* Cloudflare Worker: entrega claves efímeras de la API Realtime de OpenAI.
 *
 * La clave real vive solo aquí, como secreto del Worker (nunca en el repositorio ni en GitHub Pages).
 * El navegador pide una clave que caduca en ~60 s y la usa para abrir la llamada WebRTC.
 *
 * Despliegue (ver README.md):
 *   cd worker
 *   npx wrangler secret put OPENAI_API_KEY
 *   npx wrangler deploy
 * y pon la URL resultante en js/config.js -> tokenEndpoint.
 */
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const originOk = allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': originOk ? origin : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!originOk) return json({ error: 'origin_not_allowed' }, 403);
    if (!env.OPENAI_API_KEY) return json({ error: 'server_not_configured' }, 500);

    const r = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.OPENAI_API_KEY,
        'Content-Type': 'application/json',
        // Identificador opaco por cliente para que OpenAI pueda atribuir abusos sin datos personales.
        'OpenAI-Safety-Identifier': await sha256(request.headers.get('CF-Connecting-IP') || 'anon')
      },
      body: JSON.stringify({
        expires_after: { anchor: 'created_at', seconds: 60 },
        session: {
          type: 'realtime',
          model: env.MODEL || 'gpt-realtime',
          audio: { output: { voice: env.VOICE || 'marin' } }
        }
      })
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.value) return json({ error: (data.error && data.error.message) || 'openai_error' }, 502);
    return json({ value: data.value, expires_at: data.expires_at });
  }
};

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
