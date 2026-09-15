/**
 * DSH builtin document-preview identities and runtime attributes.
 *
 * The document preview ships as one package with several interchangeable
 * renderers, and the preview root tells a reader which one drew the content
 * through `data-document-preview`, whose value is the renderer's registry id.
 * This module names the three ids this adapter understands and the attributes it
 * reads them from.
 *
 * **Verified against the primary runtime, DSH `0.1.5-rc.1`.** The values were
 * read from the installed
 * `@deepseek-ai/dsh-client-ui-sidebar-documentpreview@0.1.5-rc.1` bundle, not
 * from the design documents: the plain, Markdown, code, HTML, image and PDF ids
 * appear there as the `PLAIN_BODY_ID` / `MARKDOWN_BODY_ID` / … constants that
 * build each `DocumentPreviewDefinition`, and the root attributes appear in the
 * `TextPreview` component that renders them.
 *
 * The package also publishes its compiled sources behind `./src/*`. This plugin
 * does not use that path: a public export surface is what makes a version bump
 * checkable, and importing a product package's sources would tie the plugin to
 * an internal file layout that no release contract protects. The three ids are
 * therefore restated here, and
 * `tests/client/dsh-text-adapter.client.spec.tsx` builds its fixtures from this
 * module's own constants, so a rename upstream shows up as a failing adapter
 * rather than as a silently unmatched selector.
 */

/**
 * Attribute marking a preview root's content state.
 *
 * The renderer publishes exactly two values in rc.1: `"loading"` for the status
 * shell it shows before any content exists, and `"text"` for the shell that
 * carries the header and the document body. A failed read is not a third value —
 * the failure line renders inside the `"text"` shell — so this adapter refuses
 * `"loading"` and validates the failure cases through the body instead.
 */
export const PREVIEW_STATE_ATTRIBUTE = 'data-textpreview-state'

/** The only `data-textpreview-state` value that carries document content. */
export const PREVIEW_STATE_TEXT = 'text'

/** Attribute carrying the `dsh-resource://` address of the previewed file. */
export const PREVIEW_URL_ATTRIBUTE = 'data-textpreview-url'

/** Attribute naming the renderer that drew this preview's content. */
export const PREVIEW_RENDERER_ATTRIBUTE = 'data-document-preview'

/** Attribute marking the element that holds renderer output, and nothing else. */
export const PREVIEW_BODY_ATTRIBUTE = 'data-textpreview-body'

/**
 * Attribute on the plain renderer's one row per source line.
 *
 * Its value is the 1-based source line number, so a selection edge resolved to a
 * row is an exact source position rather than a position inferred from document
 * order. The value is not trusted: it is parsed as a positive integer and any
 * other content falls back to document-level provenance.
 */
export const PREVIEW_LINE_ATTRIBUTE = 'data-textpreview-line'

/**
 * Attribute on the scroll viewport of a highlighted code block.
 *
 * The code renderer nests its Shiki output inside this element, and the same
 * element appears inside rendered Markdown for every code fence. A caller must
 * therefore decide by the owning renderer whether these rows are source lines
 * before reading them.
 */
export const CODE_CONTENT_ATTRIBUTE = 'data-code-block-content'

/** Selector for the rows of one highlighted code block, in source order. */
export const CODE_LINE_SELECTOR = 'pre .line'

/** Registry id of the DSH plain-text renderer. */
export const DSH_PLAIN_PREVIEW_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/text'

/** Registry id of the DSH Markdown renderer. */
export const DSH_MARKDOWN_PREVIEW_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown'

/** Registry id of the DSH highlighted-code renderer. */
export const DSH_CODE_PREVIEW_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code'

/**
 * Selector for a preview root this adapter may read: a loaded text preview with
 * an address and a renderer identity.
 */
export const DSH_PREVIEW_ROOT_SELECTOR = `[${PREVIEW_STATE_ATTRIBUTE}="${PREVIEW_STATE_TEXT}"][${PREVIEW_URL_ATTRIBUTE}][${PREVIEW_RENDERER_ATTRIBUTE}]`
