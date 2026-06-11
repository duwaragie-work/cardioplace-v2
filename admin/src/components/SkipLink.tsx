// Accessibility (WCAG 2.4.1 Bypass Blocks) — the first focusable element on
// every admin page. Hidden offscreen until focused; pressing Tab once reveals
// it and Enter jumps to <main id="main">, skipping the sidebar + top bar.
// Styled by the .skip-link rule in globals.css.
export default function SkipLink() {
  return (
    <a href="#main" className="skip-link">
      Skip to main content
    </a>
  );
}
