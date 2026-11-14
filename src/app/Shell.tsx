import { BarChart3, Brain, Home, Inbox, LogOut, Menu, Settings, ShoppingBag, Target } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { AppearanceButton, AppearanceControl } from '../components/Appearance';
import { Logo, Sheet } from '../components/ui';
import { setTransition } from '../lib/motion';
import { overviewQuery } from '../lib/sections';
import { supabase } from '../lib/supabase';
import { ROLE_LABEL } from '../lib/types';
import { useWorkspace } from './workspace';

type NavItem = { to: string; label: string; icon: ComponentType<{ size?: number; strokeWidth?: number }>; perm: string };

const NAV: NavItem[] = [
  { to: '', label: 'Home', icon: Home, perm: 'inbox.read' },
  { to: 'inbox', label: 'Inbox', icon: Inbox, perm: 'inbox.read' },
  { to: 'leads', label: 'Leads', icon: Target, perm: 'leads.read' },
  { to: 'orders', label: 'Orders', icon: ShoppingBag, perm: 'orders.read' },
  { to: 'brain', label: 'Brand Brain', icon: Brain, perm: 'brain.read' },
  { to: 'analytics', label: 'Analytics', icon: BarChart3, perm: 'reports.read' },
  { to: 'settings', label: 'Settings', icon: Settings, perm: 'staff.read' },
];

// Transparent badge: black on light backgrounds, white on dark (brand rule).
const mark = `${import.meta.env.BASE_URL}brand/badge-black.svg`;
const markOnDark = `${import.meta.env.BASE_URL}brand/badge-white.svg`;

export function Shell() {
  const { ws, role, can } = useWorkspace();
  const [more, setMore] = useState(false);
  const location = useLocation();
  const items = NAV.filter((n) => can(n.perm));
  const primary = items.slice(0, 4);
  const overflow = items.slice(4);
  const base = `/b/${ws.slug}`;
  const link = (n: NavItem) => (n.to ? `${base}/${n.to}` : base);
  const onOverflowRoute = overflow.some((n) => location.pathname.startsWith(link(n)));
  const tab = () => setTransition('tab');
  // Chats waiting for a person show as a count on Inbox.
  const overview = useQuery(overviewQuery(ws.id, 30));
  const waiting = (overview.data?.waiting ?? 0) + (overview.data?.drafts ?? 0);
  const count = (n: NavItem) => (n.to === 'inbox' && waiting > 0 ? <span className="nav-count">{waiting}</span> : null);

  // Liquid Glass tab bar: an indicator glides to the active tab.
  const tabbar = useRef<HTMLElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const place = () => {
      const active = tabbar.current?.querySelector<HTMLElement>('a.active, button.active');
      const ind = indicator.current;
      if (!ind) return;
      if (!active) { ind.style.opacity = '0'; return; }
      ind.style.opacity = '1';
      ind.style.width = `${active.offsetWidth}px`;
      ind.style.transform = `translateX(${active.offsetLeft}px)`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [location.pathname, more]);

  // A chat fills the phone screen like a messaging app: no tab bar behind it.
  const inChat = /\/inbox\/[^/]+$/.test(location.pathname);

  return (
    <div className={`shell ${inChat ? 'in-chat' : ''}`}>
      <nav className="sidebar" aria-label="Main">
        <Logo onDark width={148} className="logo full" />
        <img className="rail-mark" src={markOnDark} alt="Xelorsoft" width={36} height={36} />
        <div className="gym-block">
          <strong>{ws.name}</strong>
          <span>{ROLE_LABEL[role]}</span>
        </div>
        {items.map((n) => (
          <NavLink key={n.label} to={link(n)} end={!n.to} onClick={tab} title={n.label}>
            <n.icon size={20} strokeWidth={1.9} /> <span className="nav-label">{n.label}</span>{count(n)}
          </NavLink>
        ))}
        <div className="grow" />
        <AppearanceButton className="signout" />
        <button className="signout" onClick={() => supabase.auth.signOut()} title="Sign out">
          <LogOut size={20} strokeWidth={1.9} /> <span className="nav-label">Sign out</span>
        </button>
      </nav>

      <div className="content">
        <header className="topbar">
          <img className="brand-mark only-light" src={mark} alt="" width={26} height={26} />
          <img className="brand-mark only-dark" src={markOnDark} alt="" width={26} height={26} />
          <span className="gym">{ws.name}</span>
        </header>
        <main className="main">
          <Outlet />
        </main>
      </div>

      <nav className="tabbar" aria-label="Main" ref={tabbar}>
        <span className="tab-indicator" ref={indicator} aria-hidden />
        {primary.map((n) => (
          <NavLink key={n.label} to={link(n)} end={!n.to} onClick={tab}>
            <n.icon size={23} strokeWidth={1.8} /> <span>{n.label}</span>{count(n)}
          </NavLink>
        ))}
        <button onClick={() => setMore(true)} className={onOverflowRoute || more ? 'active' : ''} aria-haspopup="dialog">
          <Menu size={23} strokeWidth={1.8} /> <span>More</span>
        </button>
      </nav>

      {more && (
        <Sheet title="More" onClose={() => setMore(false)}>
          <div className="appearance-row">
            <span>Appearance</span>
            <AppearanceControl />
          </div>
          <ul className="list grouped">
            {overflow.map((n) => (
              <li key={n.label}>
                <NavLink className="item" to={link(n)} onClick={() => { tab(); setMore(false); }}>
                  <n.icon size={20} /> <span className="main-col"><span className="title">{n.label}</span></span>
                </NavLink>
              </li>
            ))}
            <li>
              <button className="item" onClick={() => supabase.auth.signOut()}>
                <LogOut size={20} /> <span className="main-col"><span className="title">Sign out</span></span>
              </button>
            </li>
          </ul>
        </Sheet>
      )}
    </div>
  );
}
