'use client';

import { PolicyShell, PolicySection, PolicyContact, type PolicyKind } from './PolicyShell';

/**
 * A legal route whose WORDING has not been delivered yet.
 *
 * Engineering owns the route + chrome; legal/compliance owns the copy. Rather
 * than invent placeholder legalese — which on a clinical app would be actively
 * misleading if anyone read it as binding (a fabricated HIPAA Notice of Privacy
 * Practices is worse than no page at all) — these routes exist, render an
 * explicit "not yet published" notice, and are:
 *
 *   • `noindex` (set by each route's server component), and
 *   • NOT linked from the footer or the sitemap.
 *
 * So the URL resolves for anyone who has it, nothing fabricated is presented as
 * policy, and swapping in real copy is a content change with no routing work.
 */
export default function PendingPolicyPage({
  kind,
  title,
  intro,
}: {
  kind: PolicyKind;
  title: string;
  intro?: string;
}) {
  return (
    <PolicyShell kind={kind} title={title} intro={intro} lastUpdated="Not yet published">
      <PolicySection number="1" title="This notice is being finalised">
        <p>
          The full text of this document is being prepared by our compliance
          team and is not yet published. This page exists so the link resolves;
          it is <strong>not</strong> a statement of policy and nothing on it is
          binding.
        </p>
        <p>
          For questions in the meantime — including any request about your
          health information — please contact us and we will respond directly.
        </p>
      </PolicySection>
      <PolicyContact emails={['info@healplace.com']} />
    </PolicyShell>
  );
}
