import test from 'node:test';
import assert from 'node:assert/strict';

import { INITIAL_AGENTS, INITIAL_SPACES, INITIAL_MCP_TOOLS, DEFAULT_LLM_SETTINGS } from '../lib/store.ts';

test('Nook Initial Agents Integrity', () => {
  assert.equal(INITIAL_AGENTS.length, 4, 'Should initialize with 4 specialist agents');
  const agentNames = INITIAL_AGENTS.map((a) => a.name);
  assert.ok(agentNames.includes('Scout'), 'Should include Scout');
  assert.ok(agentNames.includes('Quill'), 'Should include Quill');
  assert.ok(agentNames.includes('Cipher'), 'Should include Cipher');
  assert.ok(agentNames.includes('Aura'), 'Should include Aura');

  for (const agent of INITIAL_AGENTS) {
    assert.ok(agent.id, `Agent ${agent.name} must have an ID`);
    assert.ok(agent.role, `Agent ${agent.name} must have a role`);
    assert.ok(agent.systemPrompt, `Agent ${agent.name} must have a system prompt`);
    assert.ok(Array.isArray(agent.allowedTools), `Agent ${agent.name} must have tools array`);
    assert.equal(agent.computerEnabled, true, `Agent ${agent.name} must have computer enabled`);
  }
});

test('Nook Initial Spaces Integrity', () => {
  assert.ok(INITIAL_SPACES.length >= 3, 'Should have at least 3 initial Spaces');
  const spaceNames = INITIAL_SPACES.map((s) => s.name);
  assert.ok(spaceNames.some((n) => n.includes('Product & Launch')), 'Should include Product space');
  assert.ok(spaceNames.some((n) => n.includes('Research')), 'Should include Research space');
  assert.ok(spaceNames.some((n) => n.includes('Engineering')), 'Should include Engineering space');

  for (const space of INITIAL_SPACES) {
    assert.ok(space.id, `Space ${space.name} must have an ID`);
    assert.ok(space.pages.length > 0, `Space ${space.name} should contain initial seed pages`);
    for (const page of space.pages) {
      assert.ok(page.title, 'Page must have a title');
      assert.ok(page.content, 'Page must have content');
      assert.ok(page.version >= 1, 'Page version must be >= 1');
    }
  }
});

test('Nook MCP Tools & Safeguards', () => {
  assert.ok(INITIAL_MCP_TOOLS.length >= 5, 'Should have at least 5 standard MCP tools');
  
  // Mutating system actions must require human approval
  const execTool = INITIAL_MCP_TOOLS.find((t) => t.name === 'execute_command');
  assert.ok(execTool, 'Terminal execute tool should exist');
  assert.equal(execTool.requiresApproval, true, 'Terminal execution must require human review approval');

  const saveTool = INITIAL_MCP_TOOLS.find((t) => t.name === 'save_to_space');
  assert.ok(saveTool, 'Save to Space tool should exist');
  assert.equal(saveTool.requiresApproval, true, 'Saving to space must require human review approval');

  // Read-only search should be autonomous
  const searchTool = INITIAL_MCP_TOOLS.find((t) => t.name === 'web_search');
  assert.ok(searchTool, 'Web search tool should exist');
  assert.equal(searchTool.requiresApproval, false, 'Web search should run autonomously');
});

test('Nook Settings Fallback Safety', () => {
  assert.equal(DEFAULT_LLM_SETTINGS.provider, 'simulation', 'Default provider should be zero-key simulation');
  assert.ok(DEFAULT_LLM_SETTINGS.model, 'Default model must be defined');
});
