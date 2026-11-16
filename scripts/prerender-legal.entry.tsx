// Renders the legal pages to plain HTML at build time, so they work without
// JavaScript (Meta's checker reads them that way) and answer with status 200.
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { DataDeletionPage, PrivacyPage, TermsPage } from '../src/features/legal/LegalPages';

const pages = { privacy: PrivacyPage, terms: TermsPage, 'data-deletion': DataDeletionPage };
export const rendered: Record<string, string> = Object.fromEntries(
  Object.entries(pages).map(([path, Page]) => [path, renderToStaticMarkup(<MemoryRouter basename={'/'} initialEntries={[`/${path}`]}><Page /></MemoryRouter>)]),
);
