import { describe, expect, it } from 'vitest';
import { classNameOf } from '../protocol';
import { classesOf, classKeysOf, ClassOrder, DEFAULT_CLASSES } from './class-config';
import { CLASS_LIST_MIGRATION, ClassMigration, classesMigrated } from './class-migration';
import { suggestedClassOf } from './class-suggestion';
import { MemoryFileSystem } from '../ports/memory-file-system.fake';
import { ServiceConfigFile } from './service-config-file';

describe('class names (req-287)', () => {
  it('reads a name trimmed, in lower case, with single spaces; an old letter as its name', () => {
    expect(classNameOf(' Super   Heavy ')).toBe('super heavy');
    expect(classNameOf('A')).toBe('heavy');
    expect(classNameOf('B')).toBe('standard');
    expect(classNameOf('C')).toBe('light');
    expect(classNameOf('xl-2')).toBe('xl-2');
  });

  it('a value that is no name reads as none', () => {
    for (const raw of ['', '9 lives', '#1', 'way too long a class name here', 3, null, undefined]) {
      expect(classNameOf(raw)).toBeNull();
    }
  });
});

describe('the class list of service.json (req-287)', () => {
  it('absent or empty: the shipped four, no cap', () => {
    const errors: string[] = [];
    expect(classesOf(undefined, errors)).toBe(DEFAULT_CLASSES);
    expect(classesOf([], errors)).toBe(DEFAULT_CLASSES);
    expect(DEFAULT_CLASSES.map((c) => c.name)).toEqual(['super heavy', 'heavy', 'standard', 'light']);
    expect(errors).toEqual([]);
  });

  it('reads names and { name, sessions }, strongest first; a broken entry is left out with its reason, a name twice counts once', () => {
    const errors: string[] = [];
    const classes = classesOf(['heavy', { name: 'Standard', sessions: 4 }, { name: '' }, { name: 'light', sessions: -1 }, 'heavy'], errors);
    expect(classes).toEqual([
      { name: 'heavy', sessions: null },
      { name: 'standard', sessions: 4 },
      { name: 'light', sessions: null },
    ]);
    expect(errors).toEqual(['a class needs a name of letters, digits, spaces or \'-\' (got "")', 'class "light": sessions must be a whole number of 0 or more']);
  });

  it('stores a class without a cap as its name only', () => {
    expect(classKeysOf([{ name: 'heavy', sessions: 2 }, { name: 'light', sessions: null }])).toEqual([{ name: 'heavy', sessions: 2 }, { name: 'light' }]);
  });

  it('ranks by the list; a class it does not hold ranks below every listed one (never a smaller class, R10)', () => {
    const order = new ClassOrder([{ name: 'super heavy', sessions: null }, { name: 'heavy', sessions: null }, { name: 'light', sessions: null }]);
    expect(order.rank('super heavy')).toBe(0);
    expect(order.rank('light')).toBe(2);
    expect(order.rank('unknown')).toBe(3);
    expect(order.stronger('light', 'heavy')).toBe('heavy');
    expect(order.lightestAbove(['super heavy', 'heavy', 'light'], 'light')).toBe('heavy');
    expect(order.lightestAbove(['light'], 'heavy')).toBeNull();
    expect(order.has('heavy')).toBe(true);
  });
});

describe('the move of A · B · C into the class list (req-287)', () => {
  it('names the rows, drops their sessions into the class caps, keeps an existing list', () => {
    const root = {
      models: [
        { model: 'opus', slot: 'claude-a', class: 'A', cost: 5, sessions: 1 },
        { model: 'kimi-k3', provider: 'kimi', class: 'A', sessions: 1 },
        { model: 'sonnet', provider: 'claude-code', class: 'B', sessions: 2 },
        { model: 'haiku', provider: 'claude-code', class: 'C' },
      ],
      slots: [],
    };
    const moved = classesMigrated(root);
    expect(moved['classes']).toEqual([{ name: 'super heavy' }, { name: 'heavy', sessions: 2 }, { name: 'standard', sessions: 2 }, { name: 'light' }]);
    expect(moved['models']).toEqual([
      { model: 'opus', slot: 'claude-a', class: 'heavy', cost: 5 },
      { model: 'kimi-k3', provider: 'kimi', class: 'heavy' },
      { model: 'sonnet', provider: 'claude-code', class: 'standard' },
      { model: 'haiku', provider: 'claude-code', class: 'light' },
    ]);
    expect(classesMigrated({ classes: ['big', 'small'], models: [] })['classes']).toEqual(['big', 'small']);
  });

  it('runs once: the marker stays, a second run writes nothing', async () => {
    const fs = new MemoryFileSystem();
    const file = new ServiceConfigFile(fs, '/home/service.json');
    await fs.writeText('/home/service.json', JSON.stringify({ slots: [], models: [{ model: 'm', provider: 'kimi', class: 'C', sessions: 3 }] }));
    const lines: string[] = [];
    const migration = new ClassMigration(file, (line) => lines.push(line));
    expect(await migration.run()).toBe(true);
    const root = (await file.read()).root;
    expect(root['migrations']).toEqual([CLASS_LIST_MIGRATION]);
    expect(root['models']).toEqual([{ model: 'm', provider: 'kimi', class: 'light' }]);
    expect((root['classes'] as unknown[]).at(-1)).toEqual({ name: 'light', sessions: 3 });
    expect(await migration.run()).toBe(false);
    expect(lines).toHaveLength(1);
  });

  it('leaves a file that does not parse alone', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeText('/home/service.json', '{ broken');
    expect(await new ClassMigration(new ServiceConfigFile(fs, '/home/service.json'), () => undefined).run()).toBe(false);
    expect(await fs.readText('/home/service.json')).toBe('{ broken');
  });
});

describe('the class a new-model card proposes (req-286)', () => {
  const classes = ['super heavy', 'heavy', 'standard', 'light'];
  it.each([
    ['claude-fable-5-2', 'super heavy'],
    ['claude-opus-5-5', 'heavy'],
    ['kimi-k3.1-pro', 'heavy'],
    ['claude-sonnet-5-5', 'standard'],
    ['zai-coding-plan/glm-5.3-air', 'light'],
    ['claude-haiku-5-5', 'light'],
  ])('%s → %s', (model, expected) => {
    expect(suggestedClassOf(model, classes)).toBe(expected);
  });

  it('a list without standard: its middle class', () => {
    expect(suggestedClassOf('gpt-5.4', ['big', 'mid', 'small'])).toBe('mid');
  });
});
