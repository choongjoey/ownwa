export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeKey(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function stripWhatsAppControlMarks(value: string): string {
  return value.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
}
