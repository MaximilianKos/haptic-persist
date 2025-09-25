const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { corsMiddleware } = require('./config/cors');

const app = express();
const PORT = process.env.PORT || 3000;
const VOLUME_PATH = process.env.VOLUME_PATH || './Haptic';
const ROOT_NAME = process.env.ROOT_NAME || 'Haptic';

// Middleware
app.use(corsMiddleware); // Enable CORS for all routes
app.use(express.json({ limit: '10mb' }));

// Create data directory if it doesn't exist
const ensureDataDirectory = async () => {
  try {
    await fs.mkdir(VOLUME_PATH, { recursive: true });
  } catch (error) {
    console.error('Error creating data directory:', error);
  }
};

ensureDataDirectory();

const toApiPath = (relativePath = '') => {
  const normalized = relativePath.split(path.sep).filter(Boolean).join('/');

  return normalized ? `/${ROOT_NAME}/${normalized}` : `/${ROOT_NAME}`;
};

const resolveFsPathFromApiPath = (rawPath) => {
  const prepared = prepareOperationPath(rawPath);
  if (!prepared) return null;

  const normalized = prepared.normalizedPath.replace(/\\/g, '/');

  // If the caller uses API-style paths: "/<ROOT_NAME>/sub/dir/file.md"
  const apiPrefix = `/${ROOT_NAME}`;
  let relativeInsideVolume;

  if (normalized === apiPrefix) {
    relativeInsideVolume = ''; // root of the volume
  } else if (normalized.startsWith(`${apiPrefix}/`)) {
    // strip "/<ROOT_NAME>/" but KEEP all parent dirs after it
    relativeInsideVolume = normalized.slice(apiPrefix.length + 1);
  } else if (path.isAbsolute(normalized)) {
    // Absolute path not using API prefix: try to keep it only if it's already under the volume
    const resolved = path.resolve(normalized);
    const volResolved = path.resolve(VOLUME_PATH);
    if (resolved.startsWith(volResolved + path.sep) || resolved === volResolved) {
      return { prepared, fsPath: resolved };
    }
    // Otherwise, force it under the volume as-is (drop the leading slash)
    relativeInsideVolume = normalized.replace(/^\//, '');
  } else {
    // Relative path: put it under the volume
    relativeInsideVolume = normalized;
  }

  const fsPath = path.resolve(VOLUME_PATH, relativeInsideVolume);
  // Prevent escaping the volume
  const volResolved = path.resolve(VOLUME_PATH);
  if (!(fsPath.startsWith(volResolved + path.sep) || fsPath === volResolved)) {
    throw new Error('Resolved path escapes the volume');
  }

  return { prepared, fsPath };
};

const prepareOperationPath = (rawPath = '') => {
  if (typeof rawPath !== 'string') {
    return null;
  }

  const trimmed = rawPath.trim();

  if (!trimmed) {
    return null;
  }

  const normalizedSlashes = trimmed.replace(/\\/g, '/').replace(/\/+/g, '/');
  const cleaned =
    normalizedSlashes !== '/' && normalizedSlashes.endsWith('/')
      ? normalizedSlashes.slice(0, -1)
      : normalizedSlashes;

  if (!cleaned) {
    return null;
  }

  if (cleaned === '/') {
    const fsPath = path.normalize(path.sep);
    return {
      targetPath: fsPath,
      normalizedPath: fsPath,
      original: trimmed
    };
  }

  const segments = cleaned.split('/').filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return null;
  }

  const startsWithRoot = cleaned.startsWith('/');
  const hasWindowsDrive = /^[a-zA-Z]:/.test(segments[0]);

  let fsPath;

  if (startsWithRoot && !hasWindowsDrive) {
    fsPath = path.join(path.sep, ...segments);
  } else {
    fsPath = path.join(...segments);
  }

  const targetPath = path.normalize(fsPath);

  return {
    targetPath,
    normalizedPath: targetPath,
    original: trimmed
  };
};

const buildFileTree = async (currentDir, relativeDir = '') => {
  try {
    const dirEntries = await fs.readdir(currentDir, { withFileTypes: true });
    const sortedEntries = dirEntries.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );

    const items = [];

    for (const entry of sortedEntries) {
      if (entry.name.startsWith('.')) {
        continue;
      }

      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      const apiPath = toApiPath(relativePath);

      if (entry.isDirectory()) {
        const children = await buildFileTree(absolutePath, relativePath);
        items.push({
          path: apiPath,
          name: entry.name,
          children
        });
      } else {
        items.push({
          path: apiPath,
          name: entry.name
        });
      }
    }

    return items;
  } catch (error) {
    console.error('Error building file tree:', error);
    throw error;
  }
};

// POST route to handle markdown content
app.post('/markdown', async (req, res) => {
  try {
    if (!req.is('application/json')) {
      return res.status(400).json({ error: 'Invalid content type. Expected application/json' });
    }

    const { path: filePath, markdown } = req.body;

    if (!markdown) {
      return res
        .status(400)
        .json({ error: 'No markdown content provided. Include "markdown" field in JSON body' });
    }
    if (!filePath) {
      return res.status(400).json({ error: 'path is required. Include "path" field in JSON body' });
    }

    // ✅ use filePath (not the Node "path" module)
    const resolved = resolveFsPathFromApiPath(filePath);
    if (!resolved) {
      return res
        .status(400)
        .json({ error: 'Invalid path provided. Ensure the "path" field contains a valid value' });
    }

    const { prepared, fsPath } = resolved;

    // Ensure the directory exists before writing the file
    await fs.mkdir(path.dirname(fsPath), { recursive: true });

    // Write markdown content to file
    await fs.writeFile(fsPath, markdown, 'utf8');
    console.log(`Markdown file saved: ${fsPath}`);

    res.status(201).json({
      message: 'Markdown file created successfully',
      filename: prepared.normalizedPath, // echo back the normalized API path
      fullPath: fsPath
    });
  } catch (error) {
    console.error('Error saving markdown file:', error);
    res.status(500).json({
      error: 'Failed to save markdown file',
      details: error.message
    });
  }
});

app.get('/markdown', async (req, res) => {
  try {
    const rawPath = Array.isArray(req.query.path) ? req.query.path[0] : req.query.path;

    // Default to volume root if no path specified
    let targetPath, preparedPath;
    if (rawPath) {
      const resolved = resolveFsPathFromApiPath(rawPath);
      if (!resolved) {
        return res.status(400).json({ error: 'Invalid path' });
      }
      ({ prepared: preparedPath, fsPath: targetPath } = resolved);
    } else {
      targetPath = path.resolve(VOLUME_PATH);
    }

    let stats;
    try {
      stats = await fs.stat(targetPath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res
          .status(404)
          .json({
            error: 'Path not found',
            details: 'The requested file or directory does not exist'
          });
      }
      throw error;
    }

    if (stats.isDirectory()) {
      const tree = await buildFileTree(targetPath, '');
      return res.json(tree);
    }

    const markdown = await fs.readFile(targetPath, 'utf8');
    const apiPath = preparedPath
      ? toApiPath(preparedPath.normalizedPath.replace(new RegExp(`^/${ROOT_NAME}/?`), ''))
      : toApiPath('');
    return res.json({
      path: apiPath,
      name: path.basename(targetPath),
      markdown
    });
  } catch (error) {
    console.error('Error fetching markdown:', error);
    res.status(500).json({ error: 'Failed to fetch markdown content', details: error.message });
  }
});

// GET route to fetch markdown file content specifically
app.get('/markdown/content', async (req, res) => {
  try {
    const rawPath = Array.isArray(req.query.path) ? req.query.path[0] : req.query.path;

    if (!rawPath) {
      return res.status(400).json({ error: 'Path parameter is required' });
    }

    const resolved = resolveFsPathFromApiPath(rawPath);
    if (!resolved) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const { prepared: preparedPath, fsPath: targetPath } = resolved;

    let stats;
    try {
      stats = await fs.stat(targetPath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res
          .status(404)
          .json({ error: 'File not found', details: 'The requested file does not exist' });
      }
      throw error;
    }

    if (stats.isDirectory()) {
      return res.status(400).json({ error: 'Path points to a directory, not a file' });
    }

    const content = await fs.readFile(targetPath, 'utf8');
    const apiPath = preparedPath
      ? toApiPath(preparedPath.normalizedPath.replace(new RegExp(`^/${ROOT_NAME}/?`), ''))
      : toApiPath('');

    return res.json({
      path: apiPath,
      name: path.basename(targetPath),
      content,
      size: stats.size,
      lastModified: stats.mtime.toISOString()
    });
  } catch (error) {
    console.error('Error fetching markdown content:', error);
    res.status(500).json({ error: 'Failed to fetch markdown content', details: error.message });
  }
});

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Data directory: ${VOLUME_PATH}`);
});
