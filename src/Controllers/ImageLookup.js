const fs = require("fs");
const { logger } = require("../Logger");

class ImageLookup {
get(req, res) {
    try {
        // Define a whitelist of allowed directories for images
        const ALLOWED_IMAGE_DIR = path.join(__dirname, '../../public/images');
        
        // Validate that image parameter exists
        if (!req.query.image) {
            return res.status(400).json({ error: 'Image parameter is required' });
        }
        
        // Sanitize the input by removing any path traversal sequences
        const requestedFile = path.basename(req.query.image);
        
        // Validate file extension against whitelist
        const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
        const fileExtension = path.extname(requestedFile).toLowerCase();
        
        if (!allowedExtensions.includes(fileExtension)) {
            logger.warn(`Attempted access to non-image file: ${requestedFile}`);
            return res.status(403).json({ error: 'Invalid file type. Only image files are allowed.' });
        }
        
        // Construct the full file path
        const fullPath = path.join(ALLOWED_IMAGE_DIR, requestedFile);
        
        // Verify that the resolved path is within the allowed directory (prevent path traversal)
        const resolvedPath = path.resolve(fullPath);
        const resolvedBaseDir = path.resolve(ALLOWED_IMAGE_DIR);
        
        if (!resolvedPath.startsWith(resolvedBaseDir)) {
            logger.warn(`Path traversal attempt detected: ${req.query.image}`);
            return res.status(403).json({ error: 'Access denied' });
        }
        
        // Check if file exists before reading
        if (!fs.existsSync(resolvedPath)) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        // Verify it's a file and not a directory
        const stats = fs.statSync(resolvedPath);
        if (!stats.isFile()) {
            return res.status(403).json({ error: 'Invalid resource' });
        }
        
        // Read file with size limit to prevent memory exhaustion
        const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit
        if (stats.size > MAX_FILE_SIZE) {
            return res.status(413).json({ error: 'File too large' });
        }
        
        // Read and send the file content
        const fileContent = fs.readFileSync(resolvedPath);
        
        // Set appropriate content type based on extension
        const contentTypes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml'
        };
        
        res.setHeader('Content-Type', contentTypes[fileExtension] || 'application/octet-stream');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        
        logger.info(`Successfully served image: ${requestedFile}`);
        res.send(fileContent);
        
    } catch (error) {
        logger.error(`Error reading file: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
}

}

module.exports = ImageLookup;
