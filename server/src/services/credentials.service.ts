import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { BuiltInProvider, ProviderCredentials, CredentialsStatus, AutoLoginMethod } from '@fsf/shared';

const DATA_DIR = path.resolve(import.meta.dirname, '../../../data');
const CREDENTIALS_FILE = path.join(DATA_DIR, 'credentials.json');
const KEY_FILE = path.join(DATA_DIR, '.credentials-key');

// Encryption algorithm
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/**
 * Get or create the encryption key
 */
function getEncryptionKey(): Buffer {
  if (fs.existsSync(KEY_FILE)) {
    return Buffer.from(fs.readFileSync(KEY_FILE, 'utf-8'), 'hex');
  }

  // Generate a new key
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 });
  return key;
}

/**
 * Encrypt a string
 */
function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Return iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a string
 */
function decrypt(encryptedData: string): string {
  const key = getEncryptionKey();
  const parts = encryptedData.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

interface StoredCredentials {
  [provider: string]: {
    email?: string;
    username?: string;
    encryptedPassword?: string;
    autoLoginMethod?: AutoLoginMethod;
    lastUpdated?: string;
  };
}

/**
 * Load credentials from disk
 */
function loadCredentials(): StoredCredentials {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf-8'));
}

/**
 * Save credentials to disk
 */
function saveCredentials(credentials: StoredCredentials): void {
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), { mode: 0o600 });
}

/**
 * Credentials service for secure storage of provider login credentials
 */
export const credentialsService = {
  /**
   * Save credentials for a provider
   */
  saveCredentials(
    provider: BuiltInProvider,
    credentials: ProviderCredentials
  ): void {
    const stored = loadCredentials();

    stored[provider] = {
      email: credentials.email,
      username: credentials.username,
      encryptedPassword: credentials.password ? encrypt(credentials.password) : undefined,
      lastUpdated: new Date().toISOString()
    };

    saveCredentials(stored);
  },

  /**
   * Get full credentials for a provider (including password - for internal use only)
   */
  getCredentials(provider: BuiltInProvider): ProviderCredentials | null {
    const stored = loadCredentials();
    const cred = stored[provider];

    if (!cred) return null;

    let password: string | undefined;
    if (cred.encryptedPassword) {
      password = decrypt(cred.encryptedPassword);
    }

    return {
      email: cred.email,
      username: cred.username,
      password,
      lastUpdated: cred.lastUpdated
    };
  },

  /**
   * Get credentials status (no password - safe for API)
   */
  getCredentialsStatus(provider: BuiltInProvider, autoLoginEnabled: boolean, autoLoginMethod?: AutoLoginMethod): CredentialsStatus {
    const stored = loadCredentials();
    const cred = stored[provider];

    return {
      hasCredentials: !!cred?.encryptedPassword,
      email: cred?.email,
      username: cred?.username,
      autoLoginEnabled,
      autoLoginMethod: autoLoginMethod || cred?.autoLoginMethod,
      lastUpdated: cred?.lastUpdated
    };
  },

  /**
   * Set auto-login method for a provider
   */
  setAutoLoginMethod(provider: BuiltInProvider, method: AutoLoginMethod): void {
    const stored = loadCredentials();
    if (!stored[provider]) {
      stored[provider] = {};
    }
    stored[provider].autoLoginMethod = method;
    stored[provider].lastUpdated = new Date().toISOString();
    saveCredentials(stored);
  },

  /**
   * Get auto-login method for a provider
   */
  getAutoLoginMethod(provider: BuiltInProvider): AutoLoginMethod | undefined {
    const stored = loadCredentials();
    return stored[provider]?.autoLoginMethod;
  },

  /**
   * Check if credentials exist for a provider
   */
  hasCredentials(provider: BuiltInProvider): boolean {
    const stored = loadCredentials();
    return !!stored[provider]?.encryptedPassword;
  },

  /**
   * Delete credentials for a provider
   */
  deleteCredentials(provider: BuiltInProvider): void {
    const stored = loadCredentials();
    delete stored[provider];
    saveCredentials(stored);
  },

  /**
   * List all providers with credentials
   */
  listProvidersWithCredentials(): BuiltInProvider[] {
    const stored = loadCredentials();
    return Object.keys(stored).filter(
      p => stored[p]?.encryptedPassword
    ) as BuiltInProvider[];
  }
};
