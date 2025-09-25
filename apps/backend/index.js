const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { corsMiddleware } = require('./config/cors');

const app = express();
const PORT = process.env.PORT || 3000;
const VOLUME_PATH = process.env.VOLUME_PATH || './data';

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

// POST route to handle markdown content
app.post('/markdown', async (req, res) => {
  try {
    // Only accept JSON requests
    if (!req.is('application/json')) {
      return res.status(400).json({
        error: 'Invalid content type. Expected application/json'
      });
    }

    // Get markdown content and path from JSON body
    const { path: filePath, markdown } = req.body;

    if (!markdown) {
      return res.status(400).json({
        error: 'No markdown content provided. Include "markdown" field in JSON body'
      });
    }

    if (!filePath) {
      return res.status(400).json({
        error: 'path is required. Include "path" field in JSON body'
      });
    }

    // Ensure path has .md extension
    const finalpath = filePath.endsWith('.md') ? filePath : filePath + '.md';

    // Sanitize path to prevent malicious directory traversal while allowing folders
    // Remove any absolute path references and parent directory traversals
    const sanitizedpath = finalpath
      .replace(/^[/\\]+/, '') // Remove leading slashes
      .replace(/\.\.[/\\]/g, '') // Remove parent directory references
      .replace(/[<>:"|?*]/g, '_'); // Replace invalid filename characters

    const filepath = path.join(VOLUME_PATH, sanitizedpath);

    // Ensure the directory exists before writing the file
    const dir = path.dirname(filepath);
    await fs.mkdir(dir, { recursive: true });

    // Write markdown content to file
    await fs.writeFile(filepath, markdown, 'utf8');

    console.log(`Markdown file saved: ${filepath}`);

    res.status(201).json({
      message: 'Markdown file created successfully',
      filename: sanitizedpath,
      fullPath: filepath
    });
  } catch (error) {
    console.error('Error saving markdown file:', error);
    res.status(500).json({
      error: 'Failed to save markdown file',
      details: error.message
    });
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
