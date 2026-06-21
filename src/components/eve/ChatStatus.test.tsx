import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ErrorNotice, ThinkingIndicator, showWorkingIndicator } from './ChatStatus'

afterEach(cleanup)

describe('ThinkingIndicator', () => {
  it('renders a working status', () => {
    render(<ThinkingIndicator />)
    expect(screen.getByText(/Eve is working/i)).toBeTruthy()
  })
})

describe('showWorkingIndicator', () => {
  const assistant = (parts: { type: string; text?: string; state?: string }[]) => ({
    role: 'assistant',
    parts,
  })
  const userMsg = { role: 'user', parts: [{ type: 'text', text: 'hi' }] }

  it('is false when the agent is idle', () => {
    expect(showWorkingIndicator({ status: 'ready', stalled: false, messages: [] })).toBe(false)
  })

  it('is false when stalled (the error notice takes over)', () => {
    expect(showWorkingIndicator({ status: 'streaming', stalled: true, messages: [] })).toBe(false)
  })

  it('is true right after submit while waiting for the reply', () => {
    expect(
      showWorkingIndicator({ status: 'submitted', stalled: false, messages: [userMsg] }),
    ).toBe(true)
  })

  it('is false while a tool is running (the tool card shows its own spinner)', () => {
    const messages = [userMsg, assistant([{ type: 'dynamic-tool', state: 'input-available' }])]
    expect(showWorkingIndicator({ status: 'streaming', stalled: false, messages })).toBe(false)
  })

  it('is true in the silent gap after a tool completes, before the next output', () => {
    // tool part is in a terminal (output-available) state, no visible text yet → looks frozen
    const messages = [userMsg, assistant([{ type: 'dynamic-tool', state: 'output-available' }])]
    expect(showWorkingIndicator({ status: 'streaming', stalled: false, messages })).toBe(true)
  })

  it('is false while assistant text is visibly streaming', () => {
    const messages = [userMsg, assistant([{ type: 'text', text: 'Here is the answer' }])]
    expect(showWorkingIndicator({ status: 'streaming', stalled: false, messages })).toBe(false)
  })
})

describe('ErrorNotice', () => {
  it('shows the error message', () => {
    render(<ErrorNotice message="gateway token expired" />)
    expect(screen.getByText('gateway token expired')).toBeTruthy()
  })

  it('falls back to a generic message when none is given', () => {
    render(<ErrorNotice />)
    expect(screen.getByText(/request failed/i)).toBeTruthy()
  })

  it('renders a retry button only when onRetry is provided and fires it', () => {
    const onRetry = vi.fn()
    const { rerender } = render(<ErrorNotice message="boom" />)
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()

    rerender(<ErrorNotice message="boom" onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
