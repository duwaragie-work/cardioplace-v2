import { render, screen } from '@testing-library/react'
import { OptionDFlow } from './OptionDFlow'

// Option D AWAITING UX revision (2026-06-16) — when a patient returns to an
// unfinished held emergency, Screen A is auto-resumed and shows a "let's finish
// your reading" intro. A fresh (non-resumed) Screen A must NOT show it.

jest.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key, locale: 'en' }),
}))

// MicButton pulls in browser speech APIs that aren't worth booting in jsdom.
jest.mock('@/components/intake/MicButton', () => ({
  __esModule: true,
  default: () => null,
}))

const noop = async () => {}

function renderFlow(
  over: Partial<React.ComponentProps<typeof OptionDFlow>> = {},
) {
  return render(
    <OptionDFlow
      firstSystolic={195}
      firstDiastolic={120}
      onSubmitSecond={noop}
      onDecline={noop}
      onDone={() => {}}
      {...over}
    />,
  )
}

describe('OptionDFlow — AWAITING resume intro (2026-06-16)', () => {
  it('shows the resume intro on Screen A when resumed', () => {
    renderFlow({ resumed: true })
    expect(screen.getByTestId('optiond-resume-intro')).toBeInTheDocument()
    expect(screen.getByTestId('optiond-resume-intro')).toHaveTextContent(
      'checkin.optionD.resumeIntro',
    )
    // The retake CTA (Screen A) still renders so the patient can continue.
    expect(screen.getByTestId('optiond-retake')).toBeInTheDocument()
  })

  it('omits the resume intro on a fresh (non-resumed) Screen A', () => {
    renderFlow({ resumed: false })
    expect(screen.queryByTestId('optiond-resume-intro')).not.toBeInTheDocument()
    expect(screen.getByTestId('optiond-retake')).toBeInTheDocument()
  })

  it('defaults to non-resumed (no intro) when the prop is omitted', () => {
    renderFlow()
    expect(screen.queryByTestId('optiond-resume-intro')).not.toBeInTheDocument()
  })
})
