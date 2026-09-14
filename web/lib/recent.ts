// Recently resolved recipients for /send, kept per browser.

const STORAGE_KEY = 'paytag-recent';
const MAX_RECENT = 4;

export interface RecentRecipient {
  name: string;
  /** Epoch ms of the last successful lookup. */
  at: number;
}

const isRecent = (value: unknown): value is RecentRecipient => {
  const v = value as RecentRecipient | null;
  return (
    !!v &&
    typeof v.name === 'string' &&
    /^[a-z0-9_]{3,20}$/.test(v.name) &&
    typeof v.at === 'number' &&
    Number.isFinite(v.at)
  );
};

export function readRecent(): RecentRecipient[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isRecent).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

/** Move `name` to the front and return the updated list. */
export function rememberRecent(name: string): RecentRecipient[] {
  const list = [{ name, at: Date.now() }, ...readRecent().filter((r) => r.name !== name)].slice(
    0,
    MAX_RECENT,
  );
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage blocked — the list still updates for this page view.
  }
  return list;
}

export function clearRecent(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** "just now", "12 min ago", "3h ago", "2d ago". */
export function timeAgo(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
