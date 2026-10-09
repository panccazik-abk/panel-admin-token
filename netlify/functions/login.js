import { getStore } from "@netlify/blobs";

const DEFAULT_ADMIN_EMAIL = "panccazik@gmail.com";
const DEFAULT_ADMIN_PASS  = "Menteng10310";
const SESSION_DURATION = 30 * 24 * 60 * 60 * 1000;

export default async (req, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ success: false, message: "Method not allowed" }), { status: 405, headers });

  try {
    const { username, password } = await req.json();
    const store = getStore("panel-data");

    let isValid = (username === DEFAULT_ADMIN_EMAIL && password === DEFAULT_ADMIN_PASS);
    let finalRole = "owner";

    if (!isValid) {
      try {
        const admins = await store.get("admins", { type: "json" }) || [];
        const foundAdmin = admins.find(a => a.username === username && a.password === password);
        if (foundAdmin) { isValid = true; finalRole = foundAdmin.role || "admin"; }
      } catch (e) { console.error("Error cek admins:", e); }
    }

    if (!isValid) {
      return new Response(JSON.stringify({ success: false, message: "Email atau password salah" }), { status: 401, headers });
    }

    if (username === DEFAULT_ADMIN_EMAIL) {
      try {
        let admins = await store.get("admins", { type: "json" }) || [];
        const exists = admins.some(a => a.username === DEFAULT_ADMIN_EMAIL);
        if (!exists) {
          admins.push({ username: DEFAULT_ADMIN_EMAIL, password: DEFAULT_ADMIN_PASS, role: "owner" });
          await store.setJSON("admins", admins);
        }
      } catch (e) { console.error("Gagal auto-register:", e); }
    }

    const randomPart = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const token = btoa(username + ":" + Date.now() + ":" + randomPart);

    let sessions = await store.get("sessions", { type: "json" }) || {};
    sessions[token] = { username, role: finalRole, created_at: Date.now(), expires_at: Date.now() + SESSION_DURATION };

    const now = Date.now();
    for (const t of Object.keys(sessions)) { if (sessions[t].expires_at < now) delete sessions[t]; }
    await store.setJSON("sessions", sessions);

    return new Response(JSON.stringify({ success: true, token, username, role: finalRole }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, message: "Error: " + e.message }), { status: 500, headers });
  }
};

export const config = { path: "/api/login" };
