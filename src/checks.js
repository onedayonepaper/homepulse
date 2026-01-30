import fetch from "node-fetch";
import net from "net";

export async function checkDevice(d) {
  const timeoutMs = d.timeoutMs ?? 1200;

  if (d.type === "http") {
    return await checkHttp(d.url, timeoutMs);
  }
  if (d.type === "tcp") {
    return await checkTcp(d.host, d.port, timeoutMs);
  }

  return { ok: false, message: `Unknown type: ${d.type}`, responseTime: null };
}

async function checkHttp(url, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = Date.now();

  try {
    const r = await fetch(url, { method: "GET", signal: controller.signal });
    const responseTime = Date.now() - startTime;
    clearTimeout(t);
    return { ok: r.ok, message: `HTTP ${r.status}`, responseTime };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, message: `HTTP error: ${e?.name || "ERR"}`, responseTime: null };
  }
}

function checkTcp(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const startTime = Date.now();

    const finish = (ok, message, includeTime = true) => {
      if (done) return;
      done = true;
      const responseTime = includeTime ? Date.now() - startTime : null;
      try { socket.destroy(); } catch {}
      resolve({ ok, message, responseTime });
    };

    socket.setTimeout(timeoutMs);

    socket.once("connect", () => finish(true, `TCP ${host}:${port} OK`, true));
    socket.once("timeout", () => finish(false, `TCP timeout`, false));
    socket.once("error", (e) => finish(false, `TCP error: ${e.code || "ERR"}`, false));

    socket.connect(port, host);
  });
}
