import test from 'node:test'
import assert from 'node:assert/strict'
import { extractSignals } from './analyzer.js'

test('extracts evidence-backed urgency, task, decision, date, and name mention signals', () => {
  const message = {
    id: 'message-1',
    sender: 'Alex',
    source: 'Planning',
    text: 'Sannidhi, please send the approved plan by 12/31/2028 — urgent.',
    timestamp: '2025-04-12T12:00:00.000Z',
  }
  const report = extractSignals([message], 'Sannidhi')

  assert.equal(report.highlights.length, 1)
  assert.equal(report.highlights[0].priority, 'Urgent')
  assert.equal(report.highlights[0].score, 100)
  assert.deepEqual(report.highlights[0].messageId, message.id)
  assert.equal(report.tasks[0].messageId, message.id)
  assert.equal(report.decisions[0].messageId, message.id)
  assert.equal(report.mentions[0].messageId, message.id)
  assert.equal(report.deadlines[0].date, '12/31/2028')
})

test('does not treat tentative language as a decision and escapes username regex input', () => {
  const report = extractSignals([{
    id: 'message-2',
    sender: 'Alex',
    source: 'Chat',
    text: 'Maybe @sannidhi, can you review this tomorrow?',
    timestamp: null,
  }], 'sannidhi+team')

  assert.equal(report.decisions.length, 0)
  assert.equal(report.mentions.length, 1)
  assert.equal(report.tasks.length, 1)
})
