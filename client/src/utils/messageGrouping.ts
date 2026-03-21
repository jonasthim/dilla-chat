import type { Message } from '../stores/messageStore';

export interface MessageGroup {
  authorId: string;
  username: string;
  messages: Message[];
}

const GROUPING_THRESHOLD_MS = 7 * 60 * 1000;

export function groupMessages(messages: Message[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const msg of messages) {
    const last = groups.at(-1);
    const isSystem = msg.type === 'system';
    if (
      !isSystem &&
      last?.authorId === msg.authorId &&
      !msg.deleted
    ) {
      // Group if within 7 minutes of previous
      const lastMsg = last.messages.at(-1);
      const timeDiff = lastMsg
        ? new Date(msg.createdAt).getTime() - new Date(lastMsg.createdAt).getTime()
        : Infinity;
      if (timeDiff < GROUPING_THRESHOLD_MS) {
        last.messages.push(msg);
        continue;
      }
    }
    groups.push({
      authorId: msg.authorId,
      username: msg.username,
      messages: [msg],
    });
  }
  return groups;
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isToday) return `Today at ${time}`;
  if (isYesterday) return `Yesterday at ${time}`;
  return `${date.toLocaleDateString()} ${time}`;
}
