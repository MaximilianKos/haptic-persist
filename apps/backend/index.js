const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { corsMiddleware } = require('./config/cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

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

// WebSocket connection handling
const clients = new Set();

wss.on('connection', (ws) => {
  console.log('New WebSocket client connected');
  clients.add(ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'subscribe' && data.collection) {
        ws.collection = data.collection;
        console.log(`Client subscribed to collection: ${data.collection}`);
      }
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });
});

// Function to broadcast file system changes
const broadcastChange = (collection, changeType, path) => {
  const message = JSON.stringify({
    type: 'file_change',
    collection,
    changeType, // 'created', 'updated', 'deleted'
    path,
    timestamp: new Date().toISOString()
  });

  console.log(`Broadcasting message: ${message}`);

  console.log(`Broadcasting to ${clients.size} clients`);

  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      console.log(`Broadcasted change to client: ${message}`);
    }
  });
};

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

    // Check if file already exists to determine if this is create or update
    let isUpdate = false;
    try {
      await fs.stat(fsPath);
      isUpdate = true;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // File doesn't exist, this is a create operation
    }

    // Ensure the directory exists before writing the file
    await fs.mkdir(path.dirname(fsPath), { recursive: true });

    // Write markdown content to file
    await fs.writeFile(fsPath, markdown, 'utf8');
    console.log(`Markdown file ${isUpdate ? 'updated' : 'created'}: ${fsPath}`);

    // Broadcast the file change to WebSocket clients
    broadcastChange(ROOT_NAME, isUpdate ? 'updated' : 'created', prepared.normalizedPath);

    res.status(isUpdate ? 200 : 201).json({
      message: `Markdown file ${isUpdate ? 'updated' : 'created'} successfully`,
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

// PUT route to handle markdown content updates
app.put('/markdown', async (req, res) => {
  try {
    if (!req.is('application/json')) {
      return res.status(400).json({ error: 'Invalid content type. Expected application/json' });
    }

    const { path: filePath, markdown } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: 'path is required. Include "path" field in JSON body' });
    }

    const resolved = resolveFsPathFromApiPath(filePath);
    if (!resolved) {
      return res
        .status(400)
        .json({ error: 'Invalid path provided. Ensure the "path" field contains a valid value' });
    }

    const { prepared, fsPath } = resolved;

    // Check if file exists
    try {
      await fs.stat(fsPath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ error: 'File not found' });
      }
      throw error;
    }

    // Write updated markdown content to file
    await fs.writeFile(fsPath, markdown, 'utf8');
    console.log(`Markdown file updated: ${fsPath}`);

    // Broadcast the file update to WebSocket clients
    broadcastChange(ROOT_NAME, 'updated', prepared.normalizedPath);

    res.status(200).json({
      message: 'Markdown file updated successfully',
      filename: prepared.normalizedPath,
      fullPath: fsPath
    });
  } catch (error) {
    console.error('Error updating markdown file:', error);
    res.status(500).json({
      error: 'Failed to update markdown file',
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
        return res.status(404).json({
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
      modifiedAt: stats.mtime.toISOString(),
      createdAt: stats.ctime.toISOString()
    });
  } catch (error) {
    console.error('Error fetching markdown content:', error);
    res.status(500).json({ error: 'Failed to fetch markdown content', details: error.message });
  }
});

app.get('/markdown/names', async (req, res) => {
  try {
    const rawPath = Array.isArray(req.query.path) ? req.query.path[0] : req.query.path;

    // Default to volume root if no path specified
    let targetPath;
    if (rawPath) {
      const resolved = resolveFsPathFromApiPath(rawPath);
      if (!resolved) {
        return res.status(400).json({ error: 'Invalid path' });
      }
      targetPath = resolved.fsPath;
    } else {
      targetPath = path.resolve(VOLUME_PATH);
    }

    let stats;
    try {
      stats = await fs.stat(targetPath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({
          error: 'Path not found',
          details: 'The requested directory does not exist'
        });
      }
      throw error;
    }

    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Path must point to a directory' });
    }

    const dirEntries = await fs.readdir(targetPath, { withFileTypes: true });
    const sortedEntries = dirEntries
      .filter((entry) => !entry.name.startsWith('.')) // Skip hidden files/folders
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    const names = sortedEntries.map((entry) => ({ name: entry.name }));

    return res.json(names);
  } catch (error) {
    console.error('Error fetching file/folder names:', error);
    res.status(500).json({ error: 'Failed to fetch names', details: error.message });
  }
});

app.post('/markdown/folder', async (req, res) => {
  try {
    if (!req.is('application/json')) {
      return res.status(400).json({ error: 'Invalid content type. Expected application/json' });
    }

    const { path: folderPath } = req.body;

    if (!folderPath) {
      return res.status(400).json({ error: 'path is required. Include "path" field in JSON body' });
    }

    const resolved = resolveFsPathFromApiPath(folderPath);
    if (!resolved) {
      return res.status(400).json({
        error: 'Invalid path provided. Ensure the "path" field contains a valid value'
      });
    }

    const { prepared, fsPath } = resolved;

    // Check if the directory already exists
    try {
      const stats = await fs.stat(fsPath);
      if (stats.isDirectory()) {
        return res.status(409).json({
          error: 'Directory already exists',
          path: prepared.normalizedPath
        });
      } else {
        return res.status(409).json({
          error: 'A file with the same name already exists',
          path: prepared.normalizedPath
        });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // Directory doesn't exist, which is what we want
    }

    // Create the directory (and any parent directories if needed)
    await fs.mkdir(fsPath, { recursive: true });
    console.log(`Directory created: ${fsPath}`);

    // Broadcast the folder creation to WebSocket clients
    broadcastChange(ROOT_NAME, 'created', prepared.normalizedPath);

    res.status(201).json({
      message: 'Directory created successfully',
      path: prepared.normalizedPath,
      fullPath: fsPath
    });
  } catch (error) {
    console.error('Error creating directory:', error);
    res.status(500).json({
      error: 'Failed to create directory',
      details: error.message
    });
  }
});

// DELETE route to delete files or directories
app.delete('/markdown', async (req, res) => {
  try {
    const rawPath = Array.isArray(req.query.path) ? req.query.path[0] : req.query.path;
    const recursive = req.query.recursive === 'true';

    if (!rawPath) {
      return res.status(400).json({ error: 'Path parameter is required' });
    }

    const resolved = resolveFsPathFromApiPath(rawPath);
    if (!resolved) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const { prepared: preparedPath, fsPath: targetPath } = resolved;

    // Check if the path exists
    let stats;
    try {
      stats = await fs.stat(targetPath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({
          error: 'Path not found',
          details: 'The requested file or directory does not exist'
        });
      }
      throw error;
    }

    // Prevent deletion of the root volume directory
    const volResolved = path.resolve(VOLUME_PATH);
    if (targetPath === volResolved) {
      return res.status(403).json({
        error: 'Cannot delete root directory',
        details: 'Deletion of the root volume directory is not allowed'
      });
    }

    if (stats.isDirectory()) {
      if (!recursive) {
        // Check if directory is empty
        try {
          const dirEntries = await fs.readdir(targetPath);
          if (dirEntries.length > 0) {
            return res.status(400).json({
              error: 'Directory not empty',
              details: 'Use recursive=true to delete non-empty directories'
            });
          }
        } catch (error) {
          throw error;
        }
      }

      // Delete directory (recursive if specified)
      await fs.rmdir(targetPath, { recursive });
      console.log(`Directory deleted: ${targetPath}`);

      // Broadcast the directory deletion to WebSocket clients
      broadcastChange(ROOT_NAME, 'deleted', preparedPath.normalizedPath);

      res.status(200).json({
        message: 'Directory deleted successfully',
        path: preparedPath.normalizedPath,
        type: 'directory',
        recursive
      });
    } else {
      // Delete file
      await fs.unlink(targetPath);
      console.log(`File deleted: ${targetPath}`);

      // Broadcast the file deletion to WebSocket clients
      broadcastChange(ROOT_NAME, 'deleted', preparedPath.normalizedPath);

      res.status(200).json({
        message: 'File deleted successfully',
        path: preparedPath.normalizedPath,
        name: path.basename(targetPath),
        type: 'file'
      });
    }
  } catch (error) {
    console.error('Error deleting item:', error);
    res.status(500).json({
      error: 'Failed to delete item',
      details: error.message
    });
  }
});

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server running on ws://localhost:${PORT}`);
  console.log(`Data directory: ${VOLUME_PATH}`);
});
