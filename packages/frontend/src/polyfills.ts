// Polyfill crypto.randomUUID for non-secure contexts (HTTP over IP/LAN).
// Browsers only expose it on HTTPS or http://localhost. RFC4122 v4 fallback.
// IMPORTANT: This file MUST be imported before any module that calls
// crypto.randomUUID() at top level (e.g. zustand store initial state).
if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
  ;(crypto as Crypto & { randomUUID: () => `${string}-${string}-${string}-${string}-${string}` }).randomUUID =
    function randomUUID() {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
      return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}` as `${string}-${string}-${string}-${string}-${string}`;
    };
}
