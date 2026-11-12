/** Redact tokens / sealed blobs before showing errors in the UI. */
export function scrubSensitive(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
      "[redacted-token]"
    )
    .replace(/cursor-safe-storage:[^\s"']+/gi, "[redacted-sealed]")
    .replace(/[A-Za-z0-9+/=]{80,}/g, "[redacted-blob]");
}
