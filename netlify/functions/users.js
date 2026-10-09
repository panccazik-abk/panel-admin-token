import { getStore } from "@netlify/blobs";

function hitungSisaHari(expiry) {
  if (!expiry) return 0;
  try {
    let targetDate;
    if (expiry.includes("/")) {
      const [d, m, y] = expiry.split("/").map(x => parseInt(x));
      targetDate = new Date(y, m - 1, d);
    } else {
      targetDate = new Date(expiry);
    }
    if (isNaN(targetDate.getTime())) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    targetDate.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((targetDate - today) / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
  } catch { return 0; }
}

function autoUpdateStatus(user) {
  if (!user) return user;
  if (user.status === "locked") return user;
  const sisa = hitungSisaHari(user.expiry);
  user.sisa_hari = sisa;
  if (sisa <= 0) user.status = "expired";
  else if (user.status === "expired") user.status = "active";
  return user;
}

async function verifyToken(req) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return false;
  try {
    const store = getStore("panel-data");
    const sessions = await store.get("sessions", { type: "json" }) || {};
    const s = sessions[token];
    return s && s.expires_at >= Date.now();
  } catch { return false; }
}

export default async (req, context) => {
  const store = getStore("panel-data");
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const method = req.method;

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };

  if (method === "OPTIONS") return new Response(null, { status: 204, headers });

  try {
    // ===== ENDPOINT PUBLIK =====
    if (method === "GET" && action === "config") {
      const config = await store.get("config", { type: "json" }) || {};
      return new Response(JSON.stringify({ success: true, config }), { status: 200, headers });
    }

    // VERIFY (support GET & POST) - auto register HWID
    if ((method === "GET" || method === "POST") && action === "verify") {
      let username, password, hwid;
      if (method === "GET") {
        username = url.searchParams.get("username");
        password = url.searchParams.get("password");
        hwid = url.searchParams.get("hwid");
      } else {
        const body = await req.json();
        username = body.username;
        password = body.password;
        hwid = body.hwid;
      }

      if (!username || !hwid) {
        return new Response(JSON.stringify({ success: false, message: "Isi username & device ID" }), { status: 400, headers });
      }

      const users = await store.get("users", { type: "json" }) || {};
      const config = await store.get("config", { type: "json" }) || {};
      const user = users[username];

      if (!user) {
        return new Response(JSON.stringify({ success: false, message: "User tidak ditemukan", code: "NOT_FOUND" }), { status: 404, headers });
      }
      if (password && user.password !== password) {
        return new Response(JSON.stringify({ success: false, message: "Password salah", code: "WRONG_PASS" }), { status: 401, headers });
      }
      if (config.maintenance === true) {
        return new Response(JSON.stringify({ success: false, message: config.maintenance_msg || "Server maintenance.", code: "MAINTENANCE" }), { status: 503, headers });
      }
      if (user.status === "locked") {
        return new Response(JSON.stringify({ success: false, message: "Akun diblokir", code: "LOCKED" }), { status: 403, headers });
      }

      const sisa = hitungSisaHari(user.expiry);
      if (sisa <= 0) {
        return new Response(JSON.stringify({ success: false, message: "Akun expired", code: "EXPIRED" }), { status: 403, headers });
      }

      // AUTO-REGISTER HWID
      user.hwids = user.hwids || {};
      const hwidList = Object.keys(user.hwids);
      const maxDev = user.max_devices ?? 1;

      if (hwidList.includes(hwid)) {
        user.hwids[hwid].last_seen = new Date().toISOString();
        user.hwids[hwid].username = username;
      } else if (hwidList.length < maxDev) {
        user.hwids[hwid] = { registered_at: new Date().toISOString(), last_seen: new Date().toISOString(), username };
      } else {
        return new Response(JSON.stringify({ success: false, message: "Device limit tercapai. Hubungi admin.", code: "HWID_LIMIT" }), { status: 403, headers });
      }

      users[username] = user;
      await store.setJSON("users", users);

      let messages = await store.get("messages", { type: "json" }) || [];
      const userMsgs = messages.filter(m => m.target === "all" || m.target === username).slice(-1)[0];

      return new Response(JSON.stringify({
        success: true,
        message: "Login berhasil",
        user: { username, expiry: user.expiry, sisa_hari: sisa, max_devices: maxDev, note: user.note || "" },
        broadcast: userMsgs || null
      }), { status: 200, headers });
    }

    // STATUS
    if (method === "GET" && action === "status") {
      const username = url.searchParams.get("username");
      const hwid = url.searchParams.get("hwid");

      if (!username || !hwid) {
        return new Response(JSON.stringify({ success: false, message: "Isi username & hwid" }), { status: 400, headers });
      }

      const users = await store.get("users", { type: "json" }) || {};
      const config = await store.get("config", { type: "json" }) || {};
      const user = users[username];

      if (!user) return new Response(JSON.stringify({ success: false, message: "User tidak ditemukan", code: "NOT_FOUND" }), { status: 404, headers });
      if (config.maintenance === true) return new Response(JSON.stringify({ success: false, message: config.maintenance_msg || "Maintenance", code: "MAINTENANCE" }), { status: 503, headers });
      if (user.status === "locked") return new Response(JSON.stringify({ success: false, message: "Akun diblokir", code: "LOCKED" }), { status: 403, headers });

      const sisa = hitungSisaHari(user.expiry);
      if (sisa <= 0) return new Response(JSON.stringify({ success: false, message: "Akun expired", code: "EXPIRED" }), { status: 403, headers });

      user.hwids = user.hwids || {};
      const hwidList = Object.keys(user.hwids);
      const maxDev = user.max_devices ?? 1;

      if (hwidList.includes(hwid)) {
        user.hwids[hwid].last_seen = new Date().toISOString();
      } else if (hwidList.length < maxDev) {
        user.hwids[hwid] = { registered_at: new Date().toISOString(), last_seen: new Date().toISOString(), username };
      } else {
        return new Response(JSON.stringify({ success: false, message: "Device limit tercapai.", code: "HWID_LIMIT" }), { status: 403, headers });
      }

      users[username] = user;
      await store.setJSON("users", users);

      let messages = await store.get("messages", { type: "json" }) || [];
      const userMsgs = messages.filter(m => m.target === "all" || m.target === username).slice(-1)[0];

      return new Response(JSON.stringify({
        success: true, sisa_hari: sisa, expiry: user.expiry, broadcast: userMsgs || null
      }), { status: 200, headers });
    }

    // ===== ENDPOINT ADMIN =====
    const isAuth = await verifyToken(req);
    if (!isAuth) {
      return new Response(JSON.stringify({ success: false, message: "Unauthorized." }), { status: 401, headers });
    }

    if (method === "GET" && action === "list") {
      let users = await store.get("users", { type: "json" }) || {};
      let changed = false;
      for (const username of Object.keys(users)) {
        const before = JSON.stringify({ s: users[username].status, h: users[username].sisa_hari });
        users[username] = autoUpdateStatus(users[username]);
        const after = JSON.stringify({ s: users[username].status, h: users[username].sisa_hari });
        if (before !== after) changed = true;
      }
      if (changed) await store.setJSON("users", users);
      return new Response(JSON.stringify({ success: true, users }), { status: 200, headers });
    }

    if (method === "GET" && action === "admins") {
      const admins = await store.get("admins", { type: "json" }) || [{ username: "panccazik@gmail.com", role: "owner" }];
      return new Response(JSON.stringify({ success: true, admins }), { status: 200, headers });
    }

    if (method === "POST" && action === "reset-hwid") {
      const username = url.searchParams.get("username");
      const users = await store.get("users", { type: "json" }) || {};
      if (!users[username]) throw new Error("User tidak ditemukan");
      users[username].hwids = {};
      await store.setJSON("users", users);
      return new Response(JSON.stringify({ success: true, message: "Device direset" }), { status: 200, headers });
    }

    if (method === "POST") {
      const body = await req.json();

      if (body.action === "connect-device") {
        const users = await store.get("users", { type: "json" }) || {};
        const user = users[body.username];
        if (!user) throw new Error("User tidak ditemukan");
        if (!body.hwid) throw new Error("HWID kosong");
        user.hwids = user.hwids || {};
        user.hwids[body.hwid] = { registered_at: new Date().toISOString(), last_seen: new Date().toISOString(), username: body.username };
        users[body.username] = user;
        await store.setJSON("users", users);
        return new Response(JSON.stringify({ success: true, message: "Device terhubung" }), { status: 200, headers });
      }

      if (body.action === "save-config") {
        await store.setJSON("config", {
          admin_url: body.admin_url || "",
          app_name: body.app_name || "",
          version: body.version || "",
          maintenance: !!body.maintenance,
          maintenance_msg: body.maintenance_msg || "",
          auto_extend: parseInt(body.auto_extend) || 0,
          preview_url: body.preview_url || "",
          updated_at: new Date().toISOString()
        });
        return new Response(JSON.stringify({ success: true, message: "Config disimpan" }), { status: 200, headers });
      }

      if (body.action === "remove-hwid") {
        const users = await store.get("users", { type: "json" }) || {};
        if (!users[body.username]) throw new Error("User tidak ditemukan");
        if (users[body.username].hwids) delete users[body.username].hwids[body.hwid];
        await store.setJSON("users", users);
        return new Response(JSON.stringify({ success: true, message: "Device dihapus" }), { status: 200, headers });
      }

      if (body.action === "add-admin") {
        let admins = await store.get("admins", { type: "json" }) || [{ username: "panccazik@gmail.com", role: "owner" }];
        if (!body.username || !body.password) throw new Error("Email & password wajib diisi");
        if (admins.find(a => a.username === body.username)) throw new Error("Admin sudah ada");
        admins.push({ username: body.username, password: body.password, role: "admin" });
        await store.setJSON("admins", admins);
        return new Response(JSON.stringify({ success: true, message: "Admin ditambah" }), { status: 200, headers });
      }

      if (body.action === "remove-admin") {
        let admins = await store.get("admins", { type: "json" }) || [];
        admins = admins.filter(a => a.username !== body.username);
        await store.setJSON("admins", admins);
        return new Response(JSON.stringify({ success: true, message: "Admin dihapus" }), { status: 200, headers });
      }

      if (body.action === "auto-extend") {
        const users = await store.get("users", { type: "json" }) || {};
        const days = parseInt(body.days) || 30;
        let count = 0;
        for (const [username, data] of Object.entries(users)) {
          if (data.status !== "active" || !data.expiry) continue;
          let targetDate;
          if (data.expiry.includes("/")) {
            const [d, m, y] = data.expiry.split("/").map(x => parseInt(x));
            targetDate = new Date(y, m - 1, d);
          } else {
            targetDate = new Date(data.expiry);
          }
          targetDate.setDate(targetDate.getDate() + days);
          const dd = String(targetDate.getDate()).padStart(2, "0");
          const mm = String(targetDate.getMonth() + 1).padStart(2, "0");
          const yy = targetDate.getFullYear();
          users[username].expiry = `${dd}/${mm}/${yy}`;
          users[username].sisa_hari = hitungSisaHari(users[username].expiry);
          users[username].last_update = new Date().toISOString();
          count++;
        }
        await store.setJSON("users", users);
        return new Response(JSON.stringify({ success: true, message: `${count} user diperpanjang`, count }), { status: 200, headers });
      }

      const { username, password, expiry, status, note } = body;
      if (!username) throw new Error("Username wajib diisi");

      const users = await store.get("users", { type: "json" }) || {};
      const sisaOtomatis = hitungSisaHari(expiry);

      let finalStatus = status || "active";
      if (finalStatus !== "locked") {
        finalStatus = sisaOtomatis > 0 ? "active" : "expired";
      }

      users[username] = {
        password: password || username,
        expiry: expiry || "",
        sisa_hari: sisaOtomatis,
        max_devices: body.max_devices ?? 1,
        status: finalStatus,
        note: note || "",
        hwids: users[username]?.hwids || {},
        last_update: new Date().toISOString()
      };

      await store.setJSON("users", users);
      return new Response(JSON.stringify({ success: true, message: "User disimpan", user: users[username] }), { status: 200, headers });
    }

    if (method === "DELETE") {
      const username = url.searchParams.get("username");
      const users = await store.get("users", { type: "json" }) || {};
      delete users[username];
      await store.setJSON("users", users);
      return new Response(JSON.stringify({ success: true, message: "User dihapus" }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ success: false, message: "Action tidak valid" }), { status: 400, headers });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, message: e.message }), { status: 500, headers });
  }
};

export const config = { path: "/api/users" };
