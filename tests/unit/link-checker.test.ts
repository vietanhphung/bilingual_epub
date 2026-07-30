import { describe, expect, it } from "vitest";
import { findUnresolvedLinks } from "../../src/epub/link-checker.js";

describe("findUnresolvedLinks", () => {
  it("passes a link to an existing file in another directory", () => {
    const documents = [{ path: "text/ch1.xhtml", content: '<a href="../images/cover.png">img</a>' }];
    const entries = new Map([["images/cover.png", Buffer.from("")]]);
    expect(findUnresolvedLinks(documents, entries)).toEqual([]);
  });

  it("flags a link to a missing file", () => {
    const documents = [{ path: "text/ch1.xhtml", content: '<a href="missing.xhtml">gone</a>' }];
    const entries = new Map<string, Buffer>();
    const issues = findUnresolvedLinks(documents, entries);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("UNRESOLVED_LINK");
  });

  it("resolves a same-document fragment link against ids in that document", () => {
    const documents = [
      { path: "text/ch1.xhtml", content: '<p id="fn1">Note</p><a href="#fn1">back</a>' },
    ];
    const entries = new Map([["text/ch1.xhtml", Buffer.from(documents[0]!.content)]]);
    expect(findUnresolvedLinks(documents, entries)).toEqual([]);
  });

  it("flags a fragment link to a missing anchor", () => {
    const documents = [{ path: "text/ch1.xhtml", content: '<a href="#nope">gone</a>' }];
    const entries = new Map([["text/ch1.xhtml", Buffer.from(documents[0]!.content)]]);
    const issues = findUnresolvedLinks(documents, entries);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("UNRESOLVED_ANCHOR");
  });

  it("resolves a cross-document fragment link against ids in the target document", () => {
    const documents = [
      { path: "text/ch1.xhtml", content: '<a href="ch2.xhtml#target">go</a>' },
      { path: "text/ch2.xhtml", content: '<p id="target">Here</p>' },
    ];
    const entries = new Map(documents.map((d) => [d.path, Buffer.from(d.content)]));
    expect(findUnresolvedLinks(documents, entries)).toEqual([]);
  });

  it("ignores external links (http, mailto, protocol-relative)", () => {
    const documents = [
      {
        path: "text/ch1.xhtml",
        content:
          '<a href="https://example.com">ext</a><a href="mailto:a@b.com">mail</a><a href="//example.com/x">rel</a>',
      },
    ];
    const entries = new Map<string, Buffer>();
    expect(findUnresolvedLinks(documents, entries)).toEqual([]);
  });

  it("recognizes both id and name attributes as valid anchor targets", () => {
    const documents = [
      { path: "text/ch1.xhtml", content: '<a name="legacy">x</a><a href="#legacy">go</a>' },
    ];
    const entries = new Map([["text/ch1.xhtml", Buffer.from(documents[0]!.content)]]);
    expect(findUnresolvedLinks(documents, entries)).toEqual([]);
  });
});
