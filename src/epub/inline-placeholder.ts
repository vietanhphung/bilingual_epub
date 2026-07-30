import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";

/**
 * Inline elements are rewritten to a generic <x-inline> placeholder before
 * translation so the LLM only ever sees stable, content-free markup. The
 * original tag name and attributes are recovered from `placeholders` when
 * reconstructing the translated XHTML.
 */
export interface InlinePlaceholder {
  id: string;
  tagName: string;
  attribs: Record<string, string>;
}

export interface PlaceholderizedText {
  /** Plain text interspersed with <x-inline data-id="..."> markers. */
  text: string;
  placeholders: InlinePlaceholder[];
}

function isTextNode(node: AnyNode): node is AnyNode & { data: string } {
  return node.type === "text";
}

function isElementNode(node: AnyNode): node is Element {
  return node.type === "tag";
}

/**
 * Serializes a block element's children into placeholder text, numbering
 * every inline descendant (including nested ones) in document order.
 */
export function placeholderizeInlineContent(
  $: cheerio.CheerioAPI,
  el: Element,
): PlaceholderizedText {
  const placeholders: InlinePlaceholder[] = [];
  let counter = 0;

  const walk = (node: AnyNode): string => {
    if (isTextNode(node)) {
      return node.data;
    }
    if (!isElementNode(node)) {
      return "";
    }

    const innerText = node.children.map(walk).join("");
    counter += 1;
    const id = `inline-${counter}`;
    const attribs: Record<string, string> = { ...node.attribs };
    placeholders.push({ id, tagName: node.name, attribs });
    return `<x-inline data-id="${id}">${innerText}</x-inline>`;
  };

  const text = el.children.map(walk).join("");
  return { text, placeholders };
}

const TOKEN_PATTERN = /<x-inline data-id="([^"]+)">|<\/x-inline>/g;

interface OpenFrame {
  id: string;
  buffer: string[];
}

/**
 * Rebuilds real inline HTML from placeholder text + the placeholder table
 * produced by placeholderizeInlineContent. Placeholders can nest (e.g. a
 * link wrapping a bold span), so this walks tokens with an explicit stack
 * rather than a single non-greedy regex, which cannot pair nested tags
 * correctly. Returns null if the placeholder text is malformed (unknown
 * id, unbalanced tags, a dropped placeholder) so the caller can fall back
 * to the original source paragraph instead of emitting broken XHTML.
 */
export function reconstructInlineContent(
  placeholderText: string,
  placeholders: InlinePlaceholder[],
): string | null {
  const byId = new Map(placeholders.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const stack: OpenFrame[] = [];
  const rootBuffer: string[] = [];

  const appendText = (text: string) => {
    if (text.length === 0) return;
    const top = stack[stack.length - 1];
    (top ? top.buffer : rootBuffer).push(text);
  };

  TOKEN_PATTERN.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_PATTERN.exec(placeholderText)) !== null) {
    appendText(placeholderText.slice(lastIndex, match.index));
    lastIndex = TOKEN_PATTERN.lastIndex;

    const openId = match[1];
    if (openId !== undefined) {
      if (!byId.has(openId)) return null;
      stack.push({ id: openId, buffer: [] });
      continue;
    }

    const frame = stack.pop();
    if (!frame) return null;
    const placeholder = byId.get(frame.id)!;
    seen.add(frame.id);
    const attrsString = Object.entries(placeholder.attribs)
      .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
      .join("");
    const inner = frame.buffer.join("");
    appendText(
      `<${placeholder.tagName}${attrsString}>${inner}</${placeholder.tagName}>`,
    );
  }
  appendText(placeholderText.slice(lastIndex));

  if (stack.length > 0) return null;
  if (seen.size !== placeholders.length) return null;

  return rootBuffer.join("");
}

const OPENING_TAG_PATTERN = /<x-inline data-id="[^"]+">/g;

/** Opening placeholder tags present in a segment's text, used as the TranslationSegmentRequest.protectedPlaceholders list. */
export function extractPlaceholderTags(text: string): string[] {
  return [...new Set(text.match(OPENING_TAG_PATTERN) ?? [])];
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
