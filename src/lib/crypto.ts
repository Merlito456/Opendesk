// Real WebCrypto ECDH P-256 + AES-256-GCM + SHA-256 identity & E2E session security

const STORAGE_KEYPAIR = 'opendesk_identity_keypair_v1';

const SAS_WORDS = [
  'amber', 'birch', 'cedar', 'delta', 'ember', 'frost', 'grove', 'haven',
  'ivory', 'jasper', 'kestrel', 'lumen', 'maple', 'north', 'olive', 'prism',
  'quartz', 'river', 'slate', 'timber', 'umbra', 'verve', 'willow', 'zenith',
  'anchor', 'beacon', 'canyon', 'drift', 'flint', 'harbor', 'island', 'meadow',
];

export interface IdentityKeys {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
  fingerprint: string;
}

function bufferToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function computeKeyFingerprint(jwk: JsonWebKey): Promise<string> {
  const canonical = `${jwk.kty}:${jwk.crv}:${jwk.x}:${jwk.y}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const hex = bufferToHex(digest).slice(0, 16);
  return hex.match(/.{1,4}/g)?.join(' · ') ?? hex;
}

export async function loadOrCreateIdentityKeys(storage: Storage = localStorage): Promise<IdentityKeys> {
  try {
    const saved = storage.getItem(STORAGE_KEYPAIR);
    if (saved) {
      const parsed = JSON.parse(saved) as { publicJwk: JsonWebKey; privateJwk: JsonWebKey };
      const publicKey = await crypto.subtle.importKey(
        'jwk',
        parsed.publicJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
      );
      const privateKey = await crypto.subtle.importKey(
        'jwk',
        parsed.privateJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey', 'deriveBits']
      );
      const fingerprint = await computeKeyFingerprint(parsed.publicJwk);
      return { publicKey, privateKey, publicKeyJwk: parsed.publicJwk, fingerprint };
    }
  } catch {
    // Regenerate if storage corrupted
  }

  return regenerateIdentityKeys(storage);
}

export async function regenerateIdentityKeys(storage: Storage = localStorage): Promise<IdentityKeys> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  storage.setItem(
    STORAGE_KEYPAIR,
    JSON.stringify({ publicJwk: publicKeyJwk, privateJwk: privateKeyJwk })
  );
  const fingerprint = await computeKeyFingerprint(publicKeyJwk);
  return {
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    publicKeyJwk,
    fingerprint,
  };
}

export async function deriveSessionSecurity(
  myPrivateKey: CryptoKey,
  peerPublicKeyJwk: JsonWebKey
): Promise<{ aesKey: CryptoKey; sasCode: string; sasPhrase: string }> {
  const peerPublicKey = await crypto.subtle.importKey(
    'jwk',
    peerPublicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    myPrivateKey,
    256
  );

  const sasDigest = await crypto.subtle.digest('SHA-256', sharedBits);
  const sasBytes = new Uint8Array(sasDigest);
  const numCode =
    ((sasBytes[0] << 16) | (sasBytes[1] << 8) | sasBytes[2]) % 1_000_000;
  const sasCode = numCode.toString().padStart(6, '0');

  const words = [
    SAS_WORDS[sasBytes[3] % SAS_WORDS.length],
    SAS_WORDS[sasBytes[4] % SAS_WORDS.length],
    SAS_WORDS[sasBytes[5] % SAS_WORDS.length],
    SAS_WORDS[sasBytes[6] % SAS_WORDS.length],
  ];
  const sasPhrase = words.join('-');

  const aesKey = await crypto.subtle.importKey(
    'raw',
    sasDigest,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  return { aesKey, sasCode, sasPhrase };
}

export async function encryptPayload(
  aesKey: CryptoKey,
  payload: unknown
): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const ctBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, encoded);
  return {
    iv: bufferToBase64(iv.buffer),
    ct: bufferToBase64(ctBuf),
  };
}

export async function decryptPayload<T = unknown>(
  aesKey: CryptoKey,
  packet: { iv: string; ct: string }
): Promise<T> {
  const iv = new Uint8Array(base64ToBuffer(packet.iv));
  const ct = base64ToBuffer(packet.ct);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct);
  return JSON.parse(new TextDecoder().decode(plainBuf)) as T;
}

export async function hashPasscode(passcode: string): Promise<string> {
  const normalized = passcode.trim();
  if (!normalized) return '';
  const data = new TextEncoder().encode(`opendesk-unattended-v1:${normalized}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(digest);
}

export async function sha256Buffer(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return bufferToHex(digest).toLowerCase();
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  return bufferToBase64(buf);
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  return base64ToBuffer(b64);
}
