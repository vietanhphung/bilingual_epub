import { useRef, useState, type DragEvent } from 'react'
import { api, ApiError } from '../api'
import type { UploadResult } from '../types'

interface Props {
  onUploaded: (result: UploadResult) => void
}

export function UploadDropzone({ onUploaded }: Props) {
  const [tab, setTab] = useState<'file' | 'drive'>('file')
  const [dragging, setDragging] = useState(false)
  const [driveUrl, setDriveUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.epub')) {
      setError('That doesn’t look like an .epub file.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const result = await api.uploadFile(file)
      onUploaded(result)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void handleFile(file)
  }

  async function submitDriveLink() {
    if (!driveUrl.trim()) return
    setError(null)
    setBusy(true)
    try {
      const result = await api.uploadFromDriveLink(driveUrl.trim())
      onUploaded(result)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="tabs">
        <button type="button" className={tab === 'file' ? 'tab active' : 'tab'} onClick={() => setTab('file')}>
          Upload a file
        </button>
        <button type="button" className={tab === 'drive' ? 'tab active' : 'tab'} onClick={() => setTab('drive')}>
          Google Drive link
        </button>
      </div>

      {tab === 'file' ? (
        <div
          className={dragging ? 'dropzone dragging' : 'dropzone'}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {busy ? (
            <p>Reading your book…</p>
          ) : (
            <>
              <p>Drag and drop an .epub file here</p>
              <p className="muted">or</p>
              <button type="button" className="secondary" onClick={() => inputRef.current?.click()}>
                Browse from your computer
              </button>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".epub,application/epub+zip"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFile(file)
              e.target.value = ''
            }}
          />
        </div>
      ) : (
        <div className="drive-form">
          <label>
            Paste a Google Drive share link
            <input
              type="url"
              placeholder="https://drive.google.com/file/d/.../view?usp=sharing"
              value={driveUrl}
              onChange={(e) => setDriveUrl(e.target.value)}
            />
          </label>
          <p className="muted">Sharing must be set to "Anyone with the link".</p>
          <button type="button" className="secondary" onClick={submitDriveLink} disabled={busy}>
            {busy ? 'Importing…' : 'Import from Drive'}
          </button>
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  )
}
