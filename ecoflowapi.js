const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');

// 1. Configurações e Credenciais
const ACCESS_KEY = process.env.ECOFLOW_ACCESS_KEY || 'q70xqKSfH8OKg8Io36ORsyXtpPoeOEy5';
const SECRET_KEY = process.env.ECOFLOW_SECRET_KEY || 'JuG4kMXzpAIlJBpm3d9KM9NJoJFw27vv';
const API_HOSTS = ['api-e.ecoflow.com', 'api-a.ecoflow.com'];
const PORT = Number(process.env.PORT || 18000);
let ACTIVE_API_HOST = null;

function sortAndConcatParams(params) {
  return Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function processValue(prefix, value, output) {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      processValue(`${prefix}[${index}]`, item, output);
    });
    return;
  }

  if (typeof value === 'object') {
    Object.keys(value).forEach((key) => {
      processValue(`${prefix}.${key}`, value[key], output);
    });
    return;
  }

  output.push(`${prefix}=${String(value)}`);
}

function generateQueryParams(data) {
  if (!data || typeof data !== 'object') {
    return '';
  }

  const parts = [];
  Object.keys(data).forEach((key) => {
    processValue(key, data[key], parts);
  });
  parts.sort();
  return parts.join('&');
}

async function parseResponseData(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return {
      code: String(response.status),
      message: 'Non-JSON response from EcoFlow API',
      raw: text,
    };
  }
}

function generateSign(queryString, accessKey, nonce, timestamp, secretKey) {
  let targetStr = `accessKey=${accessKey}&nonce=${nonce}&timestamp=${timestamp}`;
  if (queryString) {
    targetStr = `${queryString}&${targetStr}`;
  }

  return crypto
    .createHmac('sha256', secretKey)
    .update(targetStr)
    .digest('hex');
}

function buildSignedHeaders(queryString, credentials = {}) {
  const timestamp = Date.now().toString();
  const nonce = Math.floor(10000 + Math.random() * 990000).toString();
  const accessKey = String(credentials.accessKey || ACCESS_KEY).trim();
  const secretKey = String(credentials.secretKey || SECRET_KEY).trim();
  const sign = generateSign(queryString, accessKey, nonce, timestamp, secretKey);

  return {
    accessKey,
    nonce,
    timestamp,
    sign,
  };
}

async function callEcoFlow(host, endpoint, params = {}, credentials = {}) {
  const cleanParams = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      cleanParams[k] = String(v);
    }
  }

  const queryString = generateQueryParams(cleanParams);
  const headers = buildSignedHeaders(queryString, credentials);
  const url = `https://${host}/iot-open/sign${endpoint}${queryString ? `?${queryString}` : ''}`;
  const response = await fetch(url, {
    method: 'GET',
    headers,
  });

  const data = await parseResponseData(response);
  return { host, url, data };
}

async function putEcoFlow(host, endpoint, body, credentials = {}) {
  const queryString = generateQueryParams(body || {});
  const headers = buildSignedHeaders(queryString, credentials);
  const url = `https://${host}/iot-open/sign${endpoint}${queryString ? `?${queryString}` : ''}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Type': 'application/json;charset=UTF-8',
    },
    body: JSON.stringify(body),
  });

  const data = await parseResponseData(response);
  return { host, url, data, requestBody: body };
}

async function getDeviceParamsRaw(sn, credentials = {}) {
  const hostsToTry = ACTIVE_API_HOST
    ? [ACTIVE_API_HOST, ...API_HOSTS.filter((h) => h !== ACTIVE_API_HOST)]
    : API_HOSTS;

  for (const host of hostsToTry) {
    try {
      const result = await callEcoFlow(host, '/device/quota/all', { sn }, credentials);
      if (result.data && String(result.data.code) === '0') {
        ACTIVE_API_HOST = host;
        return result;
      }
    } catch (error) {
      // tenta próximo host
    }
  }

  throw new Error('Falha ao obter dados do dispositivo em todos os hosts configurados.');
}

async function listAccountDevicesRaw(credentials = {}) {
  const hostsToTry = ACTIVE_API_HOST
    ? [ACTIVE_API_HOST, ...API_HOSTS.filter((h) => h !== ACTIVE_API_HOST)]
    : API_HOSTS;

  const endpointCandidates = [
    { endpoint: '/device/list', params: { page: 1, size: 100 } },
    { endpoint: '/device/list', params: { pageNum: 1, pageSize: 100 } },
    { endpoint: '/device/all', params: {} },
  ];

  for (const host of hostsToTry) {
    for (const candidate of endpointCandidates) {
      try {
        const result = await callEcoFlow(host, candidate.endpoint, candidate.params, credentials);
        if (result.data && String(result.data.code) === '0') {
          ACTIVE_API_HOST = host;
          return result;
        }
      } catch (error) {
        // tenta proxima combinacao host+endpoint
      }
    }
  }

  throw new Error('Falha ao listar devices da conta em todos os hosts configurados.');
}

function asPositiveNumber(value) {
  const n = Number(value || 0);
  return Math.abs(Number.isFinite(n) ? n : 0);
}

function formatSecondsToHHMMSS(value) {
  const totalSeconds = Number(value);
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return null;
  }

  const safeSeconds = Math.floor(totalSeconds);
  const hours = String(Math.floor(safeSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((safeSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(safeSeconds % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function mapDataToApiResponse(rawData) {
  const acOutItems = rawData?.['powGetAcOutList.powGetAcOutItem'];
  const item1 = Array.isArray(acOutItems) ? acOutItems[0] : 0;
  const item3 = Array.isArray(acOutItems) ? acOutItems[2] : 0;
  const cmsDsgRemTime = Number(rawData?.cmsDsgRemTime || 0);

  return {
    powGetAcIn: Number(rawData?.powGetAcIn || 0),
    batteryperc: Number(rawData?.cmsBattSoc || 0),
    poweroutsum: Number(rawData?.powOutSumW || 0),
    poweroutAc1: asPositiveNumber(item1),
    poweroutAc2: asPositiveNumber(item3),
    powInSumW: Number(rawData?.powInSumW || 0),
    energyBackupEn: Number(rawData?.energyBackupEn || 0),
    cmsMaxChgSoc: Number(rawData?.cmsMaxChgSoc || 0),
    cmsMinDsgSoc: Number(rawData?.cmsMinDsgSoc || 0),
    powGetTypec3: Number(rawData?.powGetTypec3 || 0),
    powGetTypec1: Number(rawData?.powGetTypec1 || 0),
    powGetTypec2: Number(rawData?.powGetTypec2 || 0),
    cmsDsgRemTime,
    cmsDsgRemTimeFmt: formatSecondsToHHMMSS(cmsDsgRemTime),
  };
}

function buildAcPowerPayload(sn, acIndex, state) {
  const params = acIndex === 2
    ? { cfgAc2OutOpen: Boolean(state) }
    : { cfgAcOutOpen: Boolean(state) };

  return {
    sn,
    cmdId: 17,
    cmdFunc: 254,
    dest: 2,
    dirDest: 1,
    dirSrc: 1,
    needAck: true,
    params,
  };
}

async function setAcOutletPower(sn, acIndex, state, credentials = {}) {
  if (!ACTIVE_API_HOST) {
    await getDeviceParamsRaw(sn, credentials);
  }

  const hostsToTry = ACTIVE_API_HOST
    ? [ACTIVE_API_HOST, ...API_HOSTS.filter((h) => h !== ACTIVE_API_HOST)]
    : API_HOSTS;

  let lastResponse = null;
  const payload = buildAcPowerPayload(sn, acIndex, state);

  for (const host of hostsToTry) {
    try {
      const result = await putEcoFlow(host, '/device/quota', payload, credentials);
      lastResponse = result;
      if (result.data && String(result.data.code) === '0') {
        ACTIVE_API_HOST = host;
        return result;
      }
    } catch (error) {
      lastResponse = { host, error: error.message || String(error), payload };
    }
  }

  return lastResponse;
}

function extractBooleanState(input, defaultValue) {
  if (typeof input === 'boolean') {
    return input;
  }
  if (typeof input === 'number') {
    return input !== 0;
  }
  if (typeof input === 'string') {
    const normalized = input.trim().toLowerCase();
    if (['1', 'true', 'on', 'ligar', 'liga'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'off', 'desligar', 'desliga'].includes(normalized)) {
      return false;
    }
  }
  return defaultValue;
}

function collectDevices(node, output) {
  if (!node) {
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((item) => collectDevices(item, output));
    return;
  }

  if (typeof node !== 'object') {
    return;
  }

  const sn = node.sn || node.deviceSn || node.serialNumber || node.serialNo;
  if (sn) {
    const entry = {
      sn: String(sn),
      deviceName: node.deviceName || node.name || null,
      productName: node.productName || node.productType || null,
      online: node.online ?? node.isOnline ?? null,
    };
    const key = JSON.stringify(entry);
    if (!output._seen.has(key)) {
      output._seen.add(key);
      output.list.push(entry);
    }
  }

  Object.values(node).forEach((value) => {
    if (value && typeof value === 'object') {
      collectDevices(value, output);
    }
  });
}

function mapDevicesResponse(data) {
  const output = { list: [], _seen: new Set() };
  collectDevices(data, output);
  return output.list;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) {
        return resolve({});
      }
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) {
        return resolve({});
      }
      try {
        return resolve(JSON.parse(text));
      } catch {
        return reject(new Error('Body JSON invalido.'));
      }
    });
    req.on('error', (error) => reject(error));
  });
}

function pickHeaderValue(headers, keys) {
  for (const key of keys) {
    const value = headers?.[key];
    if (Array.isArray(value)) {
      const validValue = value.find((item) => String(item || '').trim() !== '');
      if (validValue) {
        return String(validValue).trim();
      }
      continue;
    }

    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return '';
}

function getCredentialsFromRequestHeaders(headers) {
  const accessKey = pickHeaderValue(headers, [
    'x-ecoflow-access-key',
    'x-access-key',
    'access-key',
    'access_key',
    'accesskey',
  ]);
  const secretKey = pickHeaderValue(headers, [
    'x-ecoflow-secret-key',
    'x-secret-key',
    'secret-key',
    'secret_key',
    'secretkey',
  ]);

  return {
    accessKey: accessKey || ACCESS_KEY,
    secretKey: secretKey || SECRET_KEY,
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function buildOpenApiSpec(host) {
  const serverUrl = `http://${host || `localhost:${PORT}`}`;
  return {
    openapi: '3.0.3',
    info: {
      title: 'EcoFlow Local API',
      version: '1.0.0',
      description: 'API local para consultar devices EcoFlow e controlar AC1/AC2 por serial number.',
    },
    servers: [{ url: serverUrl }],
    tags: [
      { name: 'Health', description: 'Informacoes e documentacao da API' },
      { name: 'Devices', description: 'Consulta de devices da conta' },
      { name: 'Telemetry', description: 'Leitura de dados do device por serial number' },
      { name: 'Power', description: 'Liga/desliga AC1 e AC2 via payload cmdId/cmdFunc' },
    ],
    components: {
      parameters: {
        AccessKeyHeader: {
          in: 'header',
          name: 'x-ecoflow-access-key',
          required: false,
          schema: { type: 'string' },
          description: 'Access Key opcional. Se ausente, usa ECOFLOW_ACCESS_KEY do ambiente.',
        },
        SecretKeyHeader: {
          in: 'header',
          name: 'x-ecoflow-secret-key',
          required: false,
          schema: { type: 'string' },
          description: 'Secret Key opcional. Se ausente, usa ECOFLOW_SECRET_KEY do ambiente.',
        },
      },
    },
    paths: {
      '/api/devices': {
        get: {
          tags: ['Devices'],
          summary: 'Lista devices da conta',
          description: 'Retorna lista de devices encontrados na conta, incluindo serial number quando disponivel.',
          parameters: [
            { $ref: '#/components/parameters/AccessKeyHeader' },
            { $ref: '#/components/parameters/SecretKeyHeader' },
          ],
          responses: {
            200: {
              description: 'Lista de devices',
            },
          },
        },
      },
      '/api/{sn}/getdata': {
        get: {
          tags: ['Telemetry'],
          summary: 'Retorna dados resumidos do device',
          parameters: [
            {
              in: 'path',
              name: 'sn',
              required: true,
              schema: { type: 'string' },
              description: 'Serial number do device',
            },
            { $ref: '#/components/parameters/AccessKeyHeader' },
            { $ref: '#/components/parameters/SecretKeyHeader' },
          ],
          responses: {
            200: {
              description: 'Dados resumidos',
            },
          },
        },
      },
      '/api/{sn}/getrawdata': {
        get: {
          tags: ['Telemetry'],
          summary: 'Retorna dados brutos do device',
          parameters: [
            {
              in: 'path',
              name: 'sn',
              required: true,
              schema: { type: 'string' },
              description: 'Serial number do device',
            },
            { $ref: '#/components/parameters/AccessKeyHeader' },
            { $ref: '#/components/parameters/SecretKeyHeader' },
          ],
          responses: {
            200: {
              description: 'Dados brutos da EcoFlow',
            },
          },
        },
      },
      '/api/{sn}/power/ac1': {
        post: {
          tags: ['Power'],
          summary: 'Liga ou desliga AC1',
          description: 'Usa payload com cmdId=17, cmdFunc=254 e params.cfgAcOutOpen.',
          parameters: [
            {
              in: 'path',
              name: 'sn',
              required: true,
              schema: { type: 'string' },
              description: 'Serial number do device',
            },
            { $ref: '#/components/parameters/AccessKeyHeader' },
            { $ref: '#/components/parameters/SecretKeyHeader' },
          ],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    state: { type: 'boolean', description: 'true liga, false desliga' },
                    on: { type: 'boolean', description: 'Alias para state' },
                  },
                },
                examples: {
                  ligar: { value: { state: true } },
                  desligar: { value: { state: false } },
                },
              },
            },
          },
          responses: {
            200: { description: 'Comando aceito pela EcoFlow' },
            502: { description: 'Falha no comando para EcoFlow' },
          },
        },
      },
      '/api/{sn}/power/ac2': {
        post: {
          tags: ['Power'],
          summary: 'Liga ou desliga AC2',
          description: 'Usa payload com cmdId=17, cmdFunc=254 e params.cfgAc2OutOpen.',
          parameters: [
            {
              in: 'path',
              name: 'sn',
              required: true,
              schema: { type: 'string' },
              description: 'Serial number do device',
            },
            { $ref: '#/components/parameters/AccessKeyHeader' },
            { $ref: '#/components/parameters/SecretKeyHeader' },
          ],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    state: { type: 'boolean', description: 'true liga, false desliga' },
                    on: { type: 'boolean', description: 'Alias para state' },
                  },
                },
                examples: {
                  ligar: { value: { state: true } },
                  desligar: { value: { state: false } },
                },
              },
            },
          },
          responses: {
            200: { description: 'Comando aceito pela EcoFlow' },
            502: { description: 'Falha no comando para EcoFlow' },
          },
        },
      },
    },
  };
}

function buildSwaggerHtml() {
  return `<!doctype html>
<html lang="pt-br">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>EcoFlow API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; background: #f6f8fb; }
    .top-note {
      font-family: Arial, sans-serif;
      padding: 12px 16px;
      background: #0f172a;
      color: #e2e8f0;
      font-size: 14px;
    }
    .swagger-ui .topbar { display: none; }
  </style>
</head>
<body>
  <div class="top-note">EcoFlow Local API - Documentacao Swagger</div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      displayRequestDuration: true,
      docExpansion: 'list',
    });
  </script>
</body>
</html>`;
}

function buildApiHelp() {
  return {
    message: 'EcoFlow REST API local for Delta 3 Max Plus',
    endpoints: [
      'GET /api/devices',
      'GET /api/{SN}/getdata',
      'GET /api/{SN}/getrawdata',
      'POST /api/{SN}/power/ac1',
      'POST /api/{SN}/power/ac2',
    ],
    examples: {
      listDevices: 'curl http://localhost:' + PORT + '/api/devices',
      getData: 'curl http://localhost:' + PORT + '/api/SERIAL_NUMBER/getdata',
      getRawData: 'curl http://localhost:' + PORT + '/api/SERIAL_NUMBER/getrawdata',
      getDataWithHeaders: 'curl http://localhost:' + PORT + '/api/SERIAL_NUMBER/getdata -H "x-ecoflow-access-key: YOUR_ACCESS_KEY" -H "x-ecoflow-secret-key: YOUR_SECRET_KEY"',
      powerOffAc1: 'curl -X POST http://localhost:' + PORT + '/api/SERIAL_NUMBER/power/ac1 -H "Content-Type: application/json" -d "{\"state\":false}"',
      powerOffAc2: 'curl -X POST http://localhost:' + PORT + '/api/SERIAL_NUMBER/power/ac2 -H "Content-Type: application/json" -d "{\"state\":false}"',
      powerOnAc1: 'curl -X POST http://localhost:' + PORT + '/api/SERIAL_NUMBER/power/ac1 -H "Content-Type: application/json" -d "{\"state\":true}"',
      powerOnAc2: 'curl -X POST http://localhost:' + PORT + '/api/SERIAL_NUMBER/power/ac2 -H "Content-Type: application/json" -d "{\"state\":true}"',
    },
    dockerComposeExample: [
      'services:',
      '  ecoflow-api:',
      '    image: asabino2/ecoflowdelta3maxplusapi',
      '    container_name: ecoflow-api',
      '    restart: unless-stopped',
      '    ports:',
      '      - "18000:18000"',
      '    environment:',
      '      PORT: "18000"',
      '      ECOFLOW_ACCESS_KEY: "YOUR_ACCESS_KEY"',
      '      ECOFLOW_SECRET_KEY: "YOUR_SECRET_KEY"',
    ].join('\n'),
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', `http://localhost:${PORT}`);
    const path = requestUrl.pathname;
    const credentials = getCredentialsFromRequestHeaders(req.headers || {});

    if (req.method === 'GET' && path === '/') {
      return sendHtml(res, 200, buildSwaggerHtml());
    }

    if (req.method === 'GET' && path === '/openapi.json') {
      return sendJson(res, 200, buildOpenApiSpec(req.headers.host));
    }

    if (req.method === 'GET' && path === '/api/devices') {
      const devicesRaw = await listAccountDevicesRaw(credentials);
      return sendJson(res, 200, {
        count: mapDevicesResponse(devicesRaw.data || {}).length,
        devices: mapDevicesResponse(devicesRaw.data || {}),
        ecoflow: devicesRaw.data || {},
      });
    }

    const dataMatch = path.match(/^\/api\/([^/]+)\/getdata$/);
    if (req.method === 'GET' && dataMatch) {
      const sn = decodeURIComponent(dataMatch[1]);
      const raw = await getDeviceParamsRaw(sn, credentials);
      return sendJson(res, 200, mapDataToApiResponse(raw.data?.data || {}));
    }

    const rawDataMatch = path.match(/^\/api\/([^/]+)\/getrawdata$/);
    if (req.method === 'GET' && rawDataMatch) {
      const sn = decodeURIComponent(rawDataMatch[1]);
      const raw = await getDeviceParamsRaw(sn, credentials);
      return sendJson(res, 200, raw.data || {});
    }

    const powerAc1Match = path.match(/^\/api\/([^/]+)\/power\/ac1$/);
    if (req.method === 'POST' && powerAc1Match) {
      const sn = decodeURIComponent(powerAc1Match[1]);
      const body = await readJsonBody(req);
      const state = extractBooleanState(body?.state ?? body?.on, false);
      const result = await setAcOutletPower(sn, 1, state, credentials);
      const ok = result?.data && String(result.data.code) === '0';
      return sendJson(res, ok ? 200 : 502, {
        endpoint: `/api/${sn}/power/ac1`,
        action: state ? 'on' : 'off',
        payload: buildAcPowerPayload(sn, 1, state),
        success: Boolean(ok),
        ecoflow: result,
      });
    }

    const powerAc2Match = path.match(/^\/api\/([^/]+)\/power\/ac2$/);
    if (req.method === 'POST' && powerAc2Match) {
      const sn = decodeURIComponent(powerAc2Match[1]);
      const body = await readJsonBody(req);
      const state = extractBooleanState(body?.state ?? body?.on, false);
      const result = await setAcOutletPower(sn, 2, state, credentials);
      const ok = result?.data && String(result.data.code) === '0';
      return sendJson(res, ok ? 200 : 502, {
        endpoint: `/api/${sn}/power/ac2`,
        action: state ? 'on' : 'off',
        payload: buildAcPowerPayload(sn, 2, state),
        success: Boolean(ok),
        ecoflow: result,
      });
    }

    return sendJson(res, 404, { error: 'Not Found' });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || String(error) });
  }
});

server.listen(PORT, () => {
  const help = buildApiHelp();
  console.log(`EcoFlow REST API local iniciada em http://localhost:${PORT}`);
  console.log('Endpoints: ' + help.endpoints.join(', '));
  console.log('Exemplos de chamada:');
  console.log('- ' + help.examples.listDevices);
  console.log('- ' + help.examples.getData);
  console.log('- ' + help.examples.getRawData);
  console.log('- ' + help.examples.getDataWithHeaders);
  console.log('- ' + help.examples.powerOffAc1);
  console.log('- ' + help.examples.powerOffAc2);
  console.log('- ' + help.examples.powerOnAc1);
  console.log('- ' + help.examples.powerOnAc2);
  console.log('Exemplo docker-compose:');
  console.log(help.dockerComposeExample);
});
