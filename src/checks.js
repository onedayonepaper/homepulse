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

  return { ok: false, message: `Unknown type: ${d.type}` };
}

async function checkHttp(url, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url, { method: "GET", signal: controller.signal });
    clearTimeout(t);
    return { ok: r.ok, message: `HTTP ${r.status}` };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, message: `HTTP error: ${e?.name || "ERR"}` };
  }
}

function checkTcp(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (ok, message) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch {}
      resolve({ ok, message });
    };

    socket.setTimeout(timeoutMs);

    socket.once("connect", () => finish(true, `TCP ${host}:${port} OK`));
    socket.once("timeout", () => finish(false, `TCP timeout`));
    socket.once("error", (e) => finish(false, `TCP error: ${e.code || "ERR"}`));

    socket.connect(port, host);
  });
}
