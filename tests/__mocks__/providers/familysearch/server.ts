/**
 * Mock FamilySearch server for scraper testing
 * Serves realistic HTML pages with fixture data
 */

import express, { Express, Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load templates
const PERSON_DETAIL_TEMPLATE = readFileSync(join(__dirname, 'pages/person-detail.html'), 'utf-8');
const LOGIN_TEMPLATE = readFileSync(join(__dirname, 'pages/login.html'), 'utf-8');

// Mock person database
const MOCK_PERSONS: Record<string, MockPerson> = {
  'TEST-001': {
    id: 'TEST-001',
    name: 'John Smith',
    gender: 'Male',
    birthDate: '1 January 1850',
    birthPlace: 'Boston, Massachusetts, United States',
    deathDate: '15 December 1920',
    deathPlace: 'New York, New York, United States',
    photoUrl: '/assets/portrait-test-001.jpg',
    fatherId: 'TEST-002',
    fatherName: 'James Smith',
    motherId: 'TEST-003',
    motherName: 'Mary Johnson',
    children: [
      { id: 'TEST-004', name: 'Robert Smith' },
      { id: 'TEST-005', name: 'Elizabeth Smith' }
    ]
  },
  'TEST-002': {
    id: 'TEST-002',
    name: 'James Smith',
    gender: 'Male',
    birthDate: '15 March 1820',
    birthPlace: 'London, England',
    deathDate: '20 August 1890',
    deathPlace: 'Boston, Massachusetts, United States',
    photoUrl: '/assets/portrait-test-002.jpg',
    fatherId: 'TEST-006',
    fatherName: 'William Smith',
    children: [{ id: 'TEST-001', name: 'John Smith' }]
  },
  'TEST-003': {
    id: 'TEST-003',
    name: 'Mary Johnson',
    gender: 'Female',
    birthDate: '22 June 1825',
    birthPlace: 'Dublin, Ireland',
    deathDate: '10 November 1895',
    deathPlace: 'Boston, Massachusetts, United States',
    photoUrl: '/assets/portrait-test-003.jpg',
    children: [{ id: 'TEST-001', name: 'John Smith' }]
  }
};

interface MockPerson {
  id: string;
  name: string;
  gender: string;
  birthDate?: string;
  birthPlace?: string;
  deathDate?: string;
  deathPlace?: string;
  photoUrl?: string;
  fatherId?: string;
  fatherName?: string;
  motherId?: string;
  motherName?: string;
  children?: Array<{ id: string; name: string }>;
}

interface ServerState {
  isLoggedIn: boolean;
  currentUser: string | null;
}

/**
 * Create a mock FamilySearch server
 */
export function createMockFamilySearchServer(port = 3333): {
  app: Express;
  state: ServerState;
  addPerson: (person: MockPerson) => void;
  start: () => Promise<void>;
  stop: () => void;
} {
  const app = express();
  let server: ReturnType<typeof app.listen> | null = null;

  const state: ServerState = {
    isLoggedIn: false,
    currentUser: null
  };

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Static assets
  app.use('/assets', express.static(join(__dirname, 'assets')));

  // Login page
  app.get('/signin', (_req: Request, res: Response) => {
    res.send(LOGIN_TEMPLATE);
  });

  // Login handler
  app.post('/signin', (req: Request, res: Response) => {
    const { userName, password } = req.body;

    // Accept test credentials
    if (userName === 'testuser' && password === 'testpass') {
      state.isLoggedIn = true;
      state.currentUser = userName;
      res.redirect('/tree/');
    } else {
      res.redirect('/signin?error=invalid');
    }
  });

  // Logout
  app.get('/logout', (_req: Request, res: Response) => {
    state.isLoggedIn = false;
    state.currentUser = null;
    res.redirect('/signin');
  });

  // Tree root page (requires login)
  app.get('/tree/', (req: Request, res: Response) => {
    if (!state.isLoggedIn) {
      return res.redirect('/signin');
    }
    res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>FamilySearch Tree (Mock)</title></head>
      <body>
        <div data-testid="user-menu" class="user-menu">
          <span data-testid="header-user-name">${state.currentUser}</span>
        </div>
        <h1>Welcome to FamilySearch (Mock)</h1>
        <p>Select a person to view their details.</p>
      </body>
      </html>
    `);
  });

  // Person details page
  app.get('/tree/person/details/:personId', (req: Request, res: Response) => {
    if (!state.isLoggedIn) {
      return res.redirect('/signin');
    }

    const personId = req.params.personId;
    const person = MOCK_PERSONS[personId];

    if (!person) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Person Not Found</title></head>
        <body>
          <div data-testid="user-menu" class="user-menu">
            <span>${state.currentUser}</span>
          </div>
          <h1>Person Not Found</h1>
          <p>The person with ID ${personId} was not found.</p>
        </body>
        </html>
      `);
    }

    // Render template with person data
    const html = renderPersonPage(person, state.currentUser || 'Test User');
    res.send(html);
  });

  // API endpoint for person data (JSON)
  app.get('/api/tree/persons/:personId', (req: Request, res: Response) => {
    const personId = req.params.personId;
    const person = MOCK_PERSONS[personId];

    if (!person) {
      return res.status(404).json({ error: 'Person not found' });
    }

    res.json(person);
  });

  /**
   * Add a person to the mock database
   */
  function addPerson(person: MockPerson): void {
    MOCK_PERSONS[person.id] = person;
  }

  /**
   * Start the server
   */
  async function start(): Promise<void> {
    return new Promise((resolve) => {
      server = app.listen(port, () => {
        console.log(`Mock FamilySearch server running on http://localhost:${port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the server
   */
  function stop(): void {
    if (server) {
      server.close();
      server = null;
    }
  }

  return { app, state, addPerson, start, stop };
}

/**
 * Render person detail page with data
 */
function renderPersonPage(person: MockPerson, userName: string): string {
  let html = PERSON_DETAIL_TEMPLATE;

  // Simple template replacement
  const replacements: Record<string, string> = {
    '{{PERSON_ID}}': person.id,
    '{{PERSON_NAME}}': person.name,
    '{{GENDER}}': person.gender,
    '{{BIRTH_DATE}}': person.birthDate || '',
    '{{BIRTH_PLACE}}': person.birthPlace || '',
    '{{DEATH_DATE}}': person.deathDate || '',
    '{{DEATH_PLACE}}': person.deathPlace || '',
    '{{PHOTO_URL}}': person.photoUrl || '/assets/default-portrait.png',
    '{{FATHER_ID}}': person.fatherId || '',
    '{{FATHER_NAME}}': person.fatherName || '',
    '{{MOTHER_ID}}': person.motherId || '',
    '{{MOTHER_NAME}}': person.motherName || '',
    '{{USER_NAME}}': userName
  };

  for (const [key, value] of Object.entries(replacements)) {
    html = html.replace(new RegExp(key, 'g'), value);
  }

  // Handle conditional sections (simple handling)
  if (!person.fatherId) {
    html = html.replace(/{{#if FATHER_ID}}[\s\S]*?{{\/if}}/g, '');
  } else {
    html = html.replace(/{{#if FATHER_ID}}/g, '').replace(/{{\/if}}/g, '');
  }

  if (!person.motherId) {
    html = html.replace(/{{#if MOTHER_ID}}[\s\S]*?{{\/if}}/g, '');
  } else {
    html = html.replace(/{{#if MOTHER_ID}}/g, '').replace(/{{\/if}}/g, '');
  }

  // Handle children
  if (!person.children || person.children.length === 0) {
    html = html.replace(/{{#if CHILDREN}}[\s\S]*?{{\/if}}/g, '');
  } else {
    html = html.replace(/{{#if CHILDREN}}/g, '').replace(/{{\/if}}/g, '');
    // Replace children loop (simplified)
    const childrenHtml = person.children.map(child =>
      `<div class="family-member" data-testid="child-card">
        <a href="/tree/person/details/${child.id}" data-testid="child-link">${child.name}</a>
      </div>`
    ).join('\n');
    html = html.replace(/{{#each CHILDREN}}[\s\S]*?{{\/each}}/g, childrenHtml);
  }

  return html;
}

// Export for testing
export { MOCK_PERSONS };
export type { MockPerson, ServerState };
