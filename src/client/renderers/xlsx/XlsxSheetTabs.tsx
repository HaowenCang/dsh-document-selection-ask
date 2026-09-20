import * as React from 'react'
import { useXlsxViewer } from '@extend-ai/react-xlsx'

import { documentRendererStrings } from '../../ui/locales.js'

export function XlsxSheetTabs(): React.JSX.Element | null {
  const controller = useXlsxViewer()
  const tabs = controller.tabs
  const activeTabIndex = controller.activeTabIndex

  if (!tabs || tabs.length <= 1) {
    return null
  }

  // Resolved per render, like every other renderer surface: the tab list's
  // accessible name follows the document's language rather than a literal.
  const strings = documentRendererStrings(globalThis.document)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        padding: '6px 12px',
        borderBottom: '1px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, 0.12))',
        backgroundColor: 'var(--dsw-alias-bg-secondary, #f5f5f5)',
        overflowX: 'auto',
        flexShrink: 0,
      }}
      role="tablist"
      aria-label={strings.sheetTabs}
    >
      {tabs.map((tab, idx) => {
        const isSelected = idx === activeTabIndex
        return (
          <button
            key={tab.name + idx}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => controller.setActiveTabIndex(idx)}
            style={{
              padding: '4px 10px',
              fontSize: '12px',
              borderRadius: '6px',
              border: isSelected
                ? '1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.2))'
                : '1px solid transparent',
              backgroundColor: isSelected
                ? 'var(--dsw-alias-button-floating-fill, #ffffff)'
                : 'transparent',
              color: 'var(--dsw-alias-label-primary, #0f0f0f)',
              fontWeight: isSelected ? 600 : 400,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.name}
          </button>
        )
      })}
    </div>
  )
}
