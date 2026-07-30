const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const TAG_PATTERN = /<\/?([a-zA-Z][a-zA-Z0-9:_-]*)([^>]*)>/g;

/**
 * Minimal stack-based well-formedness check: every non-void, non-self-closing
 * tag must be closed in LIFO order. Not a full XML validator, but enough to
 * catch the mismatched/unclosed tags that break EPUB readers.
 */
export function isWellFormedXhtmlFragment(html: string): {
  wellFormed: boolean;
  error?: string;
} {
  const stack: string[] = [];
  let match: RegExpExecArray | null;
  TAG_PATTERN.lastIndex = 0;

  while ((match = TAG_PATTERN.exec(html)) !== null) {
    const [full, rawName, attrs] = match;
    const name = rawName!.toLowerCase();
    const isClosing = full.startsWith("</");
    const isSelfClosing = attrs!.trim().endsWith("/");

    if (isClosing) {
      const top = stack.pop();
      if (top !== name) {
        return {
          wellFormed: false,
          error: `Mismatched closing tag </${name}>, expected </${top ?? "(nothing open)"}>`,
        };
      }
      continue;
    }

    if (VOID_ELEMENTS.has(name) || isSelfClosing) {
      continue;
    }

    stack.push(name);
  }

  if (stack.length > 0) {
    return {
      wellFormed: false,
      error: `Unclosed tag(s): ${stack.join(", ")}`,
    };
  }

  return { wellFormed: true };
}
