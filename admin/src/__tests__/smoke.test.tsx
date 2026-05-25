import { render, screen } from '@testing-library/react'

// Toolchain smoke test — confirms next/jest transform + jsdom + RTL + jest-dom
// matchers are wired before the real component tests rely on them.
describe('jest+rtl toolchain', () => {
  it('renders a component and matches a jest-dom matcher', () => {
    render(<div data-testid="smoke">ok</div>)
    expect(screen.getByTestId('smoke')).toHaveTextContent('ok')
  })
})
