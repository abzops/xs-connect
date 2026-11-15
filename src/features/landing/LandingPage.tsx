import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Logo } from '../../components/ui';
import './landing.css';

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 0 → 1 as the element travels through the viewport; drives the scroll scenes. */
function useScrollProgress<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      setP(span <= 0 ? 0 : Math.min(1, Math.max(0, -r.top / span)));
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => { window.removeEventListener('scroll', on); window.removeEventListener('resize', on); cancelAnimationFrame(raf); };
  }, []);
  return [ref, p] as const;
}

/* ------------------------------------------------------------------ hero */

type Ch = 'whatsapp' | 'instagram' | 'messenger';
const CH: Record<Ch, string> = { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger' };

const FEED: { ch: Ch; name: string; text: string; did: string }[] = [
  { ch: 'whatsapp', name: 'Anjali Menon', text: 'Monthly package ethraya?', did: 'Replied with the price' },
  { ch: 'instagram', name: 'Rahul K', text: 'Saw your reel. Do you deliver to Kochi?', did: 'Answered, asked for WhatsApp number' },
  { ch: 'messenger', name: 'Fathima R', text: 'Is the 3 month plan refundable?', did: 'Answered from your policy' },
  { ch: 'whatsapp', name: 'Arjun Das', text: 'Book 2 for Saturday please', did: 'Order XC-0043 taken, ₹1,800' },
  { ch: 'instagram', name: 'Sneha Thomas', text: 'Any discount for 40 people?', did: 'Handed to your team' },
  { ch: 'whatsapp', name: 'Vishnu P', text: 'I will decide tomorrow', did: 'Follow-up set for 10:00 am' },
];

function LiveInbox() {
  const n = useRef(3);
  const [rows, setRows] = useState(() => [2, 1, 0].map((i) => ({ key: i, ...FEED[i], done: true })));
  const [answered, setAnswered] = useState(128);
  useEffect(() => {
    if (reduced()) return;
    let settle = 0;
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const k = n.current++;
      setRows((r) => [{ key: k, ...FEED[k % FEED.length], done: false }, ...r].slice(0, 4));
      settle = window.setTimeout(() => {
        setRows((r) => r.map((x) => (x.key === k ? { ...x, done: true } : x)));
        setAnswered((a) => a + 1);
      }, 1500);
    }, 3200);
    return () => { clearInterval(id); clearTimeout(settle); };
  }, []);
  return (
    <div className="inbox-demo" aria-label="Live preview of the XS Connect inbox">
      <div className="inbox-demo-head">
        <span>Inbox</span>
        <span className="num">{answered} answered today</span>
      </div>
      <ul>
        {rows.map((r, i) => (
          <li key={r.key} className={i === 0 ? 'arrive' : ''}>
            <span className={`chip ${r.ch}`}>{CH[r.ch]}</span>
            <span className="fn">{r.name}</span>
            <span className="msg">{r.text}</span>
            <span className={`act ${r.done ? 'done' : ''}`}>
              {r.done ? r.did : <span className="typing" aria-label="AI is replying"><i /><i /><i /></span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------- one lead's story */

type Bubble = { who: 'in' | 'ai' | 'team' | 'note'; text: string };
type Step = { title: string; body: string; chat: Bubble[]; card: [string, string][] };

const STORY: Step[] = [
  {
    title: 'It answers in seconds, in their language',
    body: 'Malayalam, Manglish, English or Hindi. The reply uses your own prices and your own tone, at 2 pm or 2 am.',
    chat: [
      { who: 'in', text: 'Hi, monthly package ethraya?' },
      { who: 'ai', text: 'Hi! Monthly package ₹2,500 aanu, ellam included. Morning batch aano evening aano vendathu?' },
    ],
    card: [['Stage', 'New'], ['Source', 'WhatsApp']],
  },
  {
    title: 'It finds out what they need',
    body: 'Name, what they want, budget, how serious they are. Every chat becomes a lead with a score, without anyone typing it in.',
    chat: [
      { who: 'in', text: 'Evening. Njangal 2 per und' },
      { who: 'ai', text: 'Super! 2 perkku ₹5,000. Peru onnu parayamo?' },
      { who: 'in', text: 'Anjali' },
    ],
    card: [['Stage', 'Qualified'], ['Name', 'Anjali'], ['Wants', 'Monthly × 2, evening'], ['Score', '80 / 100']],
  },
  {
    title: 'It takes the order',
    body: 'The AI picks the items; the total is worked out from your price list by the system. It cannot quote a price you did not set.',
    chat: [
      { who: 'in', text: 'Ok, book cheytho' },
      { who: 'ai', text: 'Booked! Order XC-0042, total ₹5,000. Payment link ippol ayakkam.' },
    ],
    card: [['Stage', 'Proposal'], ['Order', 'XC-0042'], ['Total', '₹5,000']],
  },
  {
    title: 'It follows up with the quiet ones',
    body: 'A reminder goes out while the channel still allows it. After that, the follow-up lands on your team’s list so nobody is forgotten.',
    chat: [
      { who: 'note', text: 'Next morning, 10:00' },
      { who: 'ai', text: 'Hi Anjali, payment link innale ayachirunnu. Enthenkilum sahayam veno?' },
    ],
    card: [['Stage', 'Proposal'], ['Follow-up', 'Sent 10:00 am'], ['Order', 'XC-0042, pending']],
  },
  {
    title: 'It knows when to call a person',
    body: 'Big deals, complaints, refunds and anything it is not sure about go to your team with the reason. The AI stops the moment you take over.',
    chat: [
      { who: 'in', text: 'Office-il 40 per und. Corporate rate undo?' },
      { who: 'note', text: 'Handed to the team: deal above your ₹50,000 limit' },
      { who: 'team', text: 'Hi Anjali, Rahul here from the team. Yes, sharing our corporate plan now.' },
    ],
    card: [['Stage', 'Proposal'], ['Handled by', 'Rahul (team)'], ['Deal', '40 people']],
  },
];

function Story() {
  const [ref, p] = useScrollProgress<HTMLElement>();
  const active = Math.min(STORY.length - 1, Math.floor(p * STORY.length));
  const bubbles = STORY.slice(0, active + 1).flatMap((s, si) => s.chat.map((b, bi) => ({ ...b, id: `${si}-${bi}`, fresh: si === active })));
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { body.current?.scrollTo({ top: body.current.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' }); }, [active]);
  const step = STORY[active];
  return (
    <section id="story" className="story" ref={ref} style={{ ['--steps' as string]: STORY.length }}>
      <div className="story-stage">
        <div className="wrap story-grid">
          <div className="story-copy">
            <h2>Follow one lead from “hi” to paid.</h2>
            <ol>
              {STORY.map((s, i) => (
                <li key={s.title} className={i === active ? 'on' : i < active ? 'past' : ''} aria-current={i === active ? 'step' : undefined}>
                  <span className="n num">{i + 1}</span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ol>
            <div className="story-meter" aria-hidden><span style={{ transform: `scaleX(${p})` }} /></div>
          </div>
          <div className="story-device">
            <div className="phone">
              <div className="phone-top"><span className="chip whatsapp">WhatsApp</span> Anjali</div>
              <div className="phone-body" ref={body}>
                {bubbles.map((b) => <div key={b.id} className={`b ${b.who} ${b.fresh ? 'fresh' : ''}`}>{b.text}{b.who === 'ai' && <small>AI</small>}{b.who === 'team' && <small>Team</small>}</div>)}
              </div>
            </div>
            <dl className="lead-card" key={active}>
              {step.card.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- features */

const GROUPS: { name: string; items: [string, string][] }[] = [
  { name: 'One inbox', items: [
    ['Three channels together', 'WhatsApp, Instagram DMs and Facebook Messenger in a single list.'],
    ['Live', 'New messages appear as they arrive. No refreshing.'],
    ['Who is handling it', 'Every chat shows AI or You, and what is waiting for a person.'],
    ['Reply window timer', 'See how long each channel still lets you reply.'],
  ] },
  { name: 'An AI that knows your brand', items: [
    ['Brand Brain', 'Your business, services, offers, hours and policies, written once.'],
    ['Price list', 'The only prices the AI may quote. Mark an item unavailable in one tap.'],
    ['Saved answers', 'Your answers to common questions, used as written.'],
    ['Never-say list', 'Promises it must not make, in your words.'],
    ['Their language', 'Replies in Malayalam, Manglish, English or Hindi, matching the customer.'],
  ] },
  { name: 'Selling', items: [
    ['Leads on their own', 'Each new person becomes a lead with need, budget and a score.'],
    ['Pipeline', 'New, Qualified, Proposal, Won, Lost, with the value of what is open.'],
    ['Orders in chat', 'Taken by the AI or your team; totals come from the price list.'],
    ['Follow-ups', 'Reminders for people who went quiet, on your team’s list when the AI may not write.'],
  ] },
  { name: 'You stay in charge', items: [
    ['Drafts first', 'New brands start with the AI writing drafts that a person approves.'],
    ['Autopilot', 'Switch it on when the drafts look right. Switch it off any time.'],
    ['Take over', 'One tap in any chat and the AI stops.'],
    ['Deal limit', 'Above the amount you set, a person always handles it.'],
    ['Test before you connect', 'Sample chats let you play the customer and watch the AI answer.'],
  ] },
  { name: 'Team and trust', items: [
    ['Roles', 'Owner, Manager and Agent, each seeing only what they should.'],
    ['Audit trail', 'Every AI order, handover and setting change is recorded.'],
    ['Separate by design', 'One brand’s data can never be read by another.'],
    ['Phone, tablet, laptop', 'Opens in the browser and feels like an app on a phone.'],
  ] },
  { name: 'Numbers', items: [
    ['Analytics', 'Conversations, new leads, conversion and paid revenue by period.'],
    ['AI share', 'How much the AI answered and how much your team did.'],
    ['By channel', 'Which of the three brings the conversations.'],
    ['Usage', 'AI conversations used and what they cost, to the rupee.'],
  ] },
];

const WHO = ['Gyms', 'Clinics', 'Salons', 'Coaching centres', 'Real estate', 'Boutiques', 'Restaurants', 'Online stores', 'Travel', 'Studios'];

function Who() {
  const [ref, p] = useScrollProgress<HTMLElement>();
  return (
    <section className="who" ref={ref} aria-label="Who it is for">
      <p className="wrap who-lead">Built for businesses that sell in chat.</p>
      <div className="who-track" style={{ transform: `translate3d(${-p * 45}%, 0, 0)` }}>
        {[...WHO, ...WHO].map((w, i) => <span key={i}>{w}</span>)}
      </div>
    </section>
  );
}

const FAQ: [string, string][] = [
  ['Can the AI quote a wrong price?', 'It can only quote prices on your price list, and an order total is calculated from that list by the system, not by the AI.'],
  ['Can I check replies before they go out?', 'Yes. Every new brand starts with autopilot off: the AI writes a draft and a person approves it. You switch autopilot on when you trust it.'],
  ['Does it work in Malayalam?', 'It replies in the language the customer writes in, including Malayalam and Manglish.'],
  ['What counts as one conversation?', 'One customer in one day, however many messages they send. You are never charged twice for the same customer on the same day.'],
  ['Are WhatsApp’s own charges included?', 'No. Meta bills WhatsApp message charges to your own WhatsApp Business account. Instagram and Messenger messages have no Meta charge.'],
  ['Why can’t the AI follow up after a day?', 'Meta lets a business reply freely for 24 hours after the customer’s last message. After that the follow-up goes to your team’s list.'],
  ['Do I need to install anything?', 'No. It opens in the browser on any phone, tablet or laptop.'],
];

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="faq">
      {FAQ.map(([q, a], i) => (
        <div key={q} className={`faq-item ${open === i ? 'open' : ''}`}>
          <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}><span>{q}</span><ChevronDown size={20} /></button>
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
    <div className="lp2">
      <header className={`nav ${scrolled ? 'scrolled' : ''}`}>
        <div className="wrap nav-in">
          <Link to="/" className="nav-brand" aria-label="XS Connect home"><Logo onDark width={118} /><span>Connect</span></Link>
          <nav aria-label="Sections"><a href="#story">How it works</a><a href="#features">Features</a><a href="#price">Pricing</a><a href="#faq">Questions</a></nav>
          <div className="nav-cta">
            <Link className="lbtn quiet" to="/login">Sign in</Link>
            <Link className="lbtn solid" to="/login?mode=signup">Start free</Link>
          </div>
        </div>
      </header>

      <section className="hero">
        <div className="wrap hero-in">
          <div className="hero-copy">
            <h1><span>Every lead</span><span>answered.</span></h1>
            <p>WhatsApp, Instagram and Facebook in one window, with an AI that knows your business. It replies, takes the order and follows up. You step in when it matters.</p>
            <div className="hero-cta">
              <Link className="lbtn solid big" to="/login?mode=signup">Start free</Link>
              <a className="lbtn ghost big" href="#story">See how it works</a>
            </div>
            <p className="fine">First 100 AI conversations free. No card needed.</p>
          </div>
          <LiveInbox />
        </div>
      </section>

      <Story />

      <section id="features" className="features">
        <div className="wrap">
          <h2>Everything in the window.</h2>
          <div className="groups">
            {GROUPS.map((g) => (
              <section key={g.name} className="fgroup">
                <h3>{g.name}</h3>
                <dl>
                  {g.items.map(([t, d]) => <div key={t}><dt>{t}</dt><dd>{d}</dd></div>)}
                </dl>
              </section>
            ))}
          </div>
        </div>
      </section>

      <Who />

      <section id="price" className="price">
        <div className="wrap price-in">
          <div>
            <h2>No monthly fee.</h2>
            <p>You pay when the AI actually talks to a customer. Nothing for quiet days, nothing for your team’s own replies.</p>
          </div>
          <div className="price-card">
            <div className="amount"><span className="num">₹5</span><span>per AI conversation</span></div>
            <ul>
              <li>One customer, one day = one conversation</li>
              <li>First 100 conversations free</li>
              <li>Unlimited team members and channels</li>
              <li>WhatsApp’s own message charges are billed by Meta</li>
            </ul>
            <Link className="lbtn dark big" to="/login?mode=signup">Start free</Link>
          </div>
        </div>
      </section>

      <section id="faq" className="faq-section">
        <div className="wrap narrow">
          <h2>Questions owners ask</h2>
          <Faq />
        </div>
      </section>

      <section className="closing">
        <div className="wrap">
          <h2>Tonight’s enquiries will not wait till morning.</h2>
          <p>Set up your brand, try it on sample chats, connect your channels when you are ready.</p>
          <Link className="lbtn solid big" to="/login?mode=signup">Start free</Link>
        </div>
      </section>

      <footer className="foot">
        <div className="wrap foot-in">
          <Logo onDark width={104} />
          <span>XS Connect by Xelorsoft</span>
          <span>© 2026 Xelorsoft</span>
        </div>
      </footer>
    </div>
  );
}
