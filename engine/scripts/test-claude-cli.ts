#!/usr/bin/env npx tsx
import { callClaudeCli } from '../src/utils/claude-cli.js';

async function main() {
  console.log('Testing Claude CLI wrapper...\n');

  // Test 1: Simple response
  console.log('Test 1: Simple text response');
  const t1 = Date.now();
  const r1 = await callClaudeCli('Reply with exactly this text and nothing else: RADIOWAR_OK');
  console.log(`  Response: "${r1.slice(0, 50)}"`);
  console.log(`  Time: ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  console.log(`  Status: ${r1.includes('RADIOWAR_OK') ? 'PASS' : 'CHECK (response may vary)'}\n`);

  // Test 2: JSON response with system prompt
  console.log('Test 2: JSON response with system prompt');
  const t2 = Date.now();
  const r2 = await callClaudeCli(
    'Generate a JSON object with fields "title" and "content" about a test.',
    { systemPrompt: 'You are a JSON generator. Output ONLY valid JSON, no other text.' },
  );
  console.log(`  Response: "${r2.slice(0, 100)}..."`);
  console.log(`  Time: ${((Date.now() - t2) / 1000).toFixed(1)}s`);
  try {
    JSON.parse(r2.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim());
    console.log('  Status: PASS (valid JSON)\n');
  } catch {
    console.log('  Status: WARN (not valid JSON, but got response)\n');
  }

  console.log('All tests complete.');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
