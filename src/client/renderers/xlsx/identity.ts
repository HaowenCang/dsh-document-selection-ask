/**
 * Fixed constants identifying the XLSX preview renderer and its selection adapter.
 */

export const XLSX_RENDERER_ID = 'dsh-document-selection-ask/xlsx'
export const XLSX_SELECTION_ADAPTER_ID = 'dsh-selectable-xlsx'
export const XLSX_DOCUMENT_KIND = 'xlsx'
export const XLSX_DOCUMENT_KIND_ATTRIBUTE = 'data-dsa-document-kind'
export const XLSX_RESOURCE_ADDRESS_ATTRIBUTE = 'data-dsa-resource-address'
export const XLSX_SELECTABLE_ATTRIBUTE = 'data-dsa-xlsx-content'

/**
 * The attribute carrying the renderer's current semantic selection.
 *
 * Its value is `"<sheet>!<range>"` — for example `Sheet1!A1:C3` — or absent when
 * nothing is selected. It exists so that "a spreadsheet range is selected" is a
 * fact an observer can read from the document rather than infer from a control
 * that happens to be visible: the browser smoke confirms the range its gesture
 * produced before it presses Ask, and a test that could only see the button
 * would report the provenance of whatever range the gesture *should* have made.
 */
export const XLSX_SELECTION_ATTRIBUTE = 'data-dsa-xlsx-selection'
