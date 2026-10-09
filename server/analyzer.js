import { env } from '@huggingface/transformers'
import { resolve } from 'node:path'
import { languageForCode } from '../shared/languages.js'

const modelId = 'Xenova/distilbart-cnn-6-6'
const translationModelId = 'Xenova/nllb-200-distilled-600M'
let summarizerPromise
let translatorPromise
let inferenceQueue = Promise.resolve()
let modelStatus = { state: 'not_loaded', stage: 'summary', progress: 0, message: 'Local models download the first time a summary is requested.' }

const urgencyPattern = /\b(urgent|asap|blocked|critical|immediately|today|tomorrow|due|deadline|by eod)\b/i
const decisionPattern = /\b(decided|approved|agreed|confirmed|finalized|we'll go with|moving forward with)\b/i
const taskPattern = /\b(please|can you|could you|need you to|remember to|submit|send|prepare|finish|complete|review|share|upload|schedule|book|pay|bring)\b/i
const datePattern = /\b(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:,?\s+\d{4})?|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/i

export function extractSignals(messages, username) {
  const usernamePattern = username ? new RegExp(`(^|[^\\w])${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w]|$)`, 'i') : null
  const highlights = []
  const tasks = []
  const decisions = []
  const mentions = []
  const deadlines = []

  for (const message of messages) {
    const text = message.text
    const urgency = urgencyPattern.test(text)
    const decision = decisionPattern.test(text) && !/\bmaybe|suggest|perhaps|could we\b/i.test(text)
    const task = taskPattern.test(text)
    const date = text.match(datePattern)?.[0] ?? null
    const mention = /@[\w.-]+/.test(text) || (usernamePattern && usernamePattern.test(text))
    const reasons = []
    if (urgency) reasons.push('Urgency or time-sensitive language')
    if (date) reasons.push(`Explicit date: ${date}`)
    if (mention) reasons.push('Name or handle mention')
    if (decision) reasons.push('Decision language')
    if (task) reasons.push('Action-oriented request')
    const score = Math.min(100, (urgency ? 45 : 0) + (date ? 25 : 0) + (mention ? 20 : 0) + (decision ? 20 : 0) + (task ? 15 : 0))
    const priority = score >= 65 ? 'Urgent' : score >= 30 ? 'Important' : 'Calm'
    const evidence = { messageId: message.id, sender: message.sender, source: message.source, text, timestamp: message.timestamp }
    if (score >= 20 || decision || task || mention) highlights.push({ ...evidence, score, priority, reasons })
    if (task) tasks.push({ id: `task-${message.id}`, ...evidence, title: text, status: 'open', deadline: date })
    if (decision) decisions.push({ id: `decision-${message.id}`, ...evidence, title: text })
    if (mention) mentions.push({ id: `mention-${message.id}`, ...evidence, title: text })
    if (date) deadlines.push({ id: `deadline-${message.id}`, ...evidence, title: text, date })
  }
  highlights.sort((a, b) => b.score - a.score || (b.timestamp || '').localeCompare(a.timestamp || ''))
  return { highlights, tasks, decisions, mentions, deadlines }
}

export function setModelCachePath(path) {
  env.cacheDir = resolve(path)
  env.allowRemoteModels = true
  env.allowLocalModels = true
}

export function getModelStatus() {
  return { ...modelStatus, model: modelId }
}

export function resetModelForTests() {
  summarizerPromise = undefined
  translatorPromise = undefined
  inferenceQueue = Promise.resolve()
  modelStatus = { state: 'not_loaded', stage: 'summary', progress: 0, message: 'Local models download the first time a summary is requested.' }
}

function reportModelProgress(io, userId, state) {
  modelStatus = state
  io?.to(`user:${userId}`).emit('model:progress', modelStatus)
}

function loadPipeline(kind, model, pipelineTask, io, userId) {
  const stage = kind === 'translation' ? 'translation' : 'summary'
  reportModelProgress(io, userId, {
    state: 'downloading',
    stage,
    progress: 0,
    model,
    message: `Downloading the local ${stage} model. Conversation text is not uploaded.`,
  })
  return import('@huggingface/transformers').then(({ pipeline }) => pipeline(pipelineTask, model, {
    dtype: 'q8',
    device: 'cpu',
    progress_callback: (progress) => {
      if (progress.status === 'progress' && Number.isFinite(progress.progress)) {
        reportModelProgress(io, userId, {
          state: 'downloading',
          stage,
          progress: Math.max(0, Math.min(100, Math.round(progress.progress))),
          model,
          message: `Downloading local ${stage} model files (${Math.round(progress.progress)}%).`,
        })
      } else if (progress.status === 'done') {
        reportModelProgress(io, userId, {
          state: 'loading',
          stage,
          progress: 100,
          model,
          message: 'Model files downloaded; preparing local inference.',
        })
      }
    },
  })).then((pipeline) => {
    reportModelProgress(io, userId, {
      state: 'ready',
      stage,
      progress: 100,
      model,
      message: `Local ${stage} model is ready.`,
    })
    return pipeline
  }).catch((error) => {
    reportModelProgress(io, userId, {
      state: 'error',
      stage,
      progress: 0,
      model,
      message: `Local ${stage} model could not be loaded.`,
    })
    throw error
  })
}

async function getSummarizer(io, userId) {
  if (!summarizerPromise) {
    summarizerPromise = loadPipeline('summary', modelId, 'summarization', io, userId)
      .catch((error) => {
        summarizerPromise = undefined
        throw error
      })
  }
  return summarizerPromise
}

async function getTranslator(io, userId) {
  if (!translatorPromise) {
    translatorPromise = loadPipeline('translation', translationModelId, 'translation', io, userId)
      .catch((error) => {
        translatorPromise = undefined
        throw error
      })
  }
  return translatorPromise
}

function splitText(text, wordLimit) {
  const words = text.split(/\s+/).filter(Boolean)
  const chunks = []
  for (let index = 0; index < words.length; index += wordLimit) {
    chunks.push(words.slice(index, index + wordLimit).join(' '))
  }
  return chunks.length ? chunks : ['']
}

async function translateMessages(messages, sourceLanguage, targetLanguage, io, userId) {
  if (sourceLanguage === targetLanguage) return messages
  const translator = await getTranslator(io, userId)
  const fragments = messages.map((message) => splitText(message.text, 140))
  const flatFragments = fragments.flat()
  const translated = []
  for (let index = 0; index < flatFragments.length; index += 8) {
    const outputs = await translator(flatFragments.slice(index, index + 8), {
      src_lang: sourceLanguage,
      tgt_lang: targetLanguage,
      max_new_tokens: 256,
      do_sample: false,
    })
    for (const output of outputs) {
      const text = output?.translation_text?.trim()
      if (!text) throw new Error('The local translation model returned no translated text.')
      translated.push(text)
    }
  }
  let cursor = 0
  return messages.map((message, messageIndex) => {
    const text = translated.slice(cursor, cursor + fragments[messageIndex].length).join(' ')
    cursor += fragments[messageIndex].length
    return { ...message, text }
  })
}

function restoreSourceEvidence(signals, sourceMessages) {
  const byId = new Map(sourceMessages.map((message) => [message.id, message]))
  const restore = (items) => items.map((item) => {
    const source = byId.get(item.messageId)
    return source ? { ...item, sender: source.sender, source: source.source, text: source.text, title: source.text, timestamp: source.timestamp } : item
  })
  return {
    highlights: restore(signals.highlights),
    tasks: restore(signals.tasks),
    decisions: restore(signals.decisions),
    mentions: restore(signals.mentions),
    deadlines: restore(signals.deadlines),
  }
}

export async function analyzeConversation(messages, username, io, userId, sourceLanguage = 'eng_Latn', summaryLanguage = sourceLanguage) {
  const selectedLanguage = languageForCode(summaryLanguage)
  const baseReport = {
    model: modelId,
    translationModel: sourceLanguage === 'eng_Latn' && summaryLanguage === 'eng_Latn' ? null : translationModelId,
    sourceLanguage,
    language: summaryLanguage,
    languageName: selectedLanguage.name,
    mode: 'local-transformer',
  }
  if (!messages.length) {
    return { summary: 'No messages were available to summarize.', ...baseReport, ...extractSignals(messages, username) }
  }

  try {
    const run = async () => {
      const englishMessages = await translateMessages(messages, sourceLanguage, 'eng_Latn', io, userId)
      const signals = restoreSourceEvidence(extractSignals(englishMessages, username), messages)
      const content = englishMessages.map(({ sender, text }) => `${sender}: ${text}`).join('\n')
      const summarizer = await getSummarizer(io, userId)
      const chunks = splitText(content, 750)
      const summaries = []
      for (const piece of chunks) {
        const output = await summarizer(piece, { max_new_tokens: 120, min_new_tokens: 20, do_sample: false })
        const summary = output?.[0]?.summary_text?.trim()
        if (summary) summaries.push(summary)
      }
      if (!summaries.length) throw new Error('The local summarization model returned no summary text.')
      const englishSummary = summaries.join(' ')
      const targetSummary = summaryLanguage === 'eng_Latn'
        ? englishSummary
        : (await translateMessages([{ id: 'summary', sender: '', text: englishSummary }], 'eng_Latn', summaryLanguage, io, userId))[0].text
      return { summary: targetSummary, ...baseReport, ...signals }
    }
    const pending = inferenceQueue.then(run)
    inferenceQueue = pending.then(() => {}, () => {})
    return await pending
  } catch (error) {
    return {
      summary: null,
      ...baseReport,
      modelError: error instanceof Error ? error.message : 'Local multilingual analysis failed.',
      ...extractSignals(messages, username),
    }
  }
}
