import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

const pushMock = vi.fn()
vi.mock('@payloadcms/ui', () => ({ useRouter: () => ({ push: pushMock }) }))

let mockPathname = '/admin/eve'
let mockSearch = new URLSearchParams('')
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearch,
}))

import {
  ConversationHistoryPanel,
  CONVERSATION_CREATED_EVENT,
  dispatchConversationCreated,
} from './ConversationHistoryPanel'

const LIST = [
  { id: 'a', title: 'Alpha' },
  { id: 'b', title: 'Beta' },
]

beforeEach(() => {
  pushMock.mockReset()
  mockPathname = '/admin/eve'
  mockSearch = new URLSearchParams('')
  cleanup()
})

describe('ConversationHistoryPanel', () => {
  it('renders the New chat button and the initial conversations', () => {
    render(<ConversationHistoryPanel initialConversations={LIST} />)
    expect(screen.getByRole('button', { name: /new chat/i })).toBeTruthy()
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
  })

  it('shows an empty state when there are no conversations', () => {
    render(<ConversationHistoryPanel initialConversations={[]} />)
    expect(screen.getByText(/no conversations yet/i)).toBeTruthy()
  })

  it('marks the active conversation (aria-current) when on /admin/eve with ?conversation', () => {
    mockSearch = new URLSearchParams('conversation=b')
    render(<ConversationHistoryPanel initialConversations={LIST} />)
    expect(screen.getByText('Beta').getAttribute('aria-current')).toBe('page')
    expect(screen.getByText('Alpha').getAttribute('aria-current')).toBeNull()
  })

  it('does NOT mark any conversation active when not on /admin/eve', () => {
    mockPathname = '/admin/collections/posts'
    mockSearch = new URLSearchParams('conversation=b')
    render(<ConversationHistoryPanel initialConversations={LIST} />)
    expect(screen.getByText('Beta').getAttribute('aria-current')).toBeNull()
  })

  it('navigates to the chat view with the conversation id when a row is clicked', () => {
    render(<ConversationHistoryPanel initialConversations={LIST} />)
    fireEvent.click(screen.getByText('Alpha'))
    expect(pushMock).toHaveBeenCalledWith('/admin/eve?conversation=a')
  })

  it('navigates to a fresh chat view when New chat is clicked', () => {
    render(<ConversationHistoryPanel initialConversations={LIST} />)
    fireEvent.click(screen.getByRole('button', { name: /new chat/i }))
    expect(pushMock).toHaveBeenCalledWith('/admin/eve')
  })

  it('merges an eve:conversation-created event to the top, deduped by id', () => {
    render(<ConversationHistoryPanel initialConversations={LIST} />)
    act(() => {
      window.dispatchEvent(
        new CustomEvent(CONVERSATION_CREATED_EVENT, { detail: { id: 'z', title: 'Zed' } }),
      )
    })
    expect(screen.getByText('Zed')).toBeTruthy()
    // Re-dispatching the same id updates in place (no duplicate row).
    act(() => {
      window.dispatchEvent(
        new CustomEvent(CONVERSATION_CREATED_EVENT, { detail: { id: 'z', title: 'Zed 2' } }),
      )
    })
    expect(screen.getAllByText(/Zed/).length).toBe(1)
    expect(screen.getByText('Zed 2')).toBeTruthy()
  })

  it('re-syncs the list when initialConversations changes (server revalidation)', () => {
    const { rerender } = render(<ConversationHistoryPanel initialConversations={LIST} />)
    rerender(<ConversationHistoryPanel initialConversations={[{ id: 'c', title: 'Gamma' }]} />)
    expect(screen.getByText('Gamma')).toBeTruthy()
    expect(screen.queryByText('Alpha')).toBeNull()
  })

  it('dispatchConversationCreated emits the event with the given detail', () => {
    const spy = vi.fn()
    window.addEventListener(CONVERSATION_CREATED_EVENT, spy)
    dispatchConversationCreated({ id: 'q', title: 'Quartz' })
    window.removeEventListener(CONVERSATION_CREATED_EVENT, spy)
    expect(spy).toHaveBeenCalledOnce()
    const evt = spy.mock.calls[0][0] as CustomEvent
    expect(evt.detail).toEqual({ id: 'q', title: 'Quartz' })
  })
})
