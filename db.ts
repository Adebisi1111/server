import fs from 'fs'
import path from 'path'

const DB_PATH = path.join(process.cwd(), 'scrolls-db.json')

type Article = {
  id: number
  doc_id: number
  title: string
  author_name: string
  author_wallet: string
  abstract: string
  body: string
  file_path: string | null
  file_name: string | null
  file_mime: string | null
  created_at: string
}

let articles: Article[] = []
let docIdCounter = 1

function loadDb() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'))
      articles = data.articles || []
      docIdCounter = data.docIdCounter || 1
    }
  } catch { /* ignore */ }
}

function saveDb() {
  fs.writeFileSync(DB_PATH, JSON.stringify({ articles, docIdCounter }, null, 2))
}

loadDb()

export async function initDb() {
  console.log('[db] Using file-based storage:', DB_PATH)
}

export type { Article }

export async function nextDocId(): Promise<number> {
  const id = docIdCounter++
  saveDb()
  return id
}

/**
 * Insert or update an article keyed by doc_id.
 *
 * Upserting is required: a client can retry a publish after the on-chain
 * registerDoc succeeded but the first DB write was lost. A plain INSERT
 * would then collide on the doc_id unique constraint and fail the whole
 * save — which is exactly the "save failed" path this replaces.
 */
export async function createArticle(data: {
  doc_id: number
  title: string
  author_name: string
  author_wallet: string
  abstract: string
  body: string
  file_path?: string | null
  file_name?: string | null
  file_mime?: string | null
}): Promise<Article> {
  const existing = articles.find(a => a.doc_id === data.doc_id)
  if (existing) {
    existing.title = data.title
    existing.author_name = data.author_name
    existing.author_wallet = data.author_wallet
    existing.abstract = data.abstract
    existing.body = data.body
    existing.file_path = data.file_path ?? existing.file_path
    existing.file_name = data.file_name ?? existing.file_name
    existing.file_mime = data.file_mime ?? existing.file_mime
    saveDb()
    return existing
  }

  const article: Article = {
    id: articles.length + 1,
    doc_id: data.doc_id,
    title: data.title,
    author_name: data.author_name,
    author_wallet: data.author_wallet,
    abstract: data.abstract,
    body: data.body,
    file_path: data.file_path ?? null,
    file_name: data.file_name ?? null,
    file_mime: data.file_mime ?? null,
    created_at: new Date().toISOString(),
  }
  articles.push(article)
  saveDb()
  return article
}

export async function getArticleByDocId(docId: number): Promise<Article | null> {
  return articles.find(a => a.doc_id === docId) || null
}

export async function listArticles(): Promise<Article[]> {
  return [...articles]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 100)
}

export { } // no pool needed
