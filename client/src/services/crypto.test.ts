import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('./keyStore', () => ({
  saveSessions: vi.fn().mockResolvedValue(undefined),
  loadSessions: vi.fn().mockResolvedValue(null),
  unlockWithPrf: vi.fn(),
}));

vi.mock('./cryptoCore', () => ({
  fromBase64: vi.fn((s: string) => new Uint8Array([1, 2, 3])),
  toBase64: vi.fn(() => 'AQID'),
  CryptoManager: vi.fn(),
}));

vi.mock('./crypto/sessionStore', () => ({
  loadGroupSession: vi.fn().mockResolvedValue(null),
  saveGroupSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./crypto/groupSession', () => ({
  GroupSession: { fromJSON: vi.fn() },
}));

import { initCrypto, resetCrypto, getIdentityKeys, cryptoService } from './crypto';

describe('crypto service', () => {
  beforeEach(() => {
    resetCrypto();
  });

  it('resetCrypto clears manager state', () => {
    resetCrypto();
    expect(() => getIdentityKeys()).toThrow();
  });

  it('initCrypto is idempotent', async () => {
    const mockKeys = {
      signingKey: {} as CryptoKey,
      publicKeyBytes: new Uint8Array([1, 2, 3]),
      dhKeyPair: {
        privateKey: {} as CryptoKey,
        publicKeyBytes: new Uint8Array([4, 5, 6]),
      },
    };

    await initCrypto(mockKeys, 'derived-key-base64');
    // Second call should skip
    await initCrypto(mockKeys, 'derived-key-base64');
    // No error means idempotent
  });

  it('initCrypto then getIdentityKeys returns keys', async () => {
    const mockKeys = {
      signingKey: {} as CryptoKey,
      publicKeyBytes: new Uint8Array([10, 20, 30]),
      dhKeyPair: {
        privateKey: {} as CryptoKey,
        publicKeyBytes: new Uint8Array([40, 50, 60]),
      },
    };

    await initCrypto(mockKeys, 'key');
    const keys = getIdentityKeys();
    expect(keys.publicKeyBytes).toEqual(new Uint8Array([10, 20, 30]));
  });

  it('ensureChannelSession creates session when none exists', async () => {
    const mockKeys = {
      signingKey: {} as CryptoKey,
      publicKeyBytes: new Uint8Array([1]),
      dhKeyPair: { privateKey: {} as CryptoKey, publicKeyBytes: new Uint8Array([2]) },
    };
    await initCrypto(mockKeys, 'key');
    // Should not throw — creates a new session
    await cryptoService.ensureChannelSession('ch-test', 'user1', 'key');
  });

  it('ensureChannelSession is idempotent', async () => {
    const mockKeys = {
      signingKey: {} as CryptoKey,
      publicKeyBytes: new Uint8Array([1]),
      dhKeyPair: { privateKey: {} as CryptoKey, publicKeyBytes: new Uint8Array([2]) },
    };
    await initCrypto(mockKeys, 'key');
    await cryptoService.ensureChannelSession('ch-idem', 'user1', 'key');
    await cryptoService.ensureChannelSession('ch-idem', 'user1', 'key'); // should skip
  });

  it('resetCrypto then initCrypto works (re-login)', async () => {
    const mockKeys = {
      signingKey: {} as CryptoKey,
      publicKeyBytes: new Uint8Array([1]),
      dhKeyPair: {
        privateKey: {} as CryptoKey,
        publicKeyBytes: new Uint8Array([2]),
      },
    };

    await initCrypto(mockKeys, 'key1');
    resetCrypto();
    expect(() => getIdentityKeys()).toThrow();

    await initCrypto(mockKeys, 'key2');
    expect(getIdentityKeys().publicKeyBytes).toEqual(new Uint8Array([1]));
  });
});
