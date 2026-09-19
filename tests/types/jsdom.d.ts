/**
 * A minimal declaration for `jsdom`, which ships no types of its own.
 *
 * `jsdom` is a development dependency the client specs run *inside* — vitest
 * reads the `@vitest-environment jsdom` pragma and loads it directly, so no spec
 * has ever imported it and no declaration was needed. This spec is the first to
 * need jsdom as a **library**: it parses an OOXML part to prove the part is
 * well-formed XML, and jsdom is the XML implementation the project already has.
 * Adding `@types/jsdom` for that would be a new dependency for one call, so the
 * one constructor and the one method the spec uses are declared here.
 *
 * Nothing about the application's own DOM contract is declared by this file; the
 * client specs still receive their environment from vitest.
 */
declare module 'jsdom' {
  /** A parsed document, as much of it as this project's specs read. */
  interface JsdomDocument {
    readonly documentElement: { readonly tagName: string }
    querySelector(selectors: string): unknown
    getElementsByTagName(name: string): { readonly length: number }
  }

  /** The same XML parser the browser builds into every window. */
  export interface JsdomDOMParser {
    /**
     * Parse a string as XML.
     * @param source - the markup.
     * @param type - the MIME type; `application/xml` refuses malformed markup.
     * @returns the parsed document, or one carrying a `<parsererror>` element.
     */
    parseFromString(source: string, type: string): JsdomDocument
  }

  /** The DOM implementation's entry point. */
  export class JSDOM {
    constructor(
      html?: string,
      options?: { readonly contentType?: string; readonly url?: string },
    )
    readonly window: { readonly DOMParser: new () => JsdomDOMParser }
    readonly document: JsdomDocument
  }
}
