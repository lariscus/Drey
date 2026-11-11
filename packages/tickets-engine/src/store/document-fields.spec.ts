import { describe, expect, it } from 'vitest';
import { documentField, setDocumentField } from './document-fields';

const DOC = '---\nid: t-1\nstage: building\nrev: 3\n---\n\n## Description\n\nstage: not this one\n';

describe('one header field of a ticket document (req-265)', () => {
  it('replaces a line in place and leaves the body alone', () => {
    const next = setDocumentField(DOC, 'stage', 'active')!;
    expect(next).toBe(DOC.replace('stage: building', 'stage: active'));
    expect(documentField(next, 'stage')).toBe('active');
  });

  it('adds a missing field last in the header and removes one on null', () => {
    const pinned = setDocumentField(DOC, 'x-phase', 'building')!;
    expect(pinned).toContain('rev: 3\nx-phase: building\n---');
    expect(setDocumentField(pinned, 'x-phase', null)).toBe(DOC);
    expect(setDocumentField(DOC, 'x-phase', null)).toBe(DOC);
  });

  it('keeps CRLF and refuses text that is no ticket document', () => {
    const crlf = DOC.replace(/\n/g, '\r\n');
    expect(setDocumentField(crlf, 'stage', 'active')).toBe(crlf.replace('stage: building', 'stage: active'));
    expect(setDocumentField('no front matter', 'stage', 'active')).toBeNull();
    expect(documentField('no front matter', 'stage')).toBeNull();
  });
});
