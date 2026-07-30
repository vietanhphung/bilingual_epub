import { describe, expect, it } from "vitest";
import { extractTranslatableBlocks } from "../../src/epub/content-extractor.js";

describe("extractTranslatableBlocks", () => {
  it("extracts p, li, blockquote, figcaption, headings, td/th in document order", () => {
    const content = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>
  <h1>Title</h1>
  <p>First paragraph.</p>
  <ul><li>Item one</li><li>Item two</li></ul>
  <blockquote><p>Quoted.</p></blockquote>
  <table><tr><th>Head</th><td>Cell</td></tr></table>
  <figure><figcaption>A caption.</figcaption></figure>
</body></html>`;

    const blocks = extractTranslatableBlocks({ path: "OEBPS/text/ch1.xhtml", content });
    const tags = blocks.map((b) => b.tagName);
    expect(tags).toEqual(["h1", "p", "li", "li", "p", "th", "td", "figcaption"]);
  });

  it("excludes script, style, code, pre, svg, and math content", () => {
    const content = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>
  <p>Visible text.</p>
  <script><p>not real</p></script>
  <style><p>also not real</p></style>
  <pre><code><p>code block</p></code></pre>
  <svg><text>svg text</text></svg>
</body></html>`;

    const blocks = extractTranslatableBlocks({ path: "ch1.xhtml", content });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.textContent).toBe("Visible text.");
  });

  it("excludes hidden and empty elements", () => {
    const content = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>
  <p style="display:none">Hidden</p>
  <p hidden="hidden">Also hidden</p>
  <p>   </p>
  <p>Visible.</p>
</body></html>`;

    const blocks = extractTranslatableBlocks({ path: "ch1.xhtml", content });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.textContent).toBe("Visible.");
  });

  it("does not double-extract a block nested inside another translatable block", () => {
    const content = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>
  <blockquote><p>Nested paragraph.</p></blockquote>
</body></html>`;

    const blocks = extractTranslatableBlocks({ path: "ch1.xhtml", content });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.tagName).toBe("p");
  });

  it("preserves inline formatting in innerHtml", () => {
    const content = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>
  <p>Il regarda <em>la mer</em> pendant plusieurs minutes.</p>
</body></html>`;

    const blocks = extractTranslatableBlocks({ path: "ch1.xhtml", content });
    expect(blocks[0]!.innerHtml).toContain("<em>la mer</em>");
  });
});
