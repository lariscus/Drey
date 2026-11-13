// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { PersonaPictures } from './persona-pictures';

const URL_BEN = 'data:image/png;base64,QkVO';

function picturesWith(reply: (persona: string) => unknown = () => ({ ok: true, dataUrl: URL_BEN })): { pictures: PersonaPictures; invoke: ReturnType<typeof vi.fn> } {
  const pictures = new PersonaPictures();
  const invoke = vi.fn(async (_method: string, payload?: unknown) => reply((payload as { persona: string }).persona));
  pictures.connect(invoke);
  return { pictures, invoke };
}

function circle(text = 'BE'): HTMLElement {
  const node = document.createElement('span');
  node.className = 'desk-cap-avatar';
  node.textContent = text;
  return node;
}

describe('PersonaPictures — the picture in every persona circle (req-292)', () => {
  it('draws the picture into a circle in place of the initials, other children stay', async () => {
    const { pictures, invoke } = picturesWith();
    pictures.note([{ id: 'ben', avatarVersion: 'v1' }]);
    const node = circle();
    const dot = document.createElement('span');
    dot.className = 'desk-cap-stuckdot';
    node.append(dot);
    pictures.paint(node, 'ben');
    await pictures.idle();
    expect(invoke).toHaveBeenCalledWith('personaAvatar', { persona: 'ben' });
    const img = node.querySelector('img.persona-picture') as HTMLImageElement;
    expect(img.src).toBe(URL_BEN);
    expect(node.classList.contains('has-picture')).toBe(true);
    expect(node.textContent).toBe('');
    expect(node.querySelector('.desk-cap-stuckdot')).not.toBeNull();
  });

  it('asks for nothing and keeps the initials for a persona without a picture', async () => {
    const { pictures, invoke } = picturesWith();
    pictures.note([{ id: 'paul' }]);
    const node = circle('PA');
    expect(pictures.paint(node, 'paul')).toBe(node);
    pictures.paint(circle(), null);
    await pictures.idle();
    expect(invoke).not.toHaveBeenCalled();
    expect(node.textContent).toBe('PA');
    expect(node.querySelector('img')).toBeNull();
  });

  it('keeps the initials when the engine has no picture after all, or the call fails', async () => {
    const { pictures } = picturesWith((persona) => (persona === 'ralf' ? { ok: false, error: 'persona ralf has no picture' } : Promise.reject(new Error('gone'))));
    pictures.note([{ id: 'ralf', avatarVersion: 'v1' }, { id: 'tessa', avatarVersion: 'v1' }]);
    const ralf = circle('RA');
    const tessa = circle('TE');
    pictures.paint(ralf, 'ralf');
    pictures.paint(tessa, 'tessa');
    await pictures.idle();
    expect(ralf.textContent).toBe('RA');
    expect(tessa.textContent).toBe('TE');
    expect(pictures.urlOf('ralf')).toBeNull();
  });

  it('asks once per version and draws a known picture at once on the next render', async () => {
    const { pictures, invoke } = picturesWith();
    pictures.note([{ id: 'ben', avatarVersion: 'v1' }]);
    pictures.paint(circle(), 'ben');
    pictures.paint(circle(), 'ben');
    await pictures.idle();
    expect(invoke).toHaveBeenCalledTimes(1);
    const again = circle();
    pictures.paint(again, 'ben');
    expect(again.querySelector('img')).not.toBeNull();
    pictures.note([{ id: 'ben', avatarVersion: 'v2' }]);
    pictures.paint(circle(), 'ben');
    await pictures.idle();
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('a persona whose picture went away draws its initials again', async () => {
    const { pictures } = picturesWith();
    pictures.note([{ id: 'ben', avatarVersion: 'v1' }]);
    pictures.paint(circle(), 'ben');
    await pictures.idle();
    pictures.note([{ id: 'ben' }]);
    const node = circle();
    pictures.paint(node, 'ben');
    expect(node.textContent).toBe('BE');
  });

  it('replaces a silhouette with a picture of its size and classes, the name as its text', async () => {
    const { pictures } = picturesWith();
    pictures.note([{ id: 'ben', avatarVersion: 'v1' }]);
    const holder = document.createElement('span');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'desk-silhouette');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    holder.append(svg);
    pictures.paint(svg, 'ben', 'Ben');
    await pictures.idle();
    const img = holder.firstElementChild as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.classList.contains('desk-silhouette')).toBe(true);
    expect(img.classList.contains('persona-picture')).toBe(true);
    expect([img.width, img.height, img.alt]).toEqual([24, 24, 'Ben']);
    // In memory now: the next silhouette is handed back as the picture straight away.
    const next = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    expect(pictures.paint(next, 'ben', 'Ben').tagName).toBe('IMG');
  });

  it('asks for nothing before the IPC seam is connected', async () => {
    const pictures = new PersonaPictures();
    pictures.note([{ id: 'ben', avatarVersion: 'v1' }]);
    const node = circle();
    pictures.paint(node, 'ben');
    await pictures.idle();
    expect(node.querySelector('img')).toBeNull();
  });
});
