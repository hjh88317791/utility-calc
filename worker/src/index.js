const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

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

async function checkAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token || !env.ADMIN_PASSWORD) return false;
  const expected = await sha256('admin_token:' + env.ADMIN_PASSWORD);
  return token === expected;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);
    const path = url.pathname;

    /* ---------- 管理员登录 ---------- */
    if (path === '/api/admin/login' && request.method === 'POST') {
      try {
        const { password } = await request.json();
        if (!env.ADMIN_PASSWORD) return json({ error: '服务器未配置 ADMIN_PASSWORD' }, 500);
        if (password !== env.ADMIN_PASSWORD) return json({ error: '密码错误' }, 401);
        const token = await sha256('admin_token:' + password);
        return json({ token });
      } catch {
        return json({ error: '请求格式错误' }, 400);
      }
    }

    /* ---------- 管理员房间管理 ---------- */
    if (path.startsWith('/api/admin/')) {
      if (!await checkAdmin(request, env)) return json({ error: '未授权' }, 401);

      // 房间列表
      if (path === '/api/admin/rooms' && request.method === 'GET') {
        const list = await getRoomsList(env);
        return json({ rooms: list });
      }

      // 创建房间
      if (path === '/api/admin/rooms' && request.method === 'POST') {
        try {
          const { code, note } = await request.json();
          if (!/^[A-Za-z0-9]{4,16}$/.test(code)) return json({ error: '房间码需 4~16 位字母或数字' }, 400);
          const upperCode = code.toUpperCase();
          const list = await getRoomsList(env);
          if (list.find(r => r.code === upperCode)) return json({ error: '房间码已存在' }, 400);
          await env.ROOMS.put('room:' + upperCode, JSON.stringify({
            exists: true, updatedAt: Date.now(), history: []
          }));
          list.push({ code: upperCode, note: note || '', createdAt: Date.now() });
          await saveRoomsList(env, list);
          return json({ ok: true });
        } catch {
          return json({ error: '请求格式错误' }, 400);
        }
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
            room.note = note || '';
            await saveRoomsList(env, list);
            return json({ ok: true });
          } catch {
            return json({ error: '请求格式错误' }, 400);
          }
        }
      }

      return json({ error: 'Not Found' }, 404);
    }

    /* ---------- 房间数据接口（公开） ---------- */
    const m = path.match(/^\/api\/room\/([A-Za-z0-9]{4,16})$/);
    if (!m) return new Response('Not Found', { status: 404, headers: cors });

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
        headers: { ...cors, 'Content-Type': 'application/json' }
      });
    }

    if (request.method === 'PUT') {
      const body = await request.text();
      try { JSON.parse(body); } catch { return json({ error: 'Invalid JSON' }, 400); }
      await env.ROOMS.put(key, body);
      return json({ ok: true });
    }

    return json({ error: 'Method Not Allowed' }, 405);
  }
};