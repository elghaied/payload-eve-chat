'use client'
import React from 'react'
import { PayloadLink as Link } from '@payloadcms/ui'

/**
 * A navigation link rendered in the Payload admin sidebar that points to the
 * Eve chat view at /admin/eve.
 */
export const EveNavLink: React.FC = () => {
  return (
    <div style={{ padding: '0 var(--nav-group-padding-left, 12px) 4px' }}>
      <Link
        href="/admin/eve"
        style={{
          display: 'block',
          padding: '6px 8px',
          borderRadius: 4,
          color: 'var(--color-base-700)',
          textDecoration: 'none',
          fontSize: '0.9rem',
        }}
      >
        Eve Chat
      </Link>
    </div>
  )
}
