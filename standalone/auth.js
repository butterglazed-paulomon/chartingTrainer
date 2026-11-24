import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

const COOKIE = "ct_session";

const b64url = (s) => Buffer.from(s).toString("base64url");
const sign = (secret, body) => createHmac("sha256", secret).update(body).digest("base64url");

export function createAuth({ facultyPin, secret }) {
  const pin = Buffer.from(String(facultyPin ?? ""));

  function checkPin(given) {
    const g = Buffer.from(String(given ?? ""));
    if (!pin.length || g.length !== pin.length) return false;
    return timingSafeEqual(g, pin);
  }

  function makeCookie(role, studentId = null, studentName = null) {
    const body = b64url(JSON.stringify({ role, studentId, studentName, exp: Date.now() + 12 * 3600 * 1000 }));
    return `${COOKIE}=${body}.${sign(secret, body)}; HttpOnly; SameSite=Lax; Path=/`;
  }

  function sessionFrom(req) {
    const raw = String(req.headers.cookie ?? "").split(";").map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
    if (!raw) return null;
    const token = raw.slice(COOKIE.length + 1);
    const dot = token.lastIndexOf(".");
    if (dot < 0) return null;
    const body = token.slice(0, dot);
    const mac = token.slice(dot + 1);
    const expected = sign(secret, body);
    const a = Buffer.from(mac), b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const s = JSON.parse(Buffer.from(body, "base64url").toString());
      if (typeof s.exp !== "number" || s.exp < Date.now()) return null;
      return s;
    } catch { return null; }
  }

  return {
    checkPin,
    cookieHeader: makeCookie,
    sessionFrom,
    newSecret: () => randomBytes(32).toString("hex"),
  };
}
