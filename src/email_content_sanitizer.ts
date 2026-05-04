const STRIP_TAGS =
  /<\/?(script|style|iframe|object|embed|form|input|button|textarea|select|link|meta|base)[^>]*>/gi;
const EVENT_HANDLER_ATTR = /\s+on[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi;
const JS_PROTOCOL_ATTR =
  /\s+(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi;

export function sanitizeEmailHtml(rawHtml: string): string {
  if (!rawHtml.trim()) {
    return "";
  }

  // Keep markup for readability but remove executable content/attributes.
  return rawHtml
    .replace(STRIP_TAGS, "")
    .replace(EVENT_HANDLER_ATTR, "")
    .replace(JS_PROTOCOL_ATTR, "");
}

