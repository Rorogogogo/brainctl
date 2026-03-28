import { describe, expect, it } from 'vitest';

import {
  addSkillDraft,
  addMcpDraft,
  areMcpDraftsDirty,
  areSkillDraftsDirty,
  buildMcpSavePayload,
  buildSkillSavePayload,
  createMcpDraftsFromConfig,
  createSkillDraftsFromConfig,
  getEditorNavigationDisposition,
  parseMcpJsonPayload,
  removeMcpDraft,
  removeSkillDraft,
  serializeMcpValueForEditing,
  updateMcpDraft,
  updateSkillDraft,
  type SkillDraft
} from '../web/src/config-editor.js';

describe('config editor helpers', () => {
  it('adds, updates, and removes skill drafts immutably', () => {
    const original: SkillDraft[] = [
      {
        id: 'skill:summarize',
        name: 'summarize',
        description: 'Summarize content',
        prompt: 'Summarize the following content.'
      }
    ];

    const withAddedDraft = addSkillDraft(original);
    expect(withAddedDraft).toHaveLength(2);
    expect(withAddedDraft[1]).toEqual({
      id: expect.stringMatching(/^skill:new:/),
      name: '',
      description: '',
      prompt: ''
    });
    expect(withAddedDraft[0]?.id).toBe('skill:summarize');
    expect(original).toHaveLength(1);

    const updatedDrafts = updateSkillDraft(original, 0, {
      description: 'Summarize longer content',
      prompt: 'Summarize the following content into concise bullet points.'
    });

    expect(updatedDrafts[0]).toEqual({
      id: 'skill:summarize',
      name: 'summarize',
      description: 'Summarize longer content',
      prompt: 'Summarize the following content into concise bullet points.'
    });
    expect(original[0]).toEqual({
      id: 'skill:summarize',
      name: 'summarize',
      description: 'Summarize content',
      prompt: 'Summarize the following content.'
    });

    const withoutFirstDraft = removeSkillDraft(original, 0);
    expect(withoutFirstDraft).toEqual([]);
    expect(original).toHaveLength(1);
  });

  it('creates skill drafts from saved config entries', () => {
    expect(
      createSkillDraftsFromConfig({
        summarize: {
          description: 'Summarize content',
          prompt: 'Summarize the following content.'
        },
        research: {
          prompt: 'Research the topic and return key findings.'
        }
      })
    ).toEqual([
      {
        id: 'skill:research',
        name: 'research',
        description: '',
        prompt: 'Research the topic and return key findings.'
      },
      {
        id: 'skill:summarize',
        name: 'summarize',
        description: 'Summarize content',
        prompt: 'Summarize the following content.'
      }
    ]);
  });

  it('builds a skill save payload from valid drafts', () => {
    const payload = buildSkillSavePayload([
      {
        name: ' summarize ',
        description: 'Summarize content',
        prompt: 'Summarize the following content.'
      },
      {
        name: 'research',
        description: '',
        prompt: 'Research the topic and return key findings.'
      }
    ]);

    expect(payload).toEqual({
      summarize: {
        description: 'Summarize content',
        prompt: 'Summarize the following content.'
      },
      research: {
        prompt: 'Research the topic and return key findings.'
      }
    });
  });

  it('treats skill drafts with only id differences as clean', () => {
    expect(
      areSkillDraftsDirty(
        [
          {
            id: 'skill:new:7',
            name: 'summarize',
            description: 'Summarize content',
            prompt: 'Summarize the following content.'
          }
        ],
        {
          summarize: {
            description: 'Summarize content',
            prompt: 'Summarize the following content.'
          }
        }
      )
    ).toBe(false);
  });

  it('rejects blank or duplicate skill names when building a save payload', () => {
    expect(() =>
      buildSkillSavePayload([
        {
          name: ' ',
          description: '',
          prompt: 'Summarize the following content.'
        }
      ])
    ).toThrow('Skill names must not be blank.');

    expect(() =>
      buildSkillSavePayload([
        {
          name: 'summarize',
          description: '',
          prompt: 'Summarize the following content.'
        },
        {
          name: ' summarize ',
          description: '',
          prompt: 'Summarize different content.'
        }
      ])
    ).toThrow('Duplicate skill name "summarize".');
  });

  it('rejects blank prompts and empty skill lists when building a save payload', () => {
    expect(() =>
      buildSkillSavePayload([
        {
          name: 'summarize',
          description: '',
          prompt: '   '
        }
      ])
    ).toThrow('Skill "summarize" must have a non-blank prompt.');

    expect(() => buildSkillSavePayload([])).toThrow('At least one skill must be configured.');
  });

  it('parses MCP JSON payloads', () => {
    expect(
      parseMcpJsonPayload('{\n  "command": "npx",\n  "args": ["-y", "@modelcontextprotocol/server-github"]\n}')
    ).toEqual({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github']
    });
  });

  it('rejects malformed MCP JSON payloads with a clear helper error', () => {
    expect(() => parseMcpJsonPayload('{')).toThrow('MCP JSON payload could not be parsed.');
  });

  it('serializes MCP values for editing', () => {
    expect(
      serializeMcpValueForEditing({
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github']
      })
    ).toBe(
      '{\n' +
        '  "command": "npx",\n' +
        '  "args": [\n' +
        '    "-y",\n' +
        '    "@modelcontextprotocol/server-github"\n' +
        '  ]\n' +
        '}'
    );
  });

  it('builds an MCP save payload from valid drafts', () => {
    expect(
      buildMcpSavePayload([
        {
          name: 'github',
          json: '{\n  "command": "npx",\n  "args": ["-y", "@modelcontextprotocol/server-github"]\n}'
        },
        {
          name: 'filesystem',
          json: 'true'
        }
      ])
    ).toEqual({
      github: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github']
      },
      filesystem: true
    });
  });

  it('treats mcp drafts with only id differences as clean', () => {
    expect(
      areMcpDraftsDirty(
        [
          {
            id: 'mcp:new:3',
            name: 'github',
            json: '{\n  "command": "npx"\n}'
          }
        ],
        {
          github: {
            command: 'npx'
          }
        }
      )
    ).toBe(false);
  });

  it('creates, adds, updates, and removes MCP drafts immutably', () => {
    const original = createMcpDraftsFromConfig({
      github: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github']
      }
    });

    expect(original).toEqual([
      {
        id: 'mcp:github',
        name: 'github',
        json:
          '{\n' +
          '  "command": "npx",\n' +
          '  "args": [\n' +
          '    "-y",\n' +
          '    "@modelcontextprotocol/server-github"\n' +
          '  ]\n' +
          '}'
      }
    ]);

    const withAddedDraft = addMcpDraft(original);
    expect(withAddedDraft).toHaveLength(2);
    expect(withAddedDraft[1]).toEqual({
      id: expect.stringMatching(/^mcp:new:/),
      name: '',
      json: '{}'
    });
    expect(original).toHaveLength(1);

    const updatedDrafts = updateMcpDraft(original, 0, {
      name: 'filesystem',
      json: 'true'
    });
    expect(updatedDrafts).toEqual([
      {
        id: 'mcp:github',
        name: 'filesystem',
        json: 'true'
      }
    ]);
    expect(original).toEqual([
      {
        id: 'mcp:github',
        name: 'github',
        json:
          '{\n' +
          '  "command": "npx",\n' +
          '  "args": [\n' +
          '    "-y",\n' +
          '    "@modelcontextprotocol/server-github"\n' +
          '  ]\n' +
          '}'
      }
    ]);

    expect(removeMcpDraft(original, 0)).toEqual([]);
    expect(original).toHaveLength(1);
  });

  it('rejects blank, duplicate, or invalid MCP drafts when building a save payload', () => {
    expect(() =>
      buildMcpSavePayload([
        {
          name: ' ',
          json: '{}'
        }
      ])
    ).toThrow('MCP entry names must not be blank.');

    expect(() =>
      buildMcpSavePayload([
        {
          name: 'github',
          json: '{}'
        },
        {
          name: ' github ',
          json: '{"command":"npx"}'
        }
      ])
    ).toThrow('Duplicate MCP entry "github".');

    expect(() =>
      buildMcpSavePayload([
        {
          name: 'github',
          json: '{'
        }
      ])
    ).toThrow('MCP entry "github" contains invalid JSON.');
  });

  it('describes when editor navigation should allow, confirm, or block', () => {
    expect(
      getEditorNavigationDisposition({
        activeView: 'skills',
        nextView: 'run',
        isDirty: false,
        isSaving: false
      })
    ).toBe('allow');

    expect(
      getEditorNavigationDisposition({
        activeView: 'skills',
        nextView: 'run',
        isDirty: true,
        isSaving: false
      })
    ).toBe('confirm');

    expect(
      getEditorNavigationDisposition({
        activeView: 'mcp',
        nextView: 'overview',
        isDirty: true,
        isSaving: true
      })
    ).toBe('blocked');

    expect(
      getEditorNavigationDisposition({
        activeView: 'run',
        nextView: 'overview',
        isDirty: true,
        isSaving: true
      })
    ).toBe('allow');
  });
});
