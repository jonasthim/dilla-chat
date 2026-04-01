import { cryptoService, getIdentityKeys } from '../services/crypto';
import { toBase64 } from '../services/cryptoCore';
import { cacheMessage, getCachedMessage } from '../services/messageCache';
import type { Message } from '../stores/messageStore';
import type { Member } from '../stores/teamStore';

const DEV_PREFIX = '[DEV: unencrypted] ';

// In-memory cache: ciphertext → plaintext for messages we just sent.
// The sender key ratchet advances on encrypt, so we can't decrypt our own
// messages when the server echoes them back. This cache bridges the gap
// until the message ID is known and we can persist to the message cache.
const sentPlaintextCache = new Map<string, string>();
const MAX_SENT_CACHE = 200;

export interface ServerMessage {
  id: string;
  channel_id: string;
  author_id: string;
  username: string;
  content: string;
  type: string;
  thread_id: string | null;
  edited_at: string | null;
  deleted: boolean;
  created_at: string;
  reactions: Array<{ emoji: string; users: string[]; count: number }>;
  attachments?: Array<{ id: string; filename: string; content_type: string; size: number; url: string }>;
}

export async function tryDecrypt(
  messageId: string,
  content: string,
  senderId: string,
  channelId: string,
  derivedKey: string | null,
): Promise<string> {
  // Check persistent message cache first
  const cached = await getCachedMessage(messageId);
  if (cached !== null) return cached;

  // Check sent-message plaintext cache (for our own messages echoed back)
  const sentPlaintext = sentPlaintextCache.get(content);
  if (sentPlaintext !== undefined) {
    sentPlaintextCache.delete(content);
    // Persist to durable cache now that we have the message ID
    await cacheMessage(messageId, channelId, sentPlaintext);
    return sentPlaintext;
  }

  const clean = content.startsWith(DEV_PREFIX) ? content.slice(DEV_PREFIX.length) : content;
  if (!derivedKey) return '\u{1F512} *Encrypted message \u2014 unlock your identity to read*';
  try {
    const userId = getIdentityKeys().publicKeyBytes;
    const plaintext = await cryptoService.decryptChannel(
      channelId,
      toBase64(userId),
      senderId,
      content,
      derivedKey,
    );
    await cacheMessage(messageId, channelId, plaintext);
    return plaintext;
  } catch (err) {
    console.warn(`[Decrypt] Failed for msg=${messageId} channel=${channelId} sender=${senderId}:`, err);
    if (clean.length > 80 && /^[A-Za-z0-9+/=\s]+$/.test(clean.trim())) {
      return '\u{1F512} *Unable to decrypt \u2014 encrypted with a previous session key*';
    }
    return clean;
  }
}

export async function tryEncrypt(
  plaintext: string,
  channelId: string,
  derivedKey: string | null,
): Promise<string> {
  if (!derivedKey) throw new Error('Encryption key not available');
  const userId = getIdentityKeys().publicKeyBytes;
  const ciphertext = await cryptoService.encryptChannel(channelId, toBase64(userId), plaintext, derivedKey);

  // Cache plaintext keyed by ciphertext so tryDecrypt can find it when
  // the server echoes the message back (ratchet has already advanced).
  sentPlaintextCache.set(ciphertext, plaintext);
  if (sentPlaintextCache.size > MAX_SENT_CACHE) {
    // Evict oldest entry
    const first = sentPlaintextCache.keys().next().value;
    if (first) sentPlaintextCache.delete(first);
  }

  return ciphertext;
}

function resolveDisplayName(member: Member | undefined): string | null {
  if (!member) return null;
  const raw = member as unknown as Record<string, string>;
  return member.displayName || raw.display_name || member.username || null;
}

export function serverToMessage(
  msg: ServerMessage,
  decryptedContent: string,
  teamMembers?: Member[],
): Message {
  let username: string = msg.username || 'Unknown';
  if (teamMembers) {
    const raw = teamMembers as unknown as Array<Record<string, string>>;
    const member = teamMembers.find(
      (m, i) => (m.userId || raw[i].user_id) === msg.author_id || m.id === msg.author_id,
    );
    username = resolveDisplayName(member) ?? username;
  }
  return {
    id: msg.id,
    channelId: msg.channel_id,
    authorId: msg.author_id,
    username: username ?? 'Unknown',
    content: decryptedContent,
    encryptedContent: msg.content,
    type: msg.type,
    threadId: msg.thread_id,
    editedAt: msg.edited_at,
    deleted: msg.deleted,
    createdAt: msg.created_at,
    reactions: msg.reactions ?? [],
    attachments: msg.attachments?.map((a) => ({
      ...a,
      url: a.url.startsWith('/') ? `${window.location.origin}${a.url}` : a.url,
    })),
  } as Message;
}
