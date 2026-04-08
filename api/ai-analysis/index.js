module.exports = async function (context, req) {
  if (req.method !== 'POST') {
    context.res = { status: 405, body: 'Method not allowed' };
    return;
  }

  const AZURE_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || '';
  const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || '';
  const API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview';
  const API_KEY = process.env.AZURE_OPENAI_API_KEY || '';

  if (!API_KEY || !AZURE_ENDPOINT || !DEPLOYMENT) {
    context.res = { status: 500, body: 'Server misconfigured — missing Azure OpenAI settings' };
    return;
  }

  try {
    const { messages, temperature, max_tokens, response_format } = req.body;

    const url = `${AZURE_ENDPOINT}openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': API_KEY,
      },
      body: JSON.stringify({ messages, temperature, max_tokens, response_format }),
    });

    if (!response.ok) {
      const errText = await response.text();
      context.res = { status: response.status, body: errText };
      return;
    }

    const result = await response.json();
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: result,
    };
  } catch (err) {
    context.res = { status: 500, body: `Proxy error: ${err.message}` };
  }
};
