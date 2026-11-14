import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Logo } from '../../components/ui';
import './landing.css';

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Adds `.in` once the element scrolls into view (one-shot reveal). */
function Reveal({ children, className = '', as: Tag = 'div', delay = 0 }: {
  children: ReactNode; className?: string; as?: 'div' | 'section' | 'li' | 'article'; delay?: number;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced()) { el.classList.add('in'); return; }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { el.classList.add('in'); io.disconnect(); }
    }, { rootMargin: '0px 0px -12% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref as never} className={`reveal ${className}`} style={{ ['--d' as string]: `${delay}ms` }}>{children}</Tag>;
}

const CHAT = [
  { who: 'in', text: 'Hi, price for the monthly package?' },
  { who: 'out', text: 'Hello! The monthly package is ₹2,500, with everything included. Shall I book it for you?' },
  { who: 'in', text: 'Yes. Can I pay by UPI?' },
  { who: 'out', text: 'Of course. Your order XC-0042 is booked. I am sending the payment link now.' },
];

function ChatPreview() {
  return (
    <div className="phone" aria-label="XS Connect chat preview">
      <div className="phone-screen">
        <div className="ph-top"><img src={`${import.meta.env.BASE_URL}brand/favicon.svg`} alt="" width={18} height={18} /> Anjali Menon · WhatsApp</div>
        <div className="chat-demo">
          {CHAT.map((m, i) => <div key={i} className={`bubble ${m.who}`}>{m.text}{m.who === 'out' && <span className="by">AI</span>}</div>)}
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  ['Teach it your business', 'Write what you sell, your prices and your policies once. The AI answers only from that.'],
  ['Connect your channels', 'WhatsApp, Instagram and Facebook messages land in one inbox.'],
  ['Approve, then let it run', 'Start with drafts you approve. Turn on autopilot when the replies look right.'],
];

const FEATURES = [
  ['One inbox', 'WhatsApp, Instagram DMs and Facebook Messenger together, with who is handling each chat.'],
  ['AI that knows your brand', 'Replies in your tone, in the customer’s language, using your own prices.'],
  ['Leads, captured', 'Every new person becomes a lead with what they want, their budget and a score.'],
  ['Orders in chat', 'The AI takes the order; totals always come from your price list, never guessed.'],
  ['Follow-ups', 'Reminders for the people who went quiet, inside the rules each channel allows.'],
  ['Hands over when unsure', 'Big deals, complaints and questions it cannot answer go to your team with a summary.'],
  ['Pay per conversation', 'No monthly fee. The first 100 AI conversations are free.'],
  ['Audit trail', 'Every AI order, handover and setting change is recorded.'],
];

const FAQ = [
  ['Will the AI say something wrong about my prices?', 'It can only quote prices you have listed, and an order total is calculated from that list by the system, not by the AI.'],
  ['Can I check replies before they are sent?', 'Yes. New brands start with autopilot off: the AI writes a draft and a person approves each one.'],
  ['Does it work in Malayalam?', 'It replies in the language the customer writes in, including Malayalam and Manglish.'],
  ['What does it cost?', 'You pay per AI conversation, counted once per customer per day. WhatsApp’s own message charges are billed by Meta to your account.'],
  ['Is my data kept separate from other brands?', 'Yes. Every row belongs to one brand, and the database refuses any request that crosses brands.'],
];

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="faq">
      {FAQ.map(([q, a], i) => (
        <div key={q} className={`faq-item ${open === i ? 'open' : ''}`}>
          <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
            <span>{q}</span><ChevronDown size={20} />
          </button>
          <div className="faq-a"><div><p>{a}</p></div></div>
        </div>
      ))}
    </div>
  );
}

export function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  return (
    <div className="lp">
      <header className={`lp-nav ${scrolled ? 'scrolled' : ''}`}>
        <div className="lp-wrap lp-nav-in">
          <Link to="/" aria-label="XS Connect home"><Logo onDark width={132} /></Link>
          <nav className="lp-links" aria-label="Sections">
            <a href="#how">How it works</a><a href="#features">Features</a><a href="#faq">Questions</a>
          </nav>
          <div className="row">
            <Link className="btn ghost on-dark" to="/login">Sign in</Link>
            <Link className="btn primary on-dark hide-phone" to="/login?mode=signup">Start free</Link>
          </div>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-wrap lp-hero-in">
          <div className="lp-hero-copy">
            <h1>
              <span className="line" style={{ ['--d' as string]: '60ms' }}>Every lead answered.</span>
              <span className="line" style={{ ['--d' as string]: '160ms' }}>On WhatsApp, Instagram</span>
              <span className="line" style={{ ['--d' as string]: '260ms' }}>and Facebook.</span>
            </h1>
            <p className="rise" style={{ ['--d' as string]: '380ms' }}>
              One inbox for all three, with an AI that knows your business: it replies, captures the lead, takes the order and follows up.
            </p>
            <div className="row rise" style={{ ['--d' as string]: '480ms' }}>
              <Link className="btn primary on-dark lg" to="/login?mode=signup">Start free</Link>
              <Link className="btn on-dark lg" to="/login">Sign in</Link>
            </div>
            <p className="lp-fine rise" style={{ ['--d' as string]: '560ms' }}>First 100 AI conversations free. No card needed.</p>
          </div>
          <div className="lp-hero-device rise-up" style={{ ['--d' as string]: '200ms' }}><ChatPreview /></div>
        </div>
      </section>

      <section id="how" className="lp-section">
        <div className="lp-wrap">
          <Reveal className="lp-head"><h2>Live in three steps.</h2></Reveal>
          <ol className="steps">
            {STEPS.map(([t, b], i) => (
              <Reveal as="li" key={t} className="step" delay={i * 120}><h3>{t}</h3><p>{b}</p></Reveal>
            ))}
          </ol>
        </div>
      </section>

      <section className="lp-section dark">
        <div className="lp-wrap">
          <Reveal className="lp-head">
            <h2>You stay in control.</h2>
            <ul className="ticks">
              <li><Check size={18} /> Drafts first: nothing is sent until you approve, until you choose autopilot</li>
              <li><Check size={18} /> Take over any chat with one tap; the AI stops at once</li>
              <li><Check size={18} /> Set a deal size above which a person always handles it</li>
            </ul>
          </Reveal>
        </div>
      </section>

      <section id="features" className="lp-section">
        <div className="lp-wrap">
          <Reveal className="lp-head"><h2>Everything a salesperson does in chat.</h2></Reveal>
          <dl className="features">
            {FEATURES.map(([t, d], i) => (
              <Reveal key={t} className="feature" delay={(i % 2) * 80}><dt>{t}</dt><dd>{d}</dd></Reveal>
            ))}
          </dl>
        </div>
      </section>

      <section id="faq" className="lp-section">
        <div className="lp-wrap narrow">
          <Reveal className="lp-head"><h2>Questions owners ask</h2></Reveal>
          <Reveal delay={80}><Faq /></Reveal>
        </div>
      </section>

      <section className="lp-section dark cta">
        <div className="lp-wrap">
          <Reveal className="cta-in">
            <h2>Try it with sample chats today.</h2>
            <p>Set up your brand in a few minutes. Connect Meta when you are ready.</p>
            <Link className="btn primary on-dark lg" to="/login?mode=signup">Start free</Link>
          </Reveal>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <Logo width={110} />
          <span>XS Connect by Xelorsoft</span>
          <span>© 2026 Xelorsoft</span>
        </div>
      </footer>
    </div>
  );
}
