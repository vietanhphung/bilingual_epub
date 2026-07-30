import { describe, expect, it } from "vitest";
import { isWellFormedXhtmlFragment } from "../../src/epub/xhtml-well-formed.js";

describe("isWellFormedXhtmlFragment", () => {
  it("accepts balanced tags with void elements", () => {
    const result = isWellFormedXhtmlFragment(
      "<p>Hello <em>world</em><br/>Next <img src='x.png'/></p>",
    );
    expect(result.wellFormed).toBe(true);
  });

  it("rejects unclosed tags", () => {
    const result = isWellFormedXhtmlFragment("<div><p>Oops</div>");
    expect(result.wellFormed).toBe(false);
  });

  it("rejects mismatched closing tags", () => {
    const result = isWellFormedXhtmlFragment("<p>Hello</span>");
    expect(result.wellFormed).toBe(false);
  });
});
