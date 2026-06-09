const http = require('http');
const https = require('https');

const API_KEY = process.env.GRSAI_API_KEY || 'sk-0e668ba71f634dfd8527ae7af5ffda34';
const GRSAI_HOST = process.env.GRSAI_HOST || 'grsai.dakka.com.cn';
const GRSAI_PATH = '/v1/draw/nano-banana';
const PORT = process.env.PORT || 3000;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function grsaiRequest(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = {
      hostname: GRSAI_HOST,
      path: GRSAI_PATH,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        const lines = raw.trim().split('\n');
        const last = lines[lines.length - 1];
        try { resolve(JSON.parse(last.replace(/^data: /, ''))); }
        catch { reject(new Error('parse fail: ' + raw.substring(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const modelMap = {
  'nano-banana-pro': 'nano-banana-pro',
  'nano-banana-2': 'nano-banana-2',
  'gemini-3-pro-image-preview': 'nano-banana-pro',
  'gemini-3.1-flash-image-preview': 'nano-banana-2',
  'Nano Banana Pro': 'nano-banana-pro',
  'Nano Banana 2': 'nano-banana-2',
  'nano_banana_pro': 'nano-banana-pro',
  'nano_banana_pro-4K': 'nano-banana-pro',
};

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.end(); return; }

  log(`收到请求: ${req.method} ${req.url}`);

  if (req.method !== 'POST') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }

  let buf = '';
  req.on('data', c => buf += c);
  req.on('end', async () => {
    try {
      const body = JSON.parse(buf);

      let model, prompt, urls = [];
      const isGemini = body.contents || req.url.includes('v1beta');

      if (isGemini) {
        const modelRaw = body.model || '';
        model = modelRaw.replace(/^models\//, '') || 'nano-banana-2';
        const parts = body.contents?.[0]?.parts || [];
        prompt = parts.find(p => p.text)?.text || '';
        const inline = parts.find(p => p.inlineData);
        if (inline) {
          urls = [`data:${inline.inlineData.mimeType};base64,${inline.inlineData.data}`];
        }
      } else {
        model = body.model;
        prompt = body.prompt;
        if (body.urls?.length > 0) urls = body.urls;
        else if (body.image_url) urls = [body.image_url];
      }

      const grsaiModel = modelMap[model] || model || 'nano-banana-2';
      log(`模型: ${model} -> ${grsaiModel}, prompt: ${(prompt||'').substring(0,50)}, urls: ${urls.length}`);

      const reqBody = {
        model: grsaiModel,
        prompt,
        imageSize: '4K',
        aspectRatio: '1:1',
        replyType: 'json',
      };
      if (urls.length > 0) reqBody.urls = urls;

      const result = await grsaiRequest(reqBody);

      if (result.status === 'succeeded' && result.results?.length > 0) {
        const outputUrls = result.results.map(r => r.url);
        if (isGemini) {
          const imgData = await new Promise((resolve) => {
            https.get(outputUrls[0], (r) => {
              const chunks = [];
              r.on('data', c => chunks.push(c));
              r.on('end', () => {
                const b64 = Buffer.concat(chunks).toString('base64');
                resolve({ mime: r.headers['content-type'] || 'image/png', data: b64 });
              });
              r.on('error', () => resolve(null));
            }).on('error', () => resolve(null));
          });
          if (imgData) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              candidates: [{ content: { parts: [{ inlineData: { mimeType: imgData.mime, data: imgData.data } }] } }],
            }));
            return;
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          created: Math.floor(Date.now() / 1000),
          data: outputUrls.map(u => ({ url: u })),
        }));
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: result.error || `失败: ${result.status}` }));
      }
    } catch (e) {
      log('错误: ' + e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(PORT, () => {
  log(`GrsAI proxy 启动在端口 ${PORT}`);
});
