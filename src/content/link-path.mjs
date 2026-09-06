// Markdown destinations are URL paths. Filesystem paths and values already read
// from the internal `file` query parameter must not pass through this decoder.
export function decodeMarkdownLinkPath(value) {
  try {
    // Safe HTML images can contain a bare percent, unlike markdown-it tokens,
    // whose URL normalizer has already escaped it.
    return decodeURIComponent(value.replace(/%(?![\da-f]{2})/gi, "%25"));
  } catch {
    // Malformed UTF-8 escapes should leave an unavailable link, not fail the
    // rendering of the entire document.
    return value;
  }
}
