import path from 'path'
import fs from 'fs'
import express from 'express'
import multer from 'multer'
import { initDb, nextDocId, createArticle, getArticleByDocId, listArticles } from './db'
import { checkOnchainUnlock } from './chain'
import { arcTestnetRpcUrls } from './rpc-url'

const app = express()
app.use(express.json())

// ── CORS ─────────────────────────────────────────────────────────────────────
// Wallets (Rabby/MetaMask) may fetch our endpoints from their content scripts,
// which are subject to CORS. Allow any origin.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// ── POST /rpc ─────────────────────────────────────────────────────────────────
// Browser-to-Arc-RPC proxy. Credentials stay server-side so the browser never
// sees them; Vite devserver forwards /rpc → here, keeping CORS a non-issue.
app.post('/rpc', async (req, res) => {
  // Try each upstream in order: the provisioned proxy first (when a token is
  // configured), then public endpoints. A single dead upstream must not take
  // the whole app down.
  let lastErr: unknown
  for (const rpcUrl of arcTestnetRpcUrls()) {
    try {
      const upstream = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      })
      const data = await upstream.json() as unknown
      res.status(upstream.status).json(data)
      return
    } catch (err) {
      lastErr = err
      console.warn('[rpc-proxy] upstream failed:', rpcUrl, err)
    }
  }
  console.error('[rpc-proxy] all upstreams failed', lastErr)
  res.status(502).json({ error: 'RPC proxy error', detail: String(lastErr) })
})

// ── File upload storage ──────────────────────────────────────────────────────
const UPLOAD_DIR = path.join(process.cwd(), 'server', 'uploads')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
    cb(null, `${Date.now()}-${safe}`)
  },
})

const ALLOWED_MIME = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Only PDF, TXT, MD, DOC, and DOCX files are accepted.'))
    }
  },
})

// ── GET /next-doc-id ──────────────────────────────────────────────────────────
// Reserve the next sequential doc_id without writing an article yet.
// The client uses this to call registerDoc on-chain, then POSTs /articles
// with the confirmed doc_id immediately after.
app.get('/next-doc-id', async (_req, res) => {
  try {
    const doc_id = await nextDocId()
    res.json({ doc_id })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── POST /articles ────────────────────────────────────────────────────────────
// Accepts multipart/form-data with an optional `file` field.
// `doc_id` must be supplied by the client (reserved via GET /next-doc-id).
// `body` is optional when a file is uploaded.
app.post('/articles', upload.single('file'), async (req, res) => {
  try {
    const { title, author_name, author_wallet, abstract, body, doc_id: rawDocId } = req.body as {
      title: string
      author_name: string
      author_wallet: string
      abstract: string
      body?: string
      doc_id?: string
    }
    const hasFile = Boolean(req.file)
    const bodyText = (body ?? '').trim()

    if (!title || !author_name || !author_wallet || !abstract) {
      res.status(400).json({ error: 'Missing required fields: title, author_name, author_wallet, abstract' })
      return
    }
    if (!hasFile && !bodyText) {
      res.status(400).json({ error: 'Either body text or an uploaded file is required' })
      return
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(author_wallet)) {
      res.status(400).json({ error: 'author_wallet must be a valid 0x Ethereum address' })
      return
    }

    // Use caller-supplied doc_id if provided (post-onchain flow), else mint a new one
    const doc_id = rawDocId ? Number(rawDocId) : await nextDocId()
    if (!Number.isInteger(doc_id) || doc_id < 1) {
      res.status(400).json({ error: 'Invalid doc_id' })
      return
    }

    const article = await createArticle({
      doc_id,
      title,
      author_name,
      author_wallet,
      abstract,
      body: bodyText,
      file_path: req.file ? req.file.filename : null,
      file_name: req.file ? req.file.originalname : null,
      file_mime: req.file ? req.file.mimetype : null,
    })

    // Don't expose the raw server file path in the API response
    const { file_path: _fp, ...safeArticle } = article
    res.status(201).json(safeArticle)
  } catch (err) {
    console.error(err)
    const msg = err instanceof Error ? err.message : 'Internal server error'
    res.status(500).json({ error: msg })
  }
})

// ── GET /articles ─────────────────────────────────────────────────────────────
app.get('/articles', async (_req, res) => {
  try {
    const rows = await listArticles()
    res.json(rows.map(({ body: _b, file_path: _fp, ...rest }) => rest))
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /articles/:docId ──────────────────────────────────────────────────────
app.get('/articles/:docId', async (req, res) => {
  try {
    const docId = Number(req.params.docId)
    if (!Number.isInteger(docId) || docId < 1) {
      res.status(400).json({ error: 'Invalid docId' })
      return
    }
    const article = await getArticleByDocId(docId)
    if (!article) {
      res.status(404).json({ error: 'Article not found' })
      return
    }
    // Never expose raw file_path; expose only whether a file exists
    const { file_path: _fp, ...safeArticle } = article
    res.json({ ...safeArticle, has_file: Boolean(article.file_path), file_name: article.file_name ?? null })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /files/:docId?reader=0x... ────────────────────────────────────────────
// Gated download: serves the uploaded file only if the reader's wallet
// has unlocked the document on-chain. The file path is NEVER sent to the
// browser — the browser only ever calls this endpoint.
app.get('/files/:docId', async (req, res) => {
  try {
    const docId = Number(req.params.docId)
    if (!Number.isInteger(docId) || docId < 1) {
      res.status(400).json({ error: 'Invalid docId' })
      return
    }

    const reader = String(req.query.reader ?? '')
    if (!/^0x[0-9a-fA-F]{40}$/i.test(reader)) {
      res.status(400).json({ error: 'Missing or invalid reader address' })
      return
    }

    // Verify on-chain unlock
    const unlocked = await checkOnchainUnlock(docId, reader)
    if (!unlocked) {
      res.status(403).json({ error: 'Document not unlocked for this wallet' })
      return
    }

    const article = await getArticleByDocId(docId)
    if (!article || !article.file_path) {
      res.status(404).json({ error: 'No file attached to this document' })
      return
    }

    const filePath = path.join(UPLOAD_DIR, article.file_path)
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File not found on server' })
      return
    }

    res.setHeader('Content-Disposition', `attachment; filename="${article.file_name ?? 'document'}"`)
    res.setHeader('Content-Type', article.file_mime ?? 'application/octet-stream')
    res.sendFile(filePath)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── Error handler ─────────────────────────────────────────────────────────────
// Must be registered LAST. Without it a thrown error (e.g. a multer upload
// rejection) falls through to Express's default HTML error page, which the
// browser cannot parse as JSON — the frontend then reports the useless
// "Unknown error" instead of the real reason.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const msg = err instanceof Error ? err.message : 'Internal server error'
  console.error('[api-error]', msg)
  if (res.headersSent) return
  res.status(500).json({ error: msg })
})

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = 3001

async function start() {
  await initDb()
  app.listen(PORT, () => console.log(`API ready on :${PORT}`))
}

start().catch(console.error)
