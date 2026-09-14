/**
 * Package identity of the plugin, host-safe.
 *
 * This module is the package's `exports "."` entry: it is imported by the DSH
 * host process, so it must never reach browser-only dependencies (React, DOM
 * APIs, PDF.js, Office parsers). The browser half of the plugin lives behind
 * `exports "./client"` and is loaded only by the web boot.
 */

/** Exact package name the DSH patch row and the loader entry both address. */
export const PLUGIN_NAME = 'dsh-document-selection-ask'

/** Package version, kept in step with `package.json`. */
export const PLUGIN_VERSION = '0.1.0'
