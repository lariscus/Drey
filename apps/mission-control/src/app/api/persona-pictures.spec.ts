/**
 * req-292 — Mission Control's persona pictures: the persona list's
 * `avatarVersion` says which persona has a picture; each picture is fetched
 * once per version, the first time a circle names its persona (by id or by
 * title), and then read from memory. No version, no request.
 */
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { parseTeam } from '@mission-ui/api/dto';
import { McPersonaPictureStore, pictureUrlOf, type PicturePersona } from './persona-pictures';

const URL_BEN = 'data:image/png;base64,QkVO';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('McPersonaPictureStore (req-292)', () => {
  it('fetches a picture once per version and hands it out by id or title', async () => {
    const personas = signal<readonly PicturePersona[]>([{ id: 'ben', title: 'Ben', avatarVersion: 'v1' }]);
    const fetch = vi.fn(async () => URL_BEN);
    const store = new McPersonaPictureStore(personas, fetch);
    expect(store.pictureOf('ben')).toBeNull();
    expect(store.pictureOf('Ben')).toBeNull();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('ben');
    expect(store.pictureOf('ben')).toBe(URL_BEN);
    expect(store.pictureOf(' ben ')).toBe(URL_BEN);
    personas.set([{ id: 'ben', title: 'Ben', avatarVersion: 'v2' }]);
    expect(store.pictureOf('ben')).toBeNull();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('asks for nothing for a persona without a picture or one it does not know', async () => {
    const fetch = vi.fn(async () => URL_BEN);
    const store = new McPersonaPictureStore(signal([{ id: 'paul', title: 'Paul' }]), fetch);
    expect(store.pictureOf('paul')).toBeNull();
    expect(store.pictureOf('carla')).toBeNull();
    await flush();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a failed fetch leaves the silhouette and is not asked again for the same version', async () => {
    const fetch = vi.fn(async () => null);
    const store = new McPersonaPictureStore(signal([{ id: 'ben', title: 'Ben', avatarVersion: 'v1' }]), fetch);
    store.pictureOf('ben');
    await flush();
    expect(store.pictureOf('ben')).toBeNull();
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reads the route reply: a data:image URL or none', () => {
    expect(pictureUrlOf({ ok: true, dataUrl: URL_BEN })).toBe(URL_BEN);
    expect(pictureUrlOf({ ok: false, error: 'persona ben has no picture' })).toBeNull();
    expect(pictureUrlOf({ ok: true, dataUrl: 'javascript:alert(1)' })).toBeNull();
    expect(pictureUrlOf(null)).toBeNull();
  });

  it('the persona list carries the version through parseTeam', () => {
    const team = parseTeam([{ id: 'ben', title: 'Ben', color: '#7dd3fc', avatarVersion: 'v1' }, { id: 'paul', title: 'Paul', color: '#f9a8d4' }], { runs: [] });
    expect(team.personas.find((p) => p.id === 'ben')?.avatarVersion).toBe('v1');
    expect(team.personas.find((p) => p.id === 'paul')).not.toHaveProperty('avatarVersion');
  });
});
