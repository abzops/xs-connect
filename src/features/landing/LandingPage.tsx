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
type Line = { who: 'in' | 'ai' | 'note'; text: string };
type Convo = { name: string; ch: Ch; lines: Line[]; lead: { at: number; k: string; v: string }[]; ends: 'AI' | 'You' };

const CONVOS: Convo[] = [
  {
    name: 'Anjali Menon', ch: 'whatsapp', ends: 'AI',
    lines: [
      { who: 'in', text: 'Hi, monthly package ethraya?' },
      { who: 'ai', text: 'Hi Anjali! Monthly package ₹2,500 aanu, ellam included. Book cheyyatte?' },
      { who: 'in', text: 'Ok, 2 perkku book cheytho' },
      { who: 'ai', text: 'Booked! Order XC-0042, total ₹5,000. Payment link ippol ayakkam.' },
    ],
    lead: [{ at: 1, k: 'Stage', v: 'New' }, { at: 2, k: 'Wants', v: 'Monthly package' }, { at: 4, k: 'Order', v: 'XC-0042' }, { at: 4, k: 'Total', v: '₹5,000' }],
  },
  {
    name: 'Rahul Krishnan', ch: 'instagram', ends: 'AI',
    lines: [
      { who: 'in', text: 'Saw your reel. Do you deliver to Kochi?' },
      { who: 'ai', text: 'Yes, anywhere in Kerala in 2 to 4 days. May I have your WhatsApp number to send the details?' },
      { who: 'in', text: '98470 00021' },
      { who: 'ai', text: 'Thank you, Rahul. Sending the catalogue there now.' },
    ],
    lead: [{ at: 1, k: 'Stage', v: 'New' }, { at: 2, k: 'Wants', v: 'Delivery to Kochi' }, { at: 3, k: 'WhatsApp', v: 'Saved' }, { at: 4, k: 'Score', v: '70 / 100' }],
  },
  {
    name: 'Sneha Thomas', ch: 'messenger', ends: 'You',
    lines: [
      { who: 'in', text: 'We are 40 people. Any corporate rate?' },
      { who: 'note', text: 'Handed to your team: deal above your ₹50,000 limit' },
      { who: 'ai', text: 'Thanks, Sneha. A team member will reply here with our corporate plan shortly.' },
    ],
    lead: [{ at: 1, k: 'Stage', v: 'Qualified' }, { at: 1, k: 'Wants', v: 'Corporate, 40 people' }, { at: 2, k: 'Handled by', v: 'Your team' }],
  },
];

/** The product itself, playing three real conversations. Pauses on request. */
function HeroApp() {
  const still = reduced();
  const [ci, setCi] = useState(0);
  const [shown, setShown] = useState(still ? CONVOS[0].lines.length : 0);
  const [typing, setTyping] = useState(false);
  const [paused, setPaused] = useState(still);
  const convo = CONVOS[ci];
  useEffect(() => {
    if (paused) return;
    let t = 0;
    if (shown < convo.lines.length) {
      const next = convo.lines[shown];
      if (next.who === 'ai' && !typing) t = window.setTimeout(() => setTyping(true), 500);
      else t = window.setTimeout(() => { setTyping(false); setShown((n) => n + 1); }, next.who === 'ai' ? 1100 : 1300);
    } else {
      t = window.setTimeout(() => { setCi((i) => (i + 1) % CONVOS.length); setShown(0); }, 3200);
    }
    return () => clearTimeout(t);
  }, [paused, shown, typing, convo]);
  const done = shown >= convo.lines.length;
  return (
    <div className="app" aria-label="XS Connect inbox, playing sample conversations">
      <div className="app-bar">
        <span className="dots" aria-hidden><i /><i /><i /></span>
        <span className="app-title">XS Connect</span>
        <button className="app-pause" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>{paused ? 'Play' : 'Pause'}</button>
      </div>
      <div className="app-body">
        <ul className="app-list" aria-label="Conversations">
          {CONVOS.map((c, i) => {
            const active = i === ci;
            const last = active ? convo.lines[Math.max(0, shown - 1)]?.text ?? '' : c.lines[c.lines.length - 1].text;
            const who = active ? (done ? c.ends : 'AI') : c.ends;
            return (
              <li key={c.name} className={active ? 'on' : ''}>
                <span className="avatar-s" aria-hidden>{c.name.split(' ').map((w) => w[0]).join('')}</span>
                <span className="li-main"><b>{c.name}</b><span>{last || 'New message'}</span></span>
                <span className="li-end"><span className={`chip ${c.ch}`}>{CH[c.ch]}</span><span className={`tag ${who === 'You' ? 'you' : ''}`}>{who}</span></span>
              </li>
            );
          })}
        </ul>
        <div className="app-chat">
          <div className="app-chat-head"><b>{convo.name}</b><span className={`chip ${convo.ch}`}>{CH[convo.ch]}</span></div>
          <div className="app-chat-body" key={ci}>
            {convo.lines.slice(0, shown).map((l, i) => <div key={i} className={`b ${l.who} fresh`}>{l.text}{l.who === 'ai' && <small>AI</small>}</div>)}
            {typing && <div className="b ai typing-b"><span className="typing" aria-label="AI is replying"><i /><i /><i /></span></div>}
          </div>
          <div className="app-compose" aria-hidden><span>Reply…</span></div>
        </div>
        <dl className="app-lead" aria-label="Lead details">
          <div className="lead-title">Lead</div>
          {convo.lead.filter((f) => f.at <= shown).map((f) => <div key={f.k} className="fresh-row"><dt>{f.k}</dt><dd>{f.v}</dd></div>)}
        </dl>
      </div>
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
            <h2>One lead, from first message to paid order.</h2>
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

/* ------------------------------------------------------------- approvals */

function Approvals() {
  const [auto, setAuto] = useState(false);
  const [sent, setSent] = useState(false);
  return (
    <section id="control" className="control">
      <div className="wrap control-in">
        <div className="control-copy">
          <h2>Drafts until you trust the AI.</h2>
          <p>A new brand starts with autopilot off. The AI writes each reply and a person on your team approves it. Switch autopilot on when the drafts read right, and take any chat back with one tap.</p>
          <ul>
            <li>Set a deal amount above which a person always replies</li>
            <li>Write the promises the AI must never make</li>
            <li>See every AI order and handover in the audit trail</li>
          </ul>
        </div>
        <div className="control-ui" aria-label="Try the draft approval">
          <button className="switch-l" aria-pressed={auto} onClick={() => { setAuto((a) => !a); setSent(false); }}>
            <i aria-hidden /> <span>Autopilot</span> <b>{auto ? 'On' : 'Off'}</b>
          </button>
          <div className="b in">Is the 3 month plan refundable?</div>
          {auto || sent ? (
            <div className="b ai fresh">Yes, a full refund within the first 7 days.<small>{auto ? 'AI, sent on its own' : 'AI, approved by you'}</small></div>
          ) : (
            <div className="draft-l">
              <span>AI draft</span>
              <p>Yes, a full refund within the first 7 days.</p>
              <button className="lbtn dark" onClick={() => setSent(true)}>Approve and send</button>
            </div>
          )}
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
    // The landing page scrolls without a visible scrollbar; the app keeps its own.
    document.documentElement.classList.add('on-landing');
    return () => { window.removeEventListener('scroll', on); document.documentElement.classList.remove('on-landing'); };
  }, []);

  return (
    <div className="lp2">
      <header className={`nav ${scrolled ? 'scrolled' : ''}`}>
        <div className="wrap nav-in">
          <Link to="/" className="nav-brand" aria-label="XS Connect home"><Logo onDark width={118} /><span>Connect</span></Link>
          <nav aria-label="Sections"><a href="#story">How it works</a><a href="#features">Features</a><a href="#price">Price</a><a href="#faq">Questions</a></nav>
          <div className="nav-cta">
            <Link className="lbtn quiet" to="/login">Sign in</Link>
            <Link className="lbtn solid" to="/login?mode=signup">Try it free</Link>
          </div>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="wrap hero-in">
            <div className="hero-head">
              <h1>The AI sales inbox for WhatsApp, Instagram and Facebook.</h1>
              <div className="hero-side">
                <p>Every enquiry gets a reply in seconds, in the customer’s language, with your prices. The AI takes the order and follows up. Your team steps in for the big ones.</p>
                <div className="hero-cta">
                  <Link className="lbtn solid big" to="/login?mode=signup">Try it free</Link>
                  <a className="lbtn ghost big" href="#story">See how it works</a>
                </div>
                <p className="fine">100 AI conversations free. Then ₹5 a conversation, no monthly fee.</p>
              </div>
            </div>
            <HeroApp />
          </div>
        </section>

        <Story />
        <Approvals />

        <section id="features" className="features">
          <div className="wrap">
            <h2>Every feature in XS Connect.</h2>
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
              <h2>One price: ₹5 per AI conversation.</h2>
              <p>You pay when the AI talks to a customer. Quiet days cost nothing, and your team’s own replies are free.</p>
            </div>
            <div className="price-card">
              <div className="amount"><span className="num">₹5</span><span>per AI conversation</span></div>
              <ul>
                <li>One customer in one day counts once</li>
                <li>First 100 conversations free</li>
                <li>Any number of team members and channels</li>
                <li>Meta bills WhatsApp’s own message charges to you</li>
              </ul>
              <Link className="lbtn dark big" to="/login?mode=signup">Try it free</Link>
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
            <h2>Tonight’s enquiries get answered tonight.</h2>
            <p>Set up your brand in a few minutes and test the AI on sample chats. Connect your channels when you are ready.</p>
            <Link className="lbtn solid big" to="/login?mode=signup">Try it free</Link>
          </div>
        </section>
      </main>

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
