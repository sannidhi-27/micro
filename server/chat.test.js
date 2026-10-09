import test from 'node:test'
import assert from 'node:assert/strict'
import { parseImportBuffer } from './chat.js'

const parse = (content, filename) => parseImportBuffer(Buffer.from(content), filename)

test('parses WhatsApp timestamped lines and multiline message bodies', async () => {
  const result = await parse(
    '[12/31/2025, 9:41 PM] Alex: Please send the slides by 12/31/2025.\ncontinued on next line\n[12/31/2025, 9:45 PM] Sannidhi: I will.',
    'WhatsApp Chat with Team.txt',
  )

  assert.equal(result.messages.length, 2)
  assert.equal(result.messages[0].sender, 'Alex')
  assert.match(result.messages[0].text, /continued on next line/)
  assert.equal(result.messages[0].source, 'Team')
  assert.equal(result.messages[1].sender, 'Sannidhi')
})

test('parses CSV columns, escaped quotes, and optional sender/date', async () => {
  const result = await parse('sender,text,timestamp,channel\nAlex,"Use ""local only"" mode",2025-04-12T12:00:00Z,Planning', 'chat.csv')
  assert.equal(result.messages.length, 1)
  assert.equal(result.messages[0].sender, 'Alex')
  assert.equal(result.messages[0].text, 'Use "local only" mode')
  assert.equal(result.messages[0].source, 'Planning')
  assert.equal(result.messages[0].timestamp, '2025-04-12T12:00:00.000Z')
})

test('parses nested Slack-like JSON and millisecond timestamps', async () => {
  const result = await parse(JSON.stringify({
    channels: [{ channel: 'launch', messages: [{ user_profile: { real_name: 'Alex' }, text: 'We decided to ship.', ts_ms: 1744459200000 }] }],
  }), 'export.json')
  assert.equal(result.messages.length, 1)
  assert.equal(result.messages[0].sender, 'Alex')
  assert.equal(result.messages[0].source, 'launch')
  assert.equal(result.messages[0].timestamp, new Date(1744459200000).toISOString())
})

test('rejects unsupported formats, invalid JSON, and deeply nested JSON', async () => {
  await assert.rejects(parse('content', 'chat.zip'), /Choose a \.txt, \.csv, or \.json/)
  await assert.rejects(parse('{invalid', 'chat.json'), /not valid JSON/)
  let nested = { text: 'hello' }
  for (let index = 0; index < 66; index += 1) nested = { child: nested }
  await assert.rejects(parse(JSON.stringify(nested), 'chat.json'), /nesting is too deep/)
})
