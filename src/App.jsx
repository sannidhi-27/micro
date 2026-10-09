import { useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { languageForCode, summaryLanguages } from '../shared/languages.js'
import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowRight,
  AtSign,
  Bell,
  CalendarClock,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  Clock3,
  FileUp,
  Inbox,
  KeyRound,
  ListChecks,
  LockKeyhole,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'

const localApiOrigin = (
  import.meta.env.VITE_LOCAL_API_URL
  || (import.meta.env.PROD ? 'http://127.0.0.1:3001' : '')
).replace(/\/$/, '')

async function api(path, options = {}) {
  const response = await fetch(`${localApiOrigin}/api${path}`, { credentials: 'include', ...options })
  if (response.status === 204) return null
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`)
  return result
}

const filters = ['All signals', 'Urgent', 'Tasks', 'Decisions', 'Deadlines', 'Mentions']

function initials(value) {
  return (value || 'S').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function formatTime(timestamp) {
  if (!timestamp) return 'Time unknown'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp))
}

function AuthPanel({ onAuthenticated }) {
  const [mode, setMode] = useState('signup')
  const [username, setUsername] = useState('Sannidhi')
  const [loginGreeting, setLoginGreeting] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await api(`/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password }),
      })
      if (mode === 'login') setLoginGreeting(result.user.username)
      onAuthenticated(result.user)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not sign in.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-orbit orbit-one" /><div className="auth-orbit orbit-two" />
      <section className="auth-card" aria-labelledby="auth-heading">
        <div className="brand-lockup"><span className="brand-glyph"><i /><i /><i /><i /></span><span>WHAT DID <b>I MISS?</b></span></div>
        <div className="privacy-ribbon"><ShieldCheck size={15} /> LOCAL ACCOUNT · STORED ON THIS DEVICE</div>
        <h1 id="auth-heading">{mode === 'signup' ? <>Your chats.<br /><em>Back in context.</em></> : <>Welcome back{loginGreeting ? `, ${loginGreeting}` : ''}.<br /><em>Your space awaits.</em></>}</h1>
        <p className="auth-intro">{mode === 'signup' ? 'Create your private space to see the signal in your conversations.' : 'Sign in to pick up where your conversations left off.'}</p>
        <form className="auth-form" onSubmit={submit}>
          {mode === 'signup' && <label>Your name<span className="auth-input"><UserRound size={16} /><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} minLength="2" maxLength="40" required /></span></label>}
          <label>Email address<span className="auth-input"><AtSign size={16} /><input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required /></span></label>
          <label>Password<span className="auth-input"><KeyRound size={16} /><input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} placeholder="At least 10 characters" minLength="10" maxLength="200" value={password} onChange={(event) => setPassword(event.target.value)} required /></span></label>
          {error && <div className="form-error" role="alert"><AlertCircle size={15} />{error}</div>}
          <button className="primary-button auth-submit" disabled={busy}>{busy ? 'Creating your private space…' : mode === 'signup' ? 'Create local account' : 'Sign in'} <ArrowRight size={16} /></button>
        </form>
        <div className="auth-switch">{mode === 'signup' ? <>Already have an account? <button onClick={() => { setMode('login'); setError('') }}>Sign in</button></> : <>New here? <button onClick={() => { setMode('signup'); setError('') }}>Create an account</button></>}</div>
        <div className="auth-note"><LockKeyhole size={14} /> Your password is protected with scrypt. Conversations stay in this device's local app-data folder.</div>
      </section>
      <div className="auth-footer"><span>NO CLOUD ACCOUNT. NO CHAT SYNC. YOUR DEVICE, YOUR DATA.</span><span>LOCAL-FIRST BY DESIGN <i /></span></div>
    </div>
  )
}

function PriorityPill({ priority }) {
  return <span className={`priority-pill priority-${(priority || 'calm').toLowerCase()}`}><i />{priority || 'Calm'}</span>
}

function App() {
  const [user, setUser] = useState(null)
  const [booting, setBooting] = useState(true)
  const [serviceError, setServiceError] = useState('')
  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [activeConversation, setActiveConversation] = useState(null)
  const [filter, setFilter] = useState('All signals')
  const [search, setSearch] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [preview, setPreview] = useState(null)
  const [importError, setImportError] = useState('')
  const [busyImport, setBusyImport] = useState(false)
  const [toast, setToast] = useState('')
  const [model, setModel] = useState(null)
  const [mobileMenu, setMobileMenu] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [sourceLanguage, setSourceLanguage] = useState('eng_Latn')
  const [summaryLanguage, setSummaryLanguage] = useState('eng_Latn')
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const fileInput = useRef(null)
  const socket = useRef(null)

  const report = activeConversation?.report
  const messages = activeConversation?.messages || []

  async function refreshConversations(selectLatest = false) {
    const data = await api('/conversations')
    setConversations(data.conversations)
    if (selectLatest || !activeId) {
      const nextId = data.conversations[0]?.id || null
      if (nextId) setActiveId(nextId)
      else {
        setActiveId(null)
        setActiveConversation(null)
      }
    } else if (!data.conversations.some((item) => item.id === activeId)) {
      const nextId = data.conversations[0]?.id || null
      setActiveId(nextId)
      if (!nextId) setActiveConversation(null)
    }
  }

  async function loadConversation(conversationId) {
    if (!conversationId) {
      setActiveConversation(null)
      return
    }
    const data = await api(`/conversations/${encodeURIComponent(conversationId)}`)
    setActiveConversation(data.conversation)
    if (data.conversation.sourceLanguage) setSourceLanguage(data.conversation.sourceLanguage)
    if (data.conversation.language) setSummaryLanguage(data.conversation.language)
    setConversations((items) => items.map((item) => item.id === conversationId ? {
      ...item,
      status: data.conversation.status,
      report: data.conversation.report,
      messageCount: data.conversation.messageCount,
    } : item))
    return data.conversation
  }

  useEffect(() => {
    let active = true
    api('/health').then(() => api('/auth/me')).then(async ({ user: currentUser }) => {
      if (!active) return
      setUser(currentUser)
      setBooting(false)
      try {
        await refreshConversations(true)
        const status = await api('/model/status')
        if (active) setModel(status)
      } catch (error) {
        if (active) setServiceError(error.message)
      }
    }).catch((error) => {
      if (!active) return
      if (/sign in/i.test(error.message)) setUser(null)
      else setServiceError(error.message)
      setBooting(false)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!user) return undefined
    const connection = io(localApiOrigin || undefined, { path: '/socket.io', withCredentials: true })
    socket.current = connection
    connection.on('model:progress', setModel)
    connection.on('conversation:ready', async ({ id }) => {
      try {
        await refreshConversations()
        const completed = activeId === id
          ? await loadConversation(id)
          : (await api(`/conversations/${encodeURIComponent(id)}`)).conversation
        const urgentCount = completed?.report?.highlights?.filter((item) => item.priority === 'Urgent').length || 0
        if (urgentCount > 0 && notificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
          new Notification('Priority alerts are ready', {
            body: `${urgentCount} urgent signal${urgentCount === 1 ? '' : 's'} found. Open the app to review them.`,
          })
        }
        const statusText = urgentCount
          ? `Summary ready. ${urgentCount} urgent visual alert${urgentCount === 1 ? '' : 's'} need review.`
          : 'Local summary ready.'
        setAnnouncement(statusText)
        setToast(statusText)
      } catch (error) {
        setServiceError(error.message)
      }
    })
    connection.on('conversation:error', ({ id }) => {
      if (activeId === id) loadConversation(id).catch((error) => setServiceError(error.message))
    })
    return () => {
      connection.disconnect()
      socket.current = null
    }
  }, [user, activeId, notificationsEnabled])

  useEffect(() => {
    if (!activeId || !user) return undefined
    let cancelled = false
    let timer
    const fetchConversation = async () => {
      try {
        const data = await api(`/conversations/${encodeURIComponent(activeId)}`)
        if (cancelled) return
        setActiveConversation(data.conversation)
        setConversations((items) => items.map((item) => item.id === activeId ? { ...item, status: data.conversation.status, report: data.conversation.report } : item))
        if (data.conversation.status === 'analyzing') timer = window.setTimeout(fetchConversation, 1800)
      } catch (error) {
        if (!cancelled) setServiceError(error.message)
      }
    }
    fetchConversation()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activeId, user])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => () => window.speechSynthesis?.cancel(), [activeId])

  const visibleHighlights = useMemo(() => {
    const items = report?.highlights || []
    return items.filter((item) => {
      const matchesQuery = `${item.sender} ${item.source} ${item.text}`.toLowerCase().includes(search.toLowerCase())
      const matchesFilter = filter === 'All signals'
        || (filter === 'Urgent' && item.priority === 'Urgent')
        || (filter === 'Tasks' && report?.tasks?.some((task) => task.messageId === item.messageId))
        || (filter === 'Decisions' && report?.decisions?.some((decision) => decision.messageId === item.messageId))
        || (filter === 'Deadlines' && report?.deadlines?.some((deadline) => deadline.messageId === item.messageId))
        || (filter === 'Mentions' && report?.mentions?.some((mention) => mention.messageId === item.messageId))
      return matchesQuery && matchesFilter
    })
  }, [filter, report, search])

  async function handleFile(file) {
    if (!file) return
    setImportError('')
    if (file.size > 5 * 1024 * 1024) {
      setImportError('File is larger than 5 MB. Export without media or split the chat into smaller files.')
      return
    }
    if (!/\.(txt|csv|json)$/i.test(file.name)) {
      setImportError('Choose a .txt, .csv, or .json export.')
      return
    }
    try {
      const text = await file.text()
      let sample = text.split(/\r?\n/).filter(Boolean).slice(0, 3).join('\n')
      if (file.name.toLowerCase().endsWith('.json')) {
        try {
          const parsed = JSON.parse(text)
          sample = JSON.stringify(parsed, null, 2).slice(0, 350)
        } catch {
          sample = text.slice(0, 350)
        }
      }
      setPreview({ file, sample, size: file.size })
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Could not read this file.')
    }
  }

  async function importConversation() {
    if (!preview) return
    setBusyImport(true)
    setImportError('')
    try {
      const formData = new FormData()
      formData.append('file', preview.file)
      formData.append('sourceLanguage', sourceLanguage)
      formData.append('summaryLanguage', summaryLanguage)
      const result = await api('/import', { method: 'POST', body: formData })
      setActiveId(result.conversation.id)
      setActiveConversation(result.conversation)
      setShowImport(false)
      setPreview(null)
      await refreshConversations()
      setActiveId(result.conversation.id)
      setToast(`Imported ${result.conversation.messageCount.toLocaleString()} messages. Local analysis started.`)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Could not import this conversation.')
    } finally {
      setBusyImport(false)
    }
  }

  async function updateTask(taskId, status) {
    if (!activeId) return
    try {
      await api(`/conversations/${encodeURIComponent(activeId)}/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      await loadConversation(activeId)
    } catch (error) {
      setServiceError(error.message)
    }
  }

  async function deleteConversation(conversationId) {
    if (!window.confirm('Delete this imported conversation and its local analysis? This cannot be undone.')) return
    try {
      await api(`/conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' })
      setConversations((items) => items.filter((item) => item.id !== conversationId))
      if (activeId === conversationId) {
        const next = conversations.find((item) => item.id !== conversationId)
        setActiveId(next?.id || null)
        setActiveConversation(null)
      }
      setToast('Conversation data was deleted from this device.')
    } catch (error) {
      setServiceError(error.message)
    }
  }

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' })
      setUser(null)
      setConversations([])
      setActiveConversation(null)
      setActiveId(null)
      setToast('Signed out.')
    } catch (error) {
      setServiceError(error.message)
    }
  }

  async function handleAuthenticated(nextUser) {
    setUser(nextUser)
    setServiceError('')
    setSourceLanguage('eng_Latn')
    setSummaryLanguage('eng_Latn')
    setNotificationsEnabled(false)
    try {
      await refreshConversations(true)
      setModel(await api('/model/status'))
    } catch (error) {
      setServiceError(error.message)
    }
  }

  async function exportConversation(conversationId) {
    try {
      const response = await fetch(`${localApiOrigin}/api/conversations/${encodeURIComponent(conversationId)}/export`, { credentials: 'include' })
      if (!response.ok) throw new Error('Could not export this conversation.')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${activeConversation?.title || 'conversation'}.json`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setServiceError(error.message)
    }
  }

  async function enableVisualAlerts() {
    try {
      if (!('Notification' in window)) {
        setServiceError('This browser does not support desktop notifications. In-app visual alerts will still work.')
        return
      }
      const permission = Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission
      if (permission !== 'granted') {
        setServiceError('Desktop notifications were not enabled. In-app visual alerts remain on.')
        return
      }
      setNotificationsEnabled(true)
      setToast('Desktop alerts enabled. Notifications show counts only, never chat text.')
    } catch (error) {
      setServiceError(error instanceof Error ? error.message : 'Could not enable desktop notifications.')
    }
  }

  function toggleSpeech() {
    if (!report?.summary) return
    if (speaking) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
      return
    }
    if (!('speechSynthesis' in window)) {
      setServiceError('Speech playback is not available in this browser.')
      return
    }
    const utterance = new SpeechSynthesisUtterance(report.summary)
    utterance.lang = languageForCode(report.language || summaryLanguage).locale
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => {
      setSpeaking(false)
      setServiceError('Speech playback could not be completed.')
    }
    setSpeaking(true)
    window.speechSynthesis.speak(utterance)
  }

  if (booting) return <div className="boot-screen"><div className="brand-lockup"><span className="brand-glyph"><i /><i /><i /><i /></span><span>WHAT DID <b>I MISS?</b></span></div><div className="boot-loader" /><span>Opening your local workspace…</span></div>
  if (serviceError && !user) return <main className="service-error-screen"><AlertCircle size={28} /><h1>Local companion is unavailable.</h1><p>{serviceError}</p><button className="primary-button" onClick={() => window.location.reload()}>Try again <ArrowRight size={15} /></button><small>{window.location.protocol === 'https:' ? 'Vercel hosts the interface only. Start the local companion on this device, allow local-network access, then reload.' : <>Start the local API with <code>npm.cmd run dev:api</code>.</>}</small></main>
  if (!user) return <><AuthPanel onAuthenticated={handleAuthenticated} />{serviceError && <div className="floating-error" role="alert">{serviceError}</div>}</>

  const urgentCount = report?.highlights?.filter((item) => item.priority === 'Urgent').length || 0
  const openTasks = report?.tasks?.filter((task) => task.status === 'open').length || 0
  const activeTitle = activeConversation?.title || 'Choose a conversation'
  const modelDownloading = model?.state === 'downloading' || model?.state === 'loading' || activeConversation?.status === 'analyzing'

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
        <a className="brand-lockup" href="#home"><span className="brand-glyph"><i /><i /><i /><i /></span><span>WHAT DID <b>I MISS?</b><small>PRIVATE CONVERSATION INTELLIGENCE</small></span></a>
        <div className="workspace-card"><span className="workspace-avatar">{initials(user.username)}</span><span><b>{user.username}</b><small>Local workspace</small></span><ChevronDown size={15} /></div>
        <div className="sidebar-label">YOUR WORKSPACE</div>
        <button className="side-nav active"><Inbox size={17} /><span>Catch-up</span><span className="side-count">{conversations.length}</span></button>
        <div className="sidebar-label conversation-label">CONVERSATIONS</div>
        <div className="conversation-nav">
          {conversations.map((conversation) => <button className={`conversation-nav-item ${conversation.id === activeId ? 'selected' : ''}`} key={conversation.id} onClick={() => { setActiveId(conversation.id); setMobileMenu(false) }}>
            <MessageCircle size={15} /><span><b>{conversation.title}</b><small>{conversation.messageCount.toLocaleString()} messages</small></span>{conversation.status === 'analyzing' && <span className="small-loader" />}
          </button>)}
          {!conversations.length && <p className="sidebar-empty">No chats yet. Import an export to begin.</p>}
        </div>
        <button className="side-nav import-nav" onClick={() => { setShowImport(true); setMobileMenu(false) }}><Plus size={16} /><span>Import a conversation</span></button>
        <div className="sidebar-bottom">
          <div className="local-status"><span className={`status-dot ${model?.state === 'ready' ? 'ready' : ''}`} /><span><b>{model?.state === 'ready' ? 'Local model ready' : 'Private by design'}</b><small>{model?.state === 'ready' ? 'Inference on this device' : 'Loopback-only processing'}</small></span><ShieldCheck size={16} /></div>
          <button className="side-nav signout-nav" onClick={logout}><LogOut size={16} /><span>Sign out</span></button>
          <div className="user-row"><span className="user-avatar">{initials(user.username)}</span><span><b>{user.username}</b><small>{user.email}</small></span><MoreHorizontal size={17} /></div>
        </div>
      </aside>

      <main className="main-area" id="home">
        <header className="topbar">
          <button className="mobile-nav-toggle" aria-label="Open sidebar" onClick={() => setMobileMenu(!mobileMenu)}><span /><span /><span /></button>
          <div className="breadcrumbs"><span>YOUR SPACE</span><b>/</b><strong>{activeTitle}</strong></div>
          <div className="topbar-right"><div className="topbar-private"><i /> ON-DEVICE ANALYSIS</div><button className="topbar-button alert-toggle" aria-label={notificationsEnabled ? 'Desktop alerts enabled' : 'Enable desktop alerts'} aria-pressed={notificationsEnabled} onClick={enableVisualAlerts}><Bell size={14} /><span>{notificationsEnabled ? 'Alerts on' : 'Enable alerts'}</span></button><button className="topbar-button import-topbar-button" onClick={() => setShowImport(true)}><Upload size={15} /><span>Import chat</span></button><button className="topbar-avatar" aria-label={`Signed in as ${user.username}`}>{initials(user.username)}</button></div>
        </header>

        <div className="page-content">
          {serviceError && <div className="inline-error" role="alert"><AlertCircle size={15} />{serviceError}<button onClick={() => setServiceError('')} aria-label="Dismiss error"><X size={14} /></button></div>}
          <section className="welcome-row">
            <div><div className="eyebrow"><span /> YOUR PRIVATE BRIEF · {new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase()}</div><h1>What did you <em>miss?</em></h1><p>Welcome back, {user.username}. Let’s turn the unread into the understood.</p></div>
            <button className="primary-button" onClick={() => setShowImport(true)}><Sparkles size={16} /> Catch me up <kbd>↵</kbd></button>
          </section>

          <section className="metrics-grid" aria-label="Conversation overview">
            <div className="metric-card"><span className="metric-icon icon-purple"><MessageCircle size={17} /></span><span><small>MESSAGES ANALYZED</small><b>{activeConversation?.messageCount || 0}<em> in this chat</em></b></span><span className="metric-spark">✳</span></div>
            <div className="metric-card"><span className="metric-icon icon-red"><Activity size={17} /></span><span><small>NEEDS YOUR ATTENTION</small><b>{urgentCount}<em> urgent signals</em></b></span><span className="metric-arrow"><ArrowDown size={16} /></span></div>
            <div className="metric-card"><span className="metric-icon icon-yellow"><ListChecks size={17} /></span><span><small>ACTION ITEMS</small><b>{openTasks}<em> still open</em></b></span><span className="metric-arrow"><ArrowRight size={16} /></span></div>
            <div className="metric-card"><span className="metric-icon icon-green"><CalendarClock size={17} /></span><span><small>DECISIONS + DATES</small><b>{(report?.decisions?.length || 0) + (report?.deadlines?.length || 0)}<em> worth a look</em></b></span><span className="metric-arrow"><ArrowRight size={16} /></span></div>
          </section>

          {!activeConversation ? <section className="empty-catchup"><div className="empty-graphic"><div className="empty-orbit" /><div className="empty-star">✳</div><MessageCircle size={27} /></div><span className="section-kicker">A LITTLE CLARITY GOES A LONG WAY</span><h2>Your next catch-up starts here.</h2><p>Import a WhatsApp TXT, Slack/other JSON export, or a CSV transcript. The raw chat stays in this local app folder.</p><button className="primary-button" onClick={() => setShowImport(true)}><FileUp size={16} /> Import your first chat</button><div className="empty-formats"><span>.TXT</span><span>.JSON</span><span>.CSV</span><i /> 5 MB · 25,000 messages max</div></section> :
            <div className="analysis-layout">
              <section className="brief-column">
                <div className="brief-card">
                  <div className="brief-card-top"><span className="section-kicker"><Sparkles size={14} /> YOUR CATCH-UP</span><div className="brief-actions"><button className="more-button" disabled={!report?.summary} aria-label={speaking ? 'Stop voice summary' : 'Listen to voice summary'} onClick={toggleSpeech}>{speaking ? <VolumeX size={15} /> : <Volume2 size={15} />}{speaking ? 'Stop listening' : 'Listen'}</button><button className="more-button" aria-label="Export report" onClick={() => exportConversation(activeId)}><ArrowRight size={15} /> Export report</button></div></div>
                  <h2>{activeTitle}</h2>
                  <p className="brief-meta">{activeConversation.messageCount.toLocaleString()} messages · imported {formatTime(activeConversation.createdAt)}</p>
                  {activeConversation.warnings?.length > 0 && <div className="warning-box"><AlertCircle size={15} /><span>{activeConversation.warnings.join(' ')}</span></div>}
                  {modelDownloading ? <div className="model-progress"><div className="progress-heading"><span className="small-loader" />{model?.message || 'Preparing the local summary model…'}</div><div className="progress-track"><i style={{ width: `${Math.max(3, model?.progress || 4)}%` }} /></div><small>First use downloads model files once. Messages are not sent to the model host.</small></div> :
                    report?.summary ? <div className="summary-copy" dir="auto" lang={languageForCode(report.language || summaryLanguage).locale}>{report.summary}</div> :
                      report?.modelError ? <div className="warning-box"><AlertCircle size={15} /><span>The local transformer could not create a summary. The detected signals below remain available. {report.modelError}</span></div> :
                        <div className="summary-copy muted-summary">Import a conversation to create an evidence-backed catch-up.</div>}
                  <div className="brief-foot"><span><LockKeyhole size={13} /> {report?.languageName ? `Summary in ${report.languageName}` : 'Local summary'} · generated on this device</span><button onClick={() => exportConversation(activeId)}>Export data</button></div>
                </div>

                <div className="highlights-card">
                  <div className="panel-heading"><div><span className="section-kicker">THE SIGNAL, SORTED</span><h2>Highlights <span>{report?.highlights?.length || 0}</span></h2></div><label className="message-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this chat" /></label></div>
                  <div className="filter-row" role="tablist" aria-label="Filter conversation highlights">{filters.map((item) => <button key={item} role="tab" aria-selected={filter === item} className={filter === item ? 'filter-chip selected' : 'filter-chip'} onClick={() => setFilter(item)}>{item}</button>)}</div>
                  {visibleHighlights.length ? <div className="highlight-timeline">{visibleHighlights.map((item, index) => <article className={`highlight-row priority-${item.priority.toLowerCase()}`} key={item.messageId}>
                    <div className="timeline-rail"><i />{index < visibleHighlights.length - 1 && <span />}</div><div className="highlight-content">
                      <div className="highlight-meta"><span className="source-label">{item.source}</span><span>·</span><span>{item.sender}</span><span className="meta-spacer" /><time>{formatTime(item.timestamp)}</time><PriorityPill priority={item.priority} /></div>
                      <p dir="auto">{item.text}</p><div className="evidence-row"><span><ShieldCheck size={13} /> Original message</span><span>{item.score}/100 signal score</span></div>
                      <details className="reason-details"><summary>Why this surfaced <ChevronDown size={13} /></summary><div>{item.reasons.map((reason) => <span key={reason}><Check size={12} />{reason}</span>)}</div></details>
                    </div>
                  </article>)}</div> : <div className="no-signals"><Search size={20} /><b>No matching signals</b><span>Try another filter or search term.</span></div>}
                  {messages.length > 0 && <details className="original-messages"><summary>Browse original messages <ChevronDown size={14} /></summary><div>{messages.slice(0, 40).map((message) => <article key={message.id}><div><b>{message.sender}</b><time>{formatTime(message.timestamp)}</time></div><p>{message.text}</p></article>)}</div></details>}
                </div>
              </section>

              <aside className="insight-column">
                <section className="insight-card urgency-card">
                  <div className="insight-heading"><span className="insight-icon urgent-icon"><Activity size={16} /></span><div><h3>Priority radar</h3><p>Explicit signals, never guesses.</p></div><button onClick={() => setFilter('Urgent')} aria-label="Show urgent signals"><ArrowRight size={15} /></button></div>
                  <div className="urgency-number">{String(urgentCount).padStart(2, '0')}<span>urgent</span></div><div className="priority-bars">
                    <div><span className="bar-dot red" />Urgent<i><b style={{ width: `${Math.min(100, urgentCount * 18)}%` }} /></i><strong>{urgentCount}</strong></div>
                    <div><span className="bar-dot amber" />Important<i><b style={{ width: `${Math.min(100, (report?.highlights?.filter((item) => item.priority === 'Important').length || 0) * 12)}%` }} /></i><strong>{report?.highlights?.filter((item) => item.priority === 'Important').length || 0}</strong></div>
                    <div><span className="bar-dot green" />On your radar<i><b style={{ width: `${Math.min(100, (report?.highlights?.filter((item) => item.priority === 'Calm').length || 0) * 8)}%` }} /></i><strong>{report?.highlights?.filter((item) => item.priority === 'Calm').length || 0}</strong></div>
                  </div>
                  <details className="scoring-explain"><summary>How scoring works <ChevronDown size={13} /></summary><p>Urgency +45 · explicit date +25 · mention +20 · confirmed decision +20 · action request +15. High-priority labels need a score of 30 or more.</p></details>
                </section>

                <section className="insight-card tasks-card">
                  <div className="insight-heading"><span className="insight-icon task-icon"><ListChecks size={16} /></span><div><h3>Action items</h3><p>{openTasks} open · evidence-linked</p></div><span className="task-count">{openTasks}</span></div>
                  {report?.tasks?.filter((task) => task.status !== 'dismissed').length ? report.tasks.filter((task) => task.status !== 'dismissed').slice(0, 8).map((task) => (
                    <article className={`task-row ${task.status}`} key={task.id}>
                      <button className={`task-check ${task.status === 'done' ? 'checked' : ''}`} onClick={() => updateTask(task.id, task.status === 'done' ? 'open' : 'done')} aria-label={task.status === 'done' ? 'Mark task open' : 'Mark task done'}>{task.status === 'done' && <Check size={12} />}</button>
                      <div><b dir="auto">{task.title}</b><small>{task.sender}{task.deadline ? ` · ${task.deadline}` : ''}</small></div>
                      <button className="dismiss-task" onClick={() => updateTask(task.id, 'dismissed')} aria-label="Dismiss task"><X size={13} /></button>
                    </article>
                  )) : <p className="insight-empty">No explicit action requests were detected.</p>}
                </section>

                <section className="insight-card decisions-card">
                  <div className="insight-heading"><span className="insight-icon decision-icon"><CheckCheck size={16} /></span><div><h3>Decisions</h3><p>Confirmed in the conversation.</p></div></div>
                  {report?.decisions?.length ? report.decisions.slice(0, 5).map((decision) => <article className="decision-row" key={decision.id}><Check size={14} /><div><b>{decision.title}</b><small>{decision.sender} · {decision.source}</small></div></article>) : <p className="insight-empty">No confirmed decisions in this conversation.</p>}
                </section>

                <section className="insight-card deadline-card">
                  <div className="insight-heading"><span className="insight-icon deadline-icon"><CalendarClock size={16} /></span><div><h3>Dates mentioned</h3><p>Check the original message for context.</p></div></div>
                  {report?.deadlines?.length ? report.deadlines.slice(0, 5).map((deadline) => <article className="date-row" key={deadline.id}><Clock3 size={14} /><div><b>{deadline.date}</b><small>{deadline.sender} · {deadline.source}</small></div></article>) : <p className="insight-empty">No explicit dates were found.</p>}
                </section>

                <div className="privacy-card"><ShieldCheck size={17} /><span><b>Your messages stay here.</b><small>Analysis runs on this device, not a cloud API.</small></span></div>
                <section className="insight-card accessibility-card">
                  <div className="insight-heading"><span className="insight-icon task-icon"><Activity size={16} /></span><div><h3>Accessible alerts</h3><p>Visual and text-first by default.</p></div></div>
                  <p className="accessibility-copy">Urgency appears in the dashboard and screen-reader announcements. Desktop notifications are optional and show counts only—never message text.</p>
                  <a className="isl-resource" href="https://islrtc.nic.in/video/indian-sign-language-dictionary-launched-on-website/" target="_blank" rel="noreferrer">Open the official ISL resource <ArrowRight size={13} /></a>
                  <small className="isl-disclosure">This release does not bundle or generate ISL clips. Visual alerts and text remain available; the official resource opens separately.</small>
                </section>
              </aside>
            </div>}
          <footer className="page-footer"><span>WHAT DID I MISS? · A private catch-up for {user.username}.</span><span><ShieldCheck size={13} /> Stored locally on this device.</span></footer>
        </div>
      </main>

      {mobileMenu && <button className="sidebar-scrim" aria-label="Close sidebar" onClick={() => setMobileMenu(false)} />}

      {showImport && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyImport) { setShowImport(false); setPreview(null); setImportError('') } }}><section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <button className="modal-close" aria-label="Close import dialog" disabled={busyImport} onClick={() => { setShowImport(false); setPreview(null); setImportError('') }}><X size={18} /></button>
        <div className="modal-icon"><FileUp size={19} /></div><span className="section-kicker">PRIVATE IMPORT · {preview ? '02 / 02' : '01 / 02'}</span><h2 id="import-title">{preview ? 'A quick look before it lands.' : 'Drop in the conversation.'}</h2><p>Choose an export from your device. Files are sent only to this app’s local backend and stored in this device’s local app-data folder.</p>
        {!preview ? <button className="dropzone" onClick={() => fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); handleFile(event.dataTransfer.files?.[0]) }}><span className="upload-orbit"><Upload size={20} /></span><b>Drop a chat export here</b><small>or <u>browse files</u> · .txt, .csv, .json · max 5 MB</small><input ref={fileInput} type="file" accept=".txt,.csv,.json,text/plain,text/csv,application/json" onChange={(event) => { handleFile(event.target.files?.[0]); event.target.value = '' }} hidden /></button> :
          <div className="file-review"><div className="file-review-title"><span><FileUp size={16} /></span><div><b>{preview.file.name}</b><small>{(preview.size / 1024).toFixed(1)} KB · preview only</small></div><button onClick={() => setPreview(null)} aria-label="Choose another file"><X size={15} /></button></div><pre>{preview.sample}</pre></div>}
        <div className="language-pair">
          <label>Conversation language<select value={sourceLanguage} onChange={(event) => setSourceLanguage(event.target.value)}>{summaryLanguages.map((language) => <option key={language.code} value={language.code} disabled={language.modelSupported === false}>{language.name} · {language.nativeName}{language.modelSupported === false ? ' — unavailable locally' : ''}</option>)}</select><small>Choose the main language used in this chat.</small></label>
          <label>Summary language<select value={summaryLanguage} onChange={(event) => setSummaryLanguage(event.target.value)}>{summaryLanguages.map((language) => <option key={language.code} value={language.code} disabled={language.modelSupported === false}>{language.name} · {language.nativeName}{language.modelSupported === false ? ' — unavailable locally' : ''}</option>)}</select><small>Translation and summarization run locally.</small></label>
        </div>
        <p className="language-coverage-note">The local model supports English and 19 scheduled Indian languages. Bodo, Dogri, and Konkani are listed but unavailable in this model; they are not silently sent to cloud services.</p>
        {importError && <div className="form-error" role="alert"><AlertCircle size={15} />{importError}</div>}
        <div className="model-disclosure"><LockKeyhole size={15} /><span><b>Local AI model notice.</b> English summaries use a local summarizer. Regional-language translation downloads a larger NLLB model on first use; translation, summary, and chat content stay on this device after download.</span></div>
        <div className="modal-bottom"><span><ShieldCheck size={14} /> No conversation upload to a cloud API</span>{preview && <div><button className="secondary-button" onClick={() => setPreview(null)}>Choose another</button><button className="primary-button" disabled={busyImport} onClick={importConversation}>{busyImport ? 'Importing locally…' : 'Analyze on this device'} <ArrowRight size={15} /></button></div>}</div>
      </section></div>}

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
      {toast && <div className="toast" role="status"><Check size={15} />{toast}<button onClick={() => setToast('')} aria-label="Dismiss notification"><X size={14} /></button></div>}
      {model?.state === 'error' && <div className="model-warning"><CircleHelp size={14} />Local model unavailable; detected message signals remain accessible.</div>}
    </div>
  )
}

export default App
