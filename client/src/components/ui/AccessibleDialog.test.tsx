import { useState, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CredentialsModal } from '../providers/CredentialsModal';
import { LinkPlatformDialog } from '../person/LinkPlatformDialog';
import { LinkRelationshipDialog } from '../person/LinkRelationshipDialog';
import { RelationshipModal } from '../person/RelationshipModal';
import { AccessibleDialog } from './AccessibleDialog';

vi.mock('../../services/api', () => ({
  api: {
    addRelationship: vi.fn(),
    linkRelationship: vi.fn(),
    quickSearchPersons: vi.fn(),
    search: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

afterEach(() => cleanup());

interface DialogFixtureProps {
  triggerName: string;
  children: (open: boolean, onClose: () => void) => ReactNode;
}

function DialogFixture({ triggerName, children }: DialogFixtureProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>{triggerName}</button>
      {children(open, () => setOpen(false))}
    </>
  );
}

async function verifyModalKeyboardFlow(
  triggerName: string,
  dialogName: string,
  initialControlName: string,
  verifyOpen?: () => void,
) {
  const trigger = screen.getByRole('button', { name: triggerName });
  trigger.focus();
  fireEvent.click(trigger);

  const dialog = await screen.findByRole('dialog', { name: dialogName });
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  verifyOpen?.();
  const initialControl = screen.getByRole('textbox', { name: initialControlName });
  await waitFor(() => expect(document.activeElement).toBe(initialControl));

  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>([
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',')));
  expect(focusable.length).toBeGreaterThan(1);

  focusable[focusable.length - 1].focus();
  fireEvent.keyDown(focusable[focusable.length - 1], { key: 'Tab' });
  expect(document.activeElement).toBe(focusable[0]);

  focusable[0].focus();
  fireEvent.keyDown(focusable[0], { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(focusable[focusable.length - 1]);

  // A native dialog emits `cancel` for Escape. Dispatching that event exercises
  // the same cancellable close path without depending on browser key synthesis.
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: dialogName })).toBeNull());
  expect(document.activeElement).toBe(trigger);
}

describe('accessible application dialogs', () => {
  it('makes provider credentials modal and keyboard accessible', async () => {
    render(
      <DialogFixture triggerName="Open credentials">
        {(open, onClose) => open ? (
          <CredentialsModal
            isOpen
            onClose={onClose}
            onSave={vi.fn(async () => undefined)}
            provider="familysearch"
            displayName="FamilySearch"
          />
        ) : null}
      </DialogFixture>,
    );

    await verifyModalKeyboardFlow('Open credentials', 'Add FamilySearch Credentials', 'Email', () => {
      expect(screen.getByRole('button', { name: 'Close dialog' })).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Show password' })).not.toBeNull();
      expect(screen.getByRole('textbox', { name: 'Email' })).not.toBeNull();
      expect(screen.getByLabelText('Password')).not.toBeNull();
    });
  });

  it('makes platform linking modal and keyboard accessible', async () => {
    render(
      <DialogFixture triggerName="Open platform link">
        {(open, onClose) => (
          <LinkPlatformDialog
            platform={open ? 'wikipedia' : null}
            onClose={onClose}
            onLink={vi.fn(async () => undefined)}
          />
        )}
      </DialogFixture>,
    );

    await verifyModalKeyboardFlow('Open platform link', 'Link Wikipedia Article', 'Wikipedia Article URL');
  });

  it('makes relationship creation modal and keyboard accessible', async () => {
    render(
      <DialogFixture triggerName="Open relationship linker">
        {(open, onClose) => (
          <LinkRelationshipDialog
            open={open}
            dbId="db-id"
            personId="person-id"
            onClose={onClose}
            onLinked={vi.fn()}
          />
        )}
      </DialogFixture>,
    );

    await verifyModalKeyboardFlow('Open relationship linker', 'Add Relationship', 'Search people');
  });

  it('makes quick relationship editing modal and keyboard accessible', async () => {
    render(
      <DialogFixture triggerName="Open relationship editor">
        {(open, onClose) => (
          <RelationshipModal
            open={open}
            dbId="db-id"
            personId="person-id"
            onClose={onClose}
            onLinked={vi.fn()}
          />
        )}
      </DialogFixture>,
    );

    await verifyModalKeyboardFlow('Open relationship editor', 'Add Relationship', 'Search people');
  });

  it('keeps a busy operation modal open when Escape is requested', () => {
    const onClose = vi.fn();
    render(
      <AccessibleDialog
        open
        labelledBy="busy-dialog-title"
        canClose={false}
        onClose={onClose}
      >
        <div>
          <h2 id="busy-dialog-title">Saving relationship</h2>
          <button type="button">Working</button>
        </div>
      </AccessibleDialog>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Saving relationship' });
    fireEvent(dialog, new Event('cancel', { cancelable: true }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Saving relationship' })).toBe(dialog);
  });
});
