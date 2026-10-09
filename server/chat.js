import { randomUUID } from 'node:crypto'

const maximumMessages = 25000

function cleanSender(value) {
  if (typeof value === 'string') return value.trim().slice(0, 120) || 'Unknown'
  if (value && typeof value === 'object') return String(value.name || value.real_name || value.username || value.id || 'Unknown').slice(0, 120)
  return 'Unknown'
}

function normalizeMessage(sender, text, timestamp, source = 'Imported chat') {
  if (typeof text !== 'string' || !text.trim()) return null
  const timestampText = timestamp === null || timestamp === undefined ? '' : String(timestamp)
  const parsedDate = typeof timestamp === 'number' ? new Date(timestamp) : timestampText ? new Date(timestampText) : null
  return {
    id: randomUUID(),
    sender: cleanSender(sender),
    text: text.trim().slice(0, 20000),
    timestamp: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null,
    source: String(source || 'Imported chat').trim().slice(0, 120) || 'Imported chat',
    unread: true,
  }
}

function parseTimestampedLine(line) {
  const bracket = line.match(/^\[(\d{1,4}[/-]\d{1,2}[/-]\d{1,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\]\s*(.*)$/)
  const dash = line.match(/^(\d{1,4}[/-]\d{1,2}[/-]\d{1,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?)\s+-\s+(.*)$/)
  const iso = line.match(/^(\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}(?::\d{2})?)\s+-\s+(.*)$/)
  const match = bracket || dash || iso
  if (!match) return null
  const colon = match[2].indexOf(':')
  const sender = colon > 0 && colon < 81 ? match[2].slice(0, colon) : 'WhatsApp'
  const text = colon > 0 && colon < 81 ? match[2].slice(colon + 1) : match[2]
  return normalizeMessage(sender, text || '[System message]', match[1])
}

function parseText(content, filename) {
  const sourceName = filename.replace(/\.txt$/i, '').replace(/^WhatsApp Chat with /i, '') || 'Imported chat'
  const messages = []
  const warnings = []
  const isWhatsappExport = /\[\d{1,4}[/-]\d{1,2}/.test(content) || /\d{1,4}[/-]\d{1,2}.* - /.test(content)
  let current
  const flush = () => {
    if (current) messages.push(current)
    current = null
  }
  for (const line of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim()) {
      if (current) current.text += '\n'
      continue
    }
    const timestamped = parseTimestampedLine(line)
    if (timestamped) {
      flush()
      timestamped.source = sourceName
      current = timestamped
    } else if (current && isWhatsappExport) {
      current.text += `\n${line}`
    } else {
      flush()
      const senderMatch = line.match(/^([^:\n]{1,60}):\s+(.+)$/)
      current = normalizeMessage(senderMatch?.[1], senderMatch?.[2] || line, '', sourceName)
      warnings.push('Some lines lacked a WhatsApp timestamp; their time is unknown.')
    }
    if (messages.length > maximumMessages) throw Object.assign(new Error(`Import limit is ${maximumMessages.toLocaleString()} messages.`), { status: 413 })
  }
  flush()
  return { messages, warnings: [...new Set(warnings)] }
}

function parseCsvRow(line) {
  const fields = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"' && quoted && line[i + 1] === '"') {
      field += '"'
      i += 1
    } else if (char === '"') quoted = !quoted
    else if (char === ',' && !quoted) {
      fields.push(field)
      field = ''
    } else field += char
  }
  if (quoted) throw Object.assign(new Error('CSV contains an unclosed quoted field.'), { status: 400 })
  fields.push(field)
  return fields
}

function parseCsv(content) {
  const rows = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim()).map(parseCsvRow)
  if (rows.length < 2) throw Object.assign(new Error('CSV needs a header and at least one message.'), { status: 400 })
  const headers = rows[0].map((header) => header.trim().toLowerCase())
  const index = (...names) => headers.findIndex((header) => names.includes(header))
  const textColumn = index('text', 'message', 'body')
  if (textColumn < 0) throw Object.assign(new Error('CSV needs a text, message, or body column.'), { status: 400 })
  const senderColumn = index('sender', 'author', 'from', 'user')
  const timeColumn = index('timestamp', 'time', 'date', 'ts')
  const sourceColumn = index('source', 'conversation', 'chat', 'channel')
  const messages = rows.slice(1, maximumMessages + 2).map((row) => normalizeMessage(
    row[senderColumn] || 'Unknown',
    row[textColumn],
    row[timeColumn] || '',
    row[sourceColumn] || 'Imported chat',
  )).filter(Boolean)
  return { messages, warnings: [] }
}

function parseJson(content, filename) {
  let value
  try {
    value = JSON.parse(content)
  } catch {
    throw Object.assign(new Error('This file is not valid JSON.'), { status: 400 })
  }
  const messages = []
  const warnings = []
  const walk = (node, source, depth = 0) => {
    if (depth > 64) throw Object.assign(new Error('JSON nesting is too deep to import safely.'), { status: 400 })
    if (messages.length >= maximumMessages) throw Object.assign(new Error(`Import limit is ${maximumMessages.toLocaleString()} messages.`), { status: 413 })
    if (Array.isArray(node)) {
      for (const item of node) walk(item, source, depth + 1)
      return
    }
    if (!node || typeof node !== 'object') return
    const text = node.text ?? node.message ?? node.body
    if (typeof text === 'string' && text.trim()) {
      const sender = node.sender ?? node.user_profile ?? node.user_name ?? node.username ?? node.user ?? node.author ?? node.from
      const timestamp = node.timestamp ?? node.ts ?? node.time ?? node.date ?? (typeof node.ts_ms === 'number' ? node.ts_ms : '')
      const channel = node.channel_name ?? node.channel ?? node.conversation ?? node.chat ?? node.group ?? source
      const message = normalizeMessage(sender, text, typeof timestamp === 'number' ? timestamp < 1e12 ? timestamp * 1000 : timestamp : timestamp, channel)
      if (!message.timestamp && timestamp) warnings.push('Some source timestamps could not be parsed and were kept as undated messages.')
      messages.push(message)
      return
    }
    const nodeSource = node.channel_name ?? node.channel ?? node.conversation ?? node.chat ?? node.group ?? source
    for (const [key, child] of Object.entries(node)) {
      if (['users', 'user_profiles', 'reactions', 'files', 'attachments'].includes(key)) continue
      const nestedSource = Array.isArray(child)
        && typeof child[0] === 'object'
        && !['messages', 'items', 'data', 'channels'].includes(key.toLowerCase())
        ? key
        : nodeSource
      walk(child, nestedSource, depth + 1)
    }
  }
  walk(value, filename.replace(/\.json$/i, ''))
  if (!messages.length) throw Object.assign(new Error('No message objects with text/message/body fields were found.'), { status: 400 })
  return { messages, warnings: [...new Set(warnings)] }
}

export async function parseImportBuffer(buffer, filename) {
  const content = buffer.toString('utf8')
  const extension = filename.split('.').at(-1)?.toLowerCase()
  if (extension === 'txt') return parseText(content, filename)
  if (extension === 'csv') return parseCsv(content)
  if (extension === 'json') return parseJson(content, filename)
  throw Object.assign(new Error('Choose a .txt, .csv, or .json export.'), { status: 400 })
}
