/**
 * Autenticação do painel.
 * - Senhas: PBKDF2-SHA256, 100 000 iterações, sal aleatório de 16 bytes.
 * - Sessões: token aleatório de 32 bytes no cookie __Host-phs (HttpOnly, Secure, SameSite=Strict);
 *   na base de dados só fica o SHA-256 do token.
 */

export type User = { id: number; email: string; name: string; role: 'admin' | 'member'; status: string; created_at: string; last_login_at: string | null };

const ITER = 100_000;
const COOKIE = '__Host-phs';
const SESSION_DAYS = 30;
const enc = new TextEncoder();

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function pbkdf2(password: string, salt: Uint8Array, iter: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${ITER}$${b64(salt)}$${b64(await pbkdf2(password, salt, ITER))}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [alg, iter, salt, hash] = stored.split('$');
  if (alg !== 'pbkdf2-sha256' || !iter || !salt || !hash) return false;
  const got = new Uint8Array(await pbkdf2(password, unb64(salt), Number(iter)));
  const want = unb64(hash);
  return got.length === want.length && crypto.subtle.timingSafeEqual(got, want);
}

/** Valida a senha nova: 8+ caracteres, com letras e números. */
export function weakPassword(pw: string) {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 200) return 'A senha precisa de pelo menos 8 caracteres.';
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return 'Use letras e números na senha.';
  return null;
}

export const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

export function randomToken(bytes = 32) {
  return b64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createSession(db: D1Database, userId: number, request: Request) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await db
    .prepare('INSERT INTO sessions (token_hash, user_id, expires_at, ip, ua) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(token), userId, expires, request.headers.get('CF-Connecting-IP'), (request.headers.get('User-Agent') || '').slice(0, 200))
    .run();
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`;
}

function readToken(request: Request) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
}

export async function getUser(db: D1Database, request: Request): Promise<User | null> {
  const token = readToken(request);
  if (!token || token.length > 100) return null;
  return db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.status, u.created_at, u.last_login_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'`,
    )
    .bind(await sha256(token), new Date().toISOString())
    .first<User>();
}

export async function destroySession(db: D1Database, request: Request) {
  const token = readToken(request);
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
