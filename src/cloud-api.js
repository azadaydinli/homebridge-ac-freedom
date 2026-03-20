/**
 * AUX Cloud API client
 *
 * Ported from the Python ac_freedom cloud_api module.
 * Handles authentication, device discovery, and parameter get/set
 * via the BroadLink SmartHomeCS cloud infrastructure.
 */

'use strict';

const crypto = require('crypto');
const https = require('https');
const http = require('http');

// ── Crypto constants ─────────────────────────────────────────────
const TIMESTAMP_KEY = 'kdixkdqp54545^#*';
const PASSWORD_SALT = '4969fj#k23#';
const BODY_KEY = 'xgx3d*fe3478$ukx';

const AES_IV = Buffer.from([
  234, 170, 170, 58, 187, 88, 98, 162,
  25, 24, 181, 119, 29, 22, 21, 170,
]);

const LICENSE = 'PAFbJJ3WbvDxH5vvWezXN5BujETtH/iuTtIIW5CE/SeHN7oNKqnEajgljTcL0fBQQWM0XAAAAAAnBhJyhMi7zIQMsUcwR/PEwGA3uB5HLOnr+xRrci+FwHMkUtK7v4yo0ZHa+jPvb6djelPP893k7SagmffZmOkLSOsbNs8CAqsu8HuIDs2mDQAAAAA=';
const LICENSE_ID = '3c015b249dd66ef0f11f9bef59ecd737';
const COMPANY_ID = '48eb1b36cf0202ab2ef07b880ecda60d';
const APP_VERSION = '2.2.10.456537160';
const USER_AGENT = 'Dalvik/2.1.0 (Linux; U; Android 12; SM-G991B Build/SP1A.210812.016)';

// ── API server URLs ──────────────────────────────────────────────
const API_URLS = {
  eu: 'https://app-service-deu-f0e9ebbb.smarthomecs.de',
  usa: 'https://app-service-usa-fd7cc04c.smarthomecs.com',
  cn: 'https://app-service-chn-31a93883.ibroadlink.com',
  rus: 'https://app-service-rus-b8bbc3be.smarthomecs.com',
};

// ── AES CBC encryption with zero padding ─────────────────────────
function encryptAesCbc(iv, key, data) {
  const blockSize = 16;
  const padLen = (blockSize - (data.length % blockSize)) % blockSize;
  const padded = Buffer.concat([data, Buffer.alloc(padLen)]);
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

// ── HTTP request helper ──────────────────────────────────────────
function httpRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === 'https:' ? https : http;

    // Compute Content-Length so the server receives a fixed-length
    // body instead of chunked Transfer-Encoding.
    const bodyBuf = body
      ? (Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8'))
      : null;

    const headers = { ...(options.headers || {}) };
    if (bodyBuf) {
      headers['Content-Length'] = bodyBuf.length;
    }

    const req = mod.request(url, {
      ...options,
      headers,
      rejectUnauthorized: false,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Invalid JSON response: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (bodyBuf) {
      req.end(bodyBuf);
    } else {
      req.end();
    }
  });
}

class AuxCloudAPI {
  constructor(region = 'eu') {
    this.url = API_URLS[region] || API_URLS.eu;
    this.region = region;
    this.loginsession = null;
    this.userid = null;
    this.email = null;
    this.password = null;
  }

  _headers(extra = {}) {
    return {
      'Content-Type': 'application/x-java-serialized-object',
      'licenseId': LICENSE_ID,
      'lid': LICENSE_ID,
      'language': 'en',
      'appVersion': APP_VERSION,
      'User-Agent': USER_AGENT,
      'system': 'android',
      'appPlatform': 'android',
      'loginsession': this.loginsession || '',
      'userid': this.userid || '',
      ...extra,
    };
  }

  async _request(method, endpoint, { headers, body, params } = {}) {
    let url = `${this.url}/${endpoint}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      url += `?${qs}`;
    }
    return httpRequest(url, { method, headers }, body);
  }

  // ── Login ──────────────────────────────────────────────────────
  async login(email, password) {
    this.email = email;
    this.password = password;

    const ts = Date.now() / 1000;
    const shaPw = crypto.createHash('sha1')
      .update(`${password}${PASSWORD_SALT}`)
      .digest('hex');

    const payload = {
      email,
      password: shaPw,
      companyid: COMPANY_ID,
      lid: LICENSE_ID,
    };
    const bodyJson = JSON.stringify(payload);
    const token = crypto.createHash('md5')
      .update(`${bodyJson}${BODY_KEY}`)
      .digest('hex');
    const aesKey = crypto.createHash('md5')
      .update(`${ts}${TIMESTAMP_KEY}`)
      .digest();

    const encrypted = encryptAesCbc(AES_IV, aesKey, Buffer.from(bodyJson));

    const result = await this._request('POST', 'account/login', {
      headers: this._headers({ timestamp: `${ts}`, token }),
      body: encrypted,
    });

    if (result.status === 0) {
      this.loginsession = result.loginsession;
      this.userid = result.userid;
      return true;
    }
    throw new Error(`Login failed: ${JSON.stringify(result)}`);
  }

  // ── Families ───────────────────────────────────────────────────
  async getFamilies() {
    const result = await this._request('POST', 'appsync/group/member/getfamilylist', {
      headers: this._headers(),
    });
    if (result.status === 0) {
      return result.data.familyList || [];
    }
    throw new Error(`Get families failed: ${JSON.stringify(result)}`);
  }

  // ── Devices ────────────────────────────────────────────────────
  async getDevices(familyId) {
    const result = await this._request('POST', 'appsync/group/dev/query?action=select', {
      headers: this._headers({ familyid: familyId }),
      body: '{"pids":[]}',
    });

    if (result.status !== 0) {
      throw new Error(`Get devices failed: ${JSON.stringify(result)}`);
    }

    const devices = result.data?.endpoints || [];

    // Fetch params for each device
    for (const dev of devices) {
      dev.params = {};
      try {
        const params = await this.getDeviceParams(dev);
        if (params) dev.params = params;
      } catch {
        // Ignore param fetch errors on initial load
      }
    }

    return devices;
  }

  // ── Get/Set device params ──────────────────────────────────────
  async _actDeviceParams(device, act, params = [], vals = []) {
    const cookieRaw = JSON.parse(Buffer.from(device.cookie, 'base64').toString());
    const mappedCookie = Buffer.from(JSON.stringify({
      device: {
        id: cookieRaw.terminalid,
        key: cookieRaw.aeskey,
        devSession: device.devSession,
        aeskey: cookieRaw.aeskey,
        did: device.endpointId,
        pid: device.productId,
        mac: device.mac,
      },
    })).toString('base64');

    const ts = Math.floor(Date.now() / 1000);
    const data = {
      directive: {
        header: {
          namespace: 'DNA.KeyValueControl',
          name: 'KeyValueControl',
          interfaceVersion: '2',
          senderId: 'sdk',
          messageId: `${device.endpointId}-${ts}`,
        },
        endpoint: {
          devicePairedInfo: {
            did: device.endpointId,
            pid: device.productId,
            mac: device.mac,
            devicetypeflag: device.devicetypeFlag,
            cookie: mappedCookie,
          },
          endpointId: device.endpointId,
          cookie: {},
          devSession: device.devSession,
        },
        payload: {
          act,
          params,
          vals,
          did: device.endpointId,
        },
      },
    };

    if (params.length === 1 && act === 'get') {
      data.directive.payload.vals = [[{ val: 0, idx: 1 }]];
    }

    const result = await this._request('POST', 'device/control/v2/sdkcontrol', {
      headers: this._headers(),
      body: JSON.stringify(data),
      params: { license: LICENSE },
    });

    const evt = result.event || {};
    const payload = evt.payload || {};
    if (payload.data && evt.header?.name === 'Response') {
      const response = JSON.parse(payload.data);
      const out = {};
      for (let i = 0; i < response.params.length; i++) {
        out[response.params[i]] = response.vals[i][0].val;
      }
      return out;
    }

    throw new Error(`Device param ${act} failed: ${JSON.stringify(result)}`);
  }

  async getDeviceParams(device, params) {
    // Default: fetch all AC params
    if (!params) {
      params = [
        'pwr', 'ac_mode', 'temp', 'envtemp', 'ac_mark',
        'ac_vdir', 'ac_hdir', 'ac_slp', 'ac_health',
        'mldprf', 'ac_clean', 'scrdisp',
      ];
    }
    return this._actDeviceParams(device, 'get', params);
  }

  async setDeviceParams(device, values) {
    const params = Object.keys(values);
    const vals = Object.values(values).map(v => [{ idx: 1, val: v }]);
    return this._actDeviceParams(device, 'set', params, vals);
  }
}

module.exports = { AuxCloudAPI };
