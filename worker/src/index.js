const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const MAX_BODY_BYTES = 512 * 1024;      // 房间数据上限 512KB
const MAX_HISTORY = 200;                // 历史记录上限
const MAX_TOMBSTONES = 400;             // 删除墓碑上限
const MAX_ENTRY_BYTES = 8000;           // 单条历史记录上限
const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000; // 管理员 token 有效期 7 天
const LOGIN_RATE_LIMIT = 10;            // 登录限流：每窗口最多 10 次
const LOGIN_RATE_WINDOW_SEC = 300;      // 限流窗口 5 分钟

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' }
  });
}

async function getRoomsList(env) {
  const raw = await env.ROOMS.get('admin:rooms');
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function saveRoomsList(env, list) {
  await env.ROOMS.put('admin:rooms', JSON.stringify(list));
}

function bearerToken(request) {
  const auth = request.headers.get('Authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

/* token 格式：<签发时间戳>.<sha256('admin_token:'+密码+':'+时间戳)>，7 天有效 */
async function makeAdminToken(password) {
  const ts = Date.now();
  const sig = await sha256('admin_token:' + password + ':' + ts);
  return ts + '.' + sig;
}

async function checkAdmin(request, env) {
  const token = bearerToken(request);
  if (!token || !env.ADMIN_PASSWORD) return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const ts = Number(token.slice(0, dot));
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > TOKEN_TTL_MS) return false;
  const expected = await sha256('admin_token:' + env.ADMIN_PASSWORD + ':' + ts);
  return token.slice(dot + 1) === expected;
}

/* 基于 KV 的简单限流（最终一致性，防爆破够用，非精确计数） */
async function rateLimit(env, key, limit, windowSec) {
  try {
    const cur = await env.ROOMS.get(key, 'json');
    const count = cur && typeof cur.count === 'number' ? cur.count : 0;
    if (count >= limit) return false;
    await env.ROOMS.put(key, JSON.stringify({ count: count + 1 }), { expirationTtl: windowSec });
    return true;
  } catch {
    return true; // 限流存储异常时不阻塞主流程
  }
}

/* ---------- 房间数据结构白名单校验（防垃圾数据/超大字段） ---------- */
function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function sanitizeReadings(r, withFees) {
  const src = (r && typeof r === 'object') ? r : {};
  const out = {
    lastA: str(src.lastA, 20), currentA: str(src.currentA, 20),
    lastB: str(src.lastB, 20), currentB: str(src.currentB, 20)
  };
  if (withFees) {
    out.fees = [];
    if (Array.isArray(src.fees)) {
      out.fees = src.fees.slice(0, 50).map(f => ({
        op: (f && f.op === '-') ? '-' : '+',
        amount: str(f && f.amount, 20)
      }));
    }
  }
  return out;
}

function sanitizeHistoryEntry(e) {
  if (!e || typeof e !== 'object') return null;
  if (typeof e.id !== 'string' || !e.id) return null;
  if (e.type !== 'electricity' && e.type !== 'water') return null;
  try {
    if (JSON.stringify(e).length > MAX_ENTRY_BYTES) return null;
  } catch { return null; }
  return {
    id: e.id.slice(0, 64),
    type: e.type,
    timestamp: Number.isFinite(e.timestamp) ? e.timestamp : Date.now(),
    period: str(e.period, 80),
    input: (e.input && typeof e.input === 'object') ? e.input : {},
    result: (e.result && typeof e.result === 'object') ? e.result : {}
  };
}

function sanitizeRoomData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const out = {
    exists: true,
    updatedAt: Number.isFinite(data.updatedAt) ? data.updatedAt : Date.now(),
    nicknameA: str(data.nicknameA, 50),
    nicknameB: str(data.nicknameB, 50),
    periodStart: str(data.periodStart, 20),
    periodEnd: str(data.periodEnd, 20),
    waterPrice: str(data.waterPrice, 20),
    electricity: sanitizeReadings(data.electricity, true),
    water: sanitizeReadings(data.water, false),
    history: [],
    deletedIds: []
  };
  if (Array.isArray(data.history)) {
    out.history = data.history
      .slice(0, MAX_HISTORY)
      .map(sanitizeHistoryEntry)
      .filter(Boolean);
  }
  if (Array.isArray(data.deletedIds)) {
    out.deletedIds = data.deletedIds
      .filter(id => typeof id === 'string' && id)
      .slice(-MAX_TOMBSTONES)
      .map(id => id.slice(0, 64));
  }
  return out;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);
    const path = url.pathname;

    /* ---------- 管理员登录（带限流） ---------- */
    if (path === '/api/admin/login' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      if (!await rateLimit(env, 'rl:login:' + ip, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_SEC)) {
        return json({ error: '尝试过于频繁，请 5 分钟后再试' }, 429);
      }
      try {
        const { password } = await request.json();
        if (!env.ADMIN_PASSWORD) return json({ error: '服务器未配置 ADMIN_PASSWORD' }, 500);
        if (password !== env.ADMIN_PASSWORD) return json({ error: '密码错误' }, 401);
        const token = await makeAdminToken(password);
        return json({ token });
      } catch {
        return json({ error: '请求格式错误' }, 400);
      }
    }

    /* ---------- 管理员房间管理 ---------- */
    if (path.startsWith('/api/admin/')) {
      if (!await checkAdmin(request, env)) return json({ error: '未授权或登录已过期' }, 401);

      // 房间列表
      if (path === '/api/admin/rooms' && request.method === 'GET') {
        const list = await getRoomsList(env);
        return json({ rooms: list });
      }

      // 创建房间
      if (path === '/api/admin/rooms' && request.method === 'POST') {
        let body;
        try { body = await request.json(); } catch { return json({ error: '请求格式错误' }, 400); }
        const { code, note } = body || {};
        if (!/^[A-Za-z0-9]{4,16}$/.test(code || '')) return json({ error: '房间码需 4~16 位字母或数字' }, 400);
        const upperCode = code.toUpperCase();
        const list = await getRoomsList(env);
        if (list.find(r => r.code === upperCode)) return json({ error: '房间码已存在' }, 400);
        await env.ROOMS.put('room:' + upperCode, JSON.stringify({
          exists: true, updatedAt: Date.now(), history: [], deletedIds: []
        }));
        list.push({ code: upperCode, note: str(note, 100), createdAt: Date.now() });
        try {
          await saveRoomsList(env, list);
        } catch (e) {
          // 列表写入失败时回滚房间数据，避免产生无法管理的孤儿房间
          await env.ROOMS.delete('room:' + upperCode).catch(() => {});
          return json({ error: '创建失败，请重试' }, 500);
        }
        return json({ ok: true });
      }

      const m = path.match(/^\/api\/admin\/rooms\/([A-Za-z0-9]{4,16})$/);
      if (m) {
        const code = m[1].toUpperCase();
        const list = await getRoomsList(env);
        const room = list.find(r => r.code === code);
        if (!room) return json({ error: '房间不存在' }, 404);

        // 删除房间
        if (request.method === 'DELETE') {
          const newList = list.filter(r => r.code !== code);
          await saveRoomsList(env, newList);
          await env.ROOMS.delete('room:' + code);
          return json({ ok: true });
        }

        // 修改备注
        if (request.method === 'PUT') {
          try {
            const { note } = await request.json();
            room.note = str(note, 100);
            await saveRoomsList(env, list);
            return json({ ok: true });
          } catch {
            return json({ error: '请求格式错误' }, 400);
          }
        }
      }

      return json({ error: 'Not Found' }, 404);
    }

    /* ---------- 房间数据接口（公开，但做结构校验与大小限制） ---------- */
    const m = path.match(/^\/api\/room\/([A-Za-z0-9]{4,16})$/);
    if (!m) return json({ error: 'Not Found' }, 404);

    const code = m[1].toUpperCase();
    const key = 'room:' + code;

    // 只允许进入管理员创建过的房间
    const list = await getRoomsList(env);
    if (!list.find(r => r.code === code)) {
      return json({ exists: false, message: '房间不存在或未开放，请联系管理员' });
    }

    if (request.method === 'GET') {
      const data = await env.ROOMS.get(key);
      return new Response(data || JSON.stringify({ exists: true }), {
        headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    }

    if (request.method === 'PUT') {
      const contentLength = Number(request.headers.get('Content-Length') || 0);
      if (contentLength > MAX_BODY_BYTES) return json({ error: '数据过大' }, 413);
      const body = await request.text();
      if (body.length > MAX_BODY_BYTES) return json({ error: '数据过大' }, 413);
      let data;
      try { data = JSON.parse(body); } catch { return json({ error: 'Invalid JSON' }, 400); }
      const clean = sanitizeRoomData(data);
      if (!clean) return json({ error: '数据结构不合法' }, 400);
      await env.ROOMS.put(key, JSON.stringify(clean));
      return json({ ok: true });
    }

    return json({ error: 'Method Not Allowed' }, 405);
  }
};
