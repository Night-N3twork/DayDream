import type { MessageEntry } from './negotiate';

export function lookupMessage(
  messages: Record<string, MessageEntry>,
  key: string,
): MessageEntry | undefined {
  const normalized = key.toLowerCase();
  return messages[key]
    ?? messages[normalized]
    ?? Object.entries(messages).find(([name]) => name.toLowerCase() === normalized)?.[1];
}

export function substituteMessagePlaceholders(
  text: string,
  messages: Record<string, MessageEntry>,
): string {
  return text.replace(/__MSG_([A-Za-z0-9_@]+)__/gi, (whole, key: string) =>
    lookupMessage(messages, key)?.message ?? whole,
  );
}
