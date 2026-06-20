import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export interface LoginOptions {
  page: Page
  serverURL?: string
  user: {
    email: string
    password: string
  }
}

/**
 * Logs the user into the admin panel via the login page.
 */
export async function login({
  page,
  serverURL = 'http://localhost:3000',
  user,
}: LoginOptions): Promise<void> {
  await page.goto(`${serverURL}/admin/login`)

  await page.fill('#field-email', user.email)
  await page.fill('#field-password', user.password)
  await page.click('button[type="submit"]')

  // waitForURL already confirms successful login and redirect to /admin.
  // Payload v4 canary no longer renders `span[title="Dashboard"]`; the page
  // title is surfaced as a live-region alert that hydrates asynchronously, so
  // we assert on the URL only to stay robust across v4 canary changes.
  await page.waitForURL(`${serverURL}/admin`)
}
