import { describe, it, expect } from 'vitest';
import {
  skillBlock,
  skillBodiesFor,
  type LinkedSkillLike,
} from '../src/modules/reviews/helpers.js';

function link(order: number, name: string, body: string, enabled = true): LinkedSkillLike {
  return { order, skill: { id: name, name, body, enabled } };
}

describe('skillBodiesFor', () => {
  it('emits bodies in binding order, whatever order they arrive in', () => {
    expect(
      skillBodiesFor([
        link(2, 'Third', '# Third'),
        link(0, 'First', '# First'),
        link(1, 'Second', '# Second'),
      ]),
    ).toEqual(['# First', '# Second', '# Third']);
  });

  it('drops a globally-disabled skill and closes the gap', () => {
    expect(
      skillBodiesFor([
        link(0, 'On', '# On'),
        link(1, 'Off', '# Off', false),
        link(2, 'Also on', '# Also on'),
      ]),
    ).toEqual(['# On', '# Also on']);
  });

  it('returns nothing for no bindings, and nothing when every skill is off', () => {
    expect(skillBodiesFor([])).toEqual([]);
    expect(skillBodiesFor([link(0, 'Off', '# Off', false)])).toEqual([]);
  });

  it('does not reorder the array it was handed', () => {
    const links = [link(1, 'B', '# B'), link(0, 'A', '# A')];
    skillBodiesFor(links);
    expect(links.map((l) => l.skill.name)).toEqual(['B', 'A']);
  });

  it('labels a body that carries no heading of its own', () => {
    expect(skillBodiesFor([link(0, 'Flakiness', 'Never sleep in a test.')])).toEqual([
      '### Flakiness\nNever sleep in a test.',
    ]);
  });
});

describe('skillBlock', () => {
  it.each(['# H1', '## H2', '###### H6', '  # indented', '#\ttab'])(
    'leaves %j alone — it already announces itself',
    (body) => {
      expect(skillBlock('Name', body)).toBe(body);
    },
  );

  it.each(['plain text', '#nospace', '- a list', '**bold**', '####### seven hashes'])(
    'prefixes the skill name onto %j',
    (body) => {
      expect(skillBlock('Name', body)).toBe(`### Name\n${body}`);
    },
  );
});
