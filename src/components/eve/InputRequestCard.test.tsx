import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { EveMessageInputRequest } from 'eve/react'
import { InputRequestCard } from './InputRequestCard'

afterEach(cleanup)

const baseRequest: EveMessageInputRequest = {
  requestId: 'req-42',
  prompt: 'Could you clarify what you need?',
  display: 'select',
  allowFreeform: true,
  options: [
    { id: 'capabilities', label: 'Model capabilities', description: 'What it can do' },
    { id: 'pricing', label: 'Pricing information' },
  ],
}

describe('InputRequestCard', () => {
  it('renders the prompt and option labels', () => {
    render(<InputRequestCard request={baseRequest} onRespond={vi.fn()} />)
    expect(screen.getByText('Could you clarify what you need?')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Model capabilities/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Pricing information/ })).toBeTruthy()
  })

  it('calls onRespond with the optionId when an option is clicked', () => {
    const onRespond = vi.fn()
    render(<InputRequestCard request={baseRequest} onRespond={onRespond} />)
    fireEvent.click(screen.getByRole('button', { name: /Pricing information/ }))
    expect(onRespond).toHaveBeenCalledWith({ requestId: 'req-42', optionId: 'pricing' })
  })

  it('calls onRespond with freeform text when the answer box is submitted', () => {
    const onRespond = vi.fn()
    render(<InputRequestCard request={baseRequest} onRespond={onRespond} />)
    const box = screen.getByPlaceholderText(/type your own answer/i)
    fireEvent.change(box, { target: { value: 'tell me about latency' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }))
    expect(onRespond).toHaveBeenCalledWith({ requestId: 'req-42', text: 'tell me about latency' })
  })

  it('does not render an answer box when freeform is disabled and no text display', () => {
    const onRespond = vi.fn()
    render(
      <InputRequestCard
        request={{ ...baseRequest, allowFreeform: false }}
        onRespond={onRespond}
      />,
    )
    expect(screen.queryByPlaceholderText(/answer/i)).toBeNull()
  })

  it('shows a read-only summary and no option buttons once answered', () => {
    const onRespond = vi.fn()
    render(
      <InputRequestCard request={baseRequest} answered={{ optionId: 'capabilities' }} onRespond={onRespond} />,
    )
    // Resolves optionId -> label
    expect(screen.getByText(/Model capabilities/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Pricing information/ })).toBeNull()
  })

  it('disables controls while busy', () => {
    render(<InputRequestCard request={baseRequest} busy onRespond={vi.fn()} />)
    expect((screen.getByRole('button', { name: /Pricing information/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})
