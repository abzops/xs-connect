import { Link } from 'react-router';
import type { ReactNode } from 'react';

const EMAIL = 'admin@xelorsoft.com';
const UPDATED = '16 November 2026';

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="legal">
      <nav className="legal-nav">
        <Link to="/">XS Connect</Link>
        <span><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><Link to="/data-deletion">Data deletion</Link></span>
      </nav>
      <article>
        <h1>{title}</h1>
        <p className="legal-meta">XS Connect by Xelorsoft. Last updated {UPDATED}.</p>
        {children}
        <h2>Contact</h2>
        <p>Questions about this page: <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.</p>
      </article>
    </main>
  );
}

export function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>XS Connect is software made by Xelorsoft, India. Businesses ("brands") use it to answer their customers on WhatsApp, Instagram and Facebook Messenger, with help from an AI assistant. This policy explains what we collect, why, who processes it, and how to have it deleted.</p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Brand accounts:</strong> the name and email of people who sign up, their brand's name, and the business details they enter (products, prices, opening hours, answers to common questions).</li>
        <li><strong>Messages:</strong> when a brand connects a WhatsApp number, Instagram account or Facebook Page, we receive the messages its customers send to that account and the replies sent back. This includes the customer's name and phone number or account ID as Meta provides them, text, voice notes, and delivery status.</li>
        <li><strong>Sales records:</strong> leads, orders and follow-ups created from those conversations.</li>
        <li><strong>Technical data:</strong> basic logs needed to run and secure the service.</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To show a brand its conversations and let its team reply.</li>
        <li>To let the AI assistant reply on the brand's behalf, using only that brand's business details and that conversation.</li>
        <li>To turn voice notes into text so they can be read and answered.</li>
        <li>To bill brands for usage and keep the service secure.</li>
      </ul>
      <p>We do not sell personal data, use it for advertising, or use one brand's data to answer another brand's customers.</p>

      <h2>Who processes it for us</h2>
      <ul>
        <li><strong>Meta Platforms</strong> (WhatsApp, Instagram, Messenger): delivers messages between the customer and the brand.</li>
        <li><strong>Supabase</strong>: stores the data, in its Mumbai, India region.</li>
        <li><strong>Google (Gemini API)</strong>: generates AI replies and transcribes long voice notes.</li>
        <li><strong>Sarvam AI</strong>, India: transcribes voice notes.</li>
        <li><strong>GitHub Pages</strong>: hosts the XS Connect website.</li>
      </ul>
      <p>These providers process data only to provide their service to us.</p>

      <h2>Data from Meta platforms</h2>
      <p>Data we receive through Meta's platforms is used only to provide XS Connect to the brand that connected the account, as described above, and in line with Meta's Platform Terms. A brand can disconnect an account in XS Connect at any time; we then stop receiving its messages.</p>

      <h2>How long we keep it</h2>
      <p>We keep a brand's data while its account is open. When a brand or a customer asks us to delete data, we delete it within 30 days, except where the law requires us to keep a record.</p>

      <h2>Security</h2>
      <p>Data is sent over encrypted connections. Each brand can see only its own data. Access tokens for connected accounts are stored where only our servers can read them.</p>

      <h2>Your choices</h2>
      <p>If you messaged a business that uses XS Connect, that business decides how your messages are used; you can also ask us directly. To see, correct or delete your data, follow the steps on our <Link to="/data-deletion">data deletion page</Link>.</p>

      <h2>Changes</h2>
      <p>If we change this policy, we will update the date at the top of this page.</p>
    </LegalPage>
  );
}

export function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>These terms apply to brands that use XS Connect.</p>
      <h2>Using XS Connect</h2>
      <ul>
        <li>You must have the right to use the WhatsApp number, Instagram account or Facebook Page you connect.</li>
        <li>You must follow Meta's terms and policies, including the WhatsApp Business Messaging Policy, and the law.</li>
        <li>You are responsible for the business details you give the AI assistant, and for what your team sends.</li>
      </ul>
      <h2>The AI assistant</h2>
      <p>The AI writes replies from your business details. It can make mistakes. You can switch on approval so that every reply waits for a person, take over any chat, and switch the AI off.</p>
      <h2>Payment</h2>
      <p>New brands get free AI conversations. After that, AI conversations are charged at the price shown in XS Connect. Message charges from Meta, if any, are billed by Meta to the owner of the WhatsApp account.</p>
      <h2>Ending your use</h2>
      <p>You can stop using XS Connect at any time and ask us to delete your data. We may suspend accounts that break these terms or Meta's policies.</p>
      <h2>Liability</h2>
      <p>XS Connect is provided as is. To the extent the law allows, Xelorsoft is not liable for indirect losses, or for losses caused by Meta's platforms or other services outside our control.</p>
    </LegalPage>
  );
}

export function DataDeletionPage() {
  return (
    <LegalPage title="Delete your data">
      <h2>If you are a customer who messaged a business</h2>
      <ol>
        <li>Email <a href={`mailto:${EMAIL}?subject=Delete%20my%20data`}>{EMAIL}</a> with the subject "Delete my data".</li>
        <li>Include the phone number or the Instagram or Facebook name you messaged from, and the name of the business.</li>
        <li>We confirm by email and delete your messages, voice notes and related records within 30 days.</li>
      </ol>
      <h2>If you run a brand on XS Connect</h2>
      <ol>
        <li>To stop receiving messages, open Settings, then Channels, and disconnect the account.</li>
        <li>To delete your whole account and its data, email <a href={`mailto:${EMAIL}?subject=Delete%20my%20brand`}>{EMAIL}</a> from the email you signed up with.</li>
        <li>We delete it within 30 days, except records the law requires us to keep.</li>
      </ol>
      <h2>Removing XS Connect from Facebook</h2>
      <p>In Facebook, open Settings and privacy, then Settings, then Business integrations, and remove XS Connect. Then email us as above if you want the data we already hold deleted.</p>
    </LegalPage>
  );
}
