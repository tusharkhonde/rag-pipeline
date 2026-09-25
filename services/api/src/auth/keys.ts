import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { calculateJwkThumbprint, type JWK } from 'jose';

export interface SigningKey {
  kid: string;
  privateKey: KeyObject;
  publicJwk: JWK;
}

/**
 * Load the RS256 signing key, generating and persisting one on first run (dev convenience:
 * the key lives in a Docker volume so tokens survive restarts). In production the private key
 * would come from a secret manager / KMS and never touch disk in plaintext.
 *
 * kid = RFC 7638 thumbprint of the public key: stable, derived from the key itself, and lets
 * verifiers pick the right key from the JWKS during a rotation (old + new published together).
 */
export async function loadSigningKey(dir: string): Promise<SigningKey> {
  const file = path.join(dir, 'jwt-signing-key.pem');
  let pem: string;
  try {
    pem = await readFile(file, 'utf8');
  } catch {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    await mkdir(dir, { recursive: true });
    await writeFile(file, pem, { mode: 0o600 });
  }
  const privateKey = createPrivateKey(pem);
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' }) as JWK;
  const kid = await calculateJwkThumbprint(jwk);
  return { kid, privateKey, publicJwk: { ...jwk, kid, alg: 'RS256', use: 'sig' } };
}
