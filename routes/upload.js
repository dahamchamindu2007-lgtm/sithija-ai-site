const express = require('express');
const path = require('path');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const AdmZip = require('adm-zip');
const { createExtractorFromData } = require('node-unrar-js');
const { createWorker } = require('tesseract.js');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Mimetypes alone aren't reliable — some mobile browsers/OSes send generic
// types (application/octet-stream, application/vnd.ms-excel for .csv, etc)
// for less common formats. So we detect the "kind" of file from BOTH the
// declared mimetype and the filename extension, and accept if either one
// clearly identifies a supported format.
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function detectKind(mimetype, filename) {
  const ext = path.extname(filename || '').toLowerCase();

  if (
    mimetype === 'application/zip' ||
    mimetype === 'application/x-zip-compressed' ||
    mimetype === 'application/octet-stream' && ext === '.zip' ||
    ext === '.zip'
  ) return 'zip';
  if (
    mimetype === 'application/vnd.rar' ||
    mimetype === 'application/x-rar-compressed' ||
    mimetype === 'application/octet-stream' && ext === '.rar' ||
    ext === '.rar'
  ) return 'rar';
  if (mimetype === 'application/pdf' || ext === '.pdf') return 'pdf';
  if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === '.docx') return 'docx';
  if (
    mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimetype === 'application/vnd.ms-excel' ||
    ext === '.xlsx' || ext === '.xls'
  ) return 'xlsx';
  if (mimetype === 'text/csv' || ext === '.csv') return 'csv';
  if ((mimetype && mimetype.startsWith('image/')) || IMAGE_EXTS.has(ext)) return 'image';
  if (mimetype === 'text/plain' || ext === '.txt') return 'txt';
  // Anything else still gets accepted — handled by the 'other' branch below,
  // which sniffs the bytes and either reads it as plain text or reports it
  // as a binary file we can't extract text from. This is what lets literally
  // any file type be uploaded instead of being rejected up front.
  return 'other';
}

const upload = multer({
  storage: multer.memoryStorage(), // never touches disk — Railway's filesystem is ephemeral anyway
  // Vercel's serverless functions hard-cap the incoming request body at
  // 4.5MB — this is a platform limit, not something we can raise from code.
  // A limit above that just means large uploads get rejected by the
  // platform itself (as a non-JSON error page) before Multer ever sees
  // them, which the frontend can only report as a generic "Upload failed".
  // Staying under it means OUR error message is what the user sees instead.
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB
  // No fileFilter — every file type is accepted now. detectKind() always
  // returns something ('other' as the catch-all), so nothing gets rejected
  // here; unsupported/binary content is handled gracefully inside the
  // 'other' case of the switch below instead of failing the upload outright.
});

// Cap how much extracted text gets sent to the AI per upload — keeps the
// upstream prompt (and the per-message DB note) from ballooning on huge docs.
const MAX_CHARS = 12000;

// Reads an .xlsx/.xls workbook and flattens every sheet to CSV-style text,
// with a header line naming each sheet so multi-sheet files stay readable.
function extractSpreadsheetText(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const parts = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet).trim();
    if (csv) parts.push(`--- Sheet: ${sheetName} ---\n${csv}`);
  }
  return parts.join('\n\n');
}

// Text-like extensions whose contents are worth pulling into the summary
// when found inside a zip. Anything else (images, binaries, pdf/docx nested
// inside the zip, etc) is only listed by name/size — parsing nested
// documents recursively would blow up the response size fast.
const ZIP_TEXT_EXTS = new Set(['.txt', '.md', '.json', '.csv', '.js', '.ts', '.py', '.html', '.css', '.yml', '.yaml', '.xml', '.log']);
const ZIP_MAX_ENTRIES_LISTED = 200;
const ZIP_MAX_FILES_PREVIEWED = 5;
const ZIP_PREVIEW_CHARS_PER_FILE = 2000;

// Reads a .zip archive: lists its contents (name + size) and, for a handful
// of small text-like files inside, pulls a short preview of their content.
// Doesn't attempt to recursively parse nested PDFs/DOCX/XLSX — that's out
// of scope for an upload preview and could balloon response size fast.
function extractZipText(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().filter(e => !e.isDirectory);

  if (entries.length === 0) return '(empty archive — no files inside)';

  const listed = entries.slice(0, ZIP_MAX_ENTRIES_LISTED);
  const manifestLines = listed.map(e => `${e.entryName}  (${(e.header.size / 1024).toFixed(1)} KB)`);
  let manifest = `Archive contains ${entries.length} file(s):\n` + manifestLines.join('\n');
  if (entries.length > listed.length) {
    manifest += `\n… and ${entries.length - listed.length} more file(s) not listed`;
  }

  // Preview a few small text-like files so the AI has something to work
  // with beyond just filenames (e.g. a README, config, or code file).
  const previewCandidates = entries
    .filter(e => ZIP_TEXT_EXTS.has(path.extname(e.entryName).toLowerCase()) && e.header.size > 0 && e.header.size < 200 * 1024)
    .slice(0, ZIP_MAX_FILES_PREVIEWED);

  const previews = [];
  for (const entry of previewCandidates) {
    try {
      let content = entry.getData().toString('utf-8');
      const truncated = content.length > ZIP_PREVIEW_CHARS_PER_FILE;
      if (truncated) content = content.slice(0, ZIP_PREVIEW_CHARS_PER_FILE);
      previews.push(`--- ${entry.entryName}${truncated ? ' (truncated)' : ''} ---\n${content}`);
    } catch {
      // Skip files that fail to decode as text (shouldn't normally happen
      // given the extension filter above, but archives can be adversarial).
    }
  }

  return previews.length
    ? `${manifest}\n\n${previews.join('\n\n')}`
    : manifest;
}

// Reads a .rar archive: lists its contents (name + size) and previews a
// handful of small text-like files inside, same approach as extractZipText.
// node-unrar-js is a WASM port of unrar, so this needs no native binary —
// important since Railway/Vercel builds shouldn't depend on system packages.
async function extractRarText(buffer) {
  const extractor = await createExtractorFromData({ data: new Uint8Array(buffer).buffer });

  const listResult = extractor.getFileList();
  const allHeaders = [...listResult.fileHeaders].filter(h => !h.flags.directory);

  if (allHeaders.length === 0) return '(empty archive — no files inside)';

  const listed = allHeaders.slice(0, ZIP_MAX_ENTRIES_LISTED);
  const manifestLines = listed.map(h => `${h.name}  (${(h.unpSize / 1024).toFixed(1)} KB)`);
  let manifest = `Archive contains ${allHeaders.length} file(s):\n` + manifestLines.join('\n');
  if (allHeaders.length > listed.length) {
    manifest += `\n… and ${allHeaders.length - listed.length} more file(s) not listed`;
  }

  const previewCandidates = allHeaders
    .filter(h => ZIP_TEXT_EXTS.has(path.extname(h.name).toLowerCase()) && h.unpSize > 0 && h.unpSize < 200 * 1024)
    .slice(0, ZIP_MAX_FILES_PREVIEWED)
    .map(h => h.name);

  const previews = [];
  if (previewCandidates.length) {
    // extract() needs a fresh extractor call with the target file list;
    // it returns file bodies alongside headers.
    const extracted = extractor.extract({ files: previewCandidates });
    for (const file of extracted.files) {
      try {
        if (!file.extraction) continue;
        let content = Buffer.from(file.extraction).toString('utf-8');
        const truncated = content.length > ZIP_PREVIEW_CHARS_PER_FILE;
        if (truncated) content = content.slice(0, ZIP_PREVIEW_CHARS_PER_FILE);
        previews.push(`--- ${file.fileHeader.name}${truncated ? ' (truncated)' : ''} ---\n${content}`);
      } catch {
        // Skip files that fail to decode as text.
      }
    }
  }

  return previews.length
    ? `${manifest}\n\n${previews.join('\n\n')}`
    : manifest;
}

// Fallback for any file type we don't specifically parse. Sniffs the first
// chunk of bytes: if it looks like plain text (no null bytes, mostly
// printable), read it as text like a .txt file. Otherwise report it as a
// binary file with just its metadata — we can't usefully extract "text"
// from e.g. an .exe or .mp3, but we still accept the upload instead of
// rejecting it outright.
function looksLikeText(buffer) {
  const sample = buffer.subarray(0, 8000);
  if (sample.includes(0)) return false; // null byte -> almost certainly binary
  let printable = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127) || byte >= 128) printable++;
  }
  return sample.length === 0 || printable / sample.length > 0.85;
}

function extractOtherFileText(buffer, originalname, mimetype) {
  if (looksLikeText(buffer)) {
    return buffer.toString('utf-8');
  }
  const sizeKb = (buffer.length / 1024).toFixed(1);
  return `(binary file — no extractable text)\nFilename: ${originalname}\nType: ${mimetype || 'unknown'}\nSize: ${sizeKb} KB`;
}

// OCRs a photo/screenshot of text using Tesseract. Slower than the other
// extractors (a few seconds), so this is only invoked for image uploads.
async function extractImageText(buffer) {
  const worker = await createWorker('eng', 1, {
    // Tesseract downloads its worker script + language data at runtime and
    // caches them on disk. Vercel's serverless filesystem is read-only
    // EXCEPT for /tmp — without pointing the cache there, the write fails,
    // the request just hangs, and the platform eventually hard-kills the
    // function with a non-JSON error the frontend can't parse (which is
    // why it showed as a generic "Upload failed" instead of a real reason).
    cachePath: '/tmp',
    // Keep tesseract's own logs out of the server log — noisy per-line
    // progress output that isn't useful here.
    logger: () => {}
  });
  try {
    const { data } = await worker.recognize(buffer);
    return data.text || '';
  } finally {
    await worker.terminate();
  }
}

// Fails a slow operation with a clear error instead of letting it hang
// until the platform's own function timeout kills the whole request —
// that kind of kill returns a non-JSON error page, which the frontend can
// only show as a generic "Upload failed, try again" with no real reason.
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// POST /api/upload/document  (multipart/form-data, field name "file")
// Returns extracted plain text — the frontend attaches this to the NEXT
// chat message it sends rather than this endpoint saving anything itself.
router.post('/document', requireAuth, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      // Multer's own errors (file too large, rejected type) land here —
      // surface a clear reason instead of a generic failure.
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'File is too large (4MB max)'
        : (err.message || 'Upload failed');
      return res.status(400).json({ success: false, error: msg });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const { mimetype, originalname, buffer } = req.file;
    const kind = detectKind(mimetype, originalname);

    try {
      let text = '';

      switch (kind) {
        case 'zip':
          text = extractZipText(buffer);
          break;
        case 'rar':
          text = await extractRarText(buffer);
          break;
        case 'pdf': {
          const data = await pdfParse(buffer);
          text = data.text;
          break;
        }
        case 'docx': {
          const result = await mammoth.extractRawText({ buffer });
          text = result.value;
          break;
        }
        case 'xlsx':
          text = extractSpreadsheetText(buffer);
          break;
        case 'csv':
          text = buffer.toString('utf-8');
          break;
        case 'image':
          // Vercel's Hobby plan hard-caps a function at ~10s regardless of
          // vercel.json's maxDuration (that setting only takes effect on
          // Pro). 8s leaves a couple seconds of buffer for the rest of the
          // request (cold start, response serialization) before the
          // platform would kill it anyway.
          text = await withTimeout(extractImageText(buffer), 8000, 'Image OCR timed out');
          break;
        case 'txt':
          text = buffer.toString('utf-8');
          break;
        case 'other':
        default:
          text = extractOtherFileText(buffer, originalname, mimetype);
          break;
      }

      text = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

      if (!text) {
        const emptyMsg = kind === 'image'
          ? "Couldn't find any readable text in that image — try a clearer photo or screenshot."
          : kind === 'xlsx'
            ? "That spreadsheet looks empty — no data found in any sheet."
            : kind === 'zip'
              ? "That zip archive looks empty."
              : kind === 'rar'
                ? "That rar archive looks empty."
                : "Couldn't find any text in that file — it may be empty or a scanned/image-only document.";
        return res.status(422).json({ success: false, error: emptyMsg });
      }

      const truncated = text.length > MAX_CHARS;
      if (truncated) text = text.slice(0, MAX_CHARS);

      res.json({ success: true, filename: originalname, text, truncated, charCount: text.length, kind });
    } catch (e) {
      console.error(`Document parse error (${kind || 'unknown'}):`, e.message);
      const friendly = kind === 'image'
        ? "Couldn't read that image. Try a different photo/screenshot, or a clearer scan."
        : kind === 'xlsx'
          ? "Couldn't read that spreadsheet. Make sure it's a valid, non-corrupted XLSX/XLS file."
          : kind === 'zip'
            ? "Couldn't read that zip file. Make sure it's a valid, non-corrupted archive."
            : kind === 'rar'
              ? "Couldn't read that rar file. Make sure it's a valid, non-corrupted archive."
              : "Couldn't read that file.";
      res.status(422).json({ success: false, error: friendly });
    }
  });
});

module.exports = router;
