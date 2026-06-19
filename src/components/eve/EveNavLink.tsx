'use client'
import React from 'react'
import { PayloadLink as Link } from '@payloadcms/ui'

/**
 * A navigation link rendered in the Payload admin sidebar that points to the
 * Eve chat view at /admin/eve. Reuses Payload's own nav-link classes
 * (`nav__link-wrapper` / `nav__link`) so it aligns with the collection links
 * instead of hand-rolled padding.
 */
export const EveNavLink: React.FC = () => {
  return (
    <div className="nav__link-wrapper">
      <Link className="nav__link" href="/admin/eve">
        Eve Chat
      </Link>
    </div>
  )
}
