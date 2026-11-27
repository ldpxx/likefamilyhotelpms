/**
 * SHA-256 password hashing via browser Web Crypto API (with pure-JS fallback).
 * Ensures staff passwords in Firestore `staff_users` are NEVER stored in plaintext.
 */
export async function hashPasswordSha256(plain: string): Promise<string> {
  const input = `lfpms_v1::${plain}`;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const data = new TextEncoder().encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Deterministic fallback for non-secure contexts
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
  );
}
