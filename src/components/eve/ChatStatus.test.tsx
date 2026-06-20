import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ErrorNotice, ThinkingIndicator } from './ChatStatus'

afterEach(cleanup)

describe('ThinkingIndicator', () => {
  it('renders a thinking status', () => {
    render(<ThinkingIndicator />)
    expect(screen.getByText(/Eve is thinking/i)).toBeTruthy()
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
