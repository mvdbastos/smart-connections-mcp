# Quick Start Guide

## Step 1: Verify Installation

The MCP server has been built successfully! Check that these files exist:

```bash
ls ~/smart-connections-mcp/dist/
```

You should see `index.js` and other compiled files.

## Step 2: Configure Claude Desktop

1. Open your Claude Desktop configuration file:
   ```bash
   open ~/Library/Application\ Support/Claude/claude_desktop_config.json
   ```

2. Add the Smart Connections server configuration. If the file is empty or only has `{}`, replace it with:

   ```json
   {
     "mcpServers": {
       "smart-connections": {
         "command": "node",
         "args": [
           "/ABSOLUTE/PATH/TO/smart-connections-mcp/dist/index.js"
         ],
         "env": {
           "SMART_VAULT_PATH": "/ABSOLUTE/PATH/TO/YOUR/OBSIDIAN/VAULT"
         }
       }
     }
   }
   ```

   **Replace the paths with your actual paths:**
   - First path: Where you cloned/installed this repository
   - Second path: Your Obsidian vault location

   If you already have other MCP servers configured, just add the `"smart-connections"` entry to your existing `mcpServers` object.

   **Note**: A sample configuration has been saved to `claude_desktop_config.json` in this directory.

   Codex CLI command to add the MCP server:

   ```bash
   codex mcp add obsidian-smart-connections --env SMART_VAULT_PATH=C:\\obsidian\\mb-kb -- node C:\\obsidian\\smart-connections-mcp\\dist\\index.js
   ```

## Step 3: Restart Claude Desktop

1. Quit Claude Desktop completely (Cmd+Q)
2. Reopen Claude Desktop
3. Look for the 🔌 icon in the interface (indicates MCP servers are connected)

## Step 4: Test the Connection

Try these prompts in Claude:

1. **Get stats about your knowledge base:**
   ```
   Use the Smart Connections server to show me statistics about my Obsidian vault
   ```

2. **Find similar notes:**
   ```
   Find notes similar to "YourNoteName.md"
   ```

3. **Search for content:**
   ```
   Search my Smart Connections for information about [your topic]
   ```

4. **Build a connection graph:**
   ```
   Show me a connection graph starting from [your note name]
   ```

## Troubleshooting

### Server not showing up?

1. Check Claude Desktop logs (if available in the app)
2. Verify the configuration file is valid JSON (no trailing commas, proper quotes)
3. Make sure the paths are absolute and correct
4. Try running the test manually:
   ```bash
   cd ~/smart-connections-mcp
   ./test-server.sh
   ```
   You should see:
   ```
   Loading [N] source files...
   Loaded [N] sources successfully
   Smart Connections MCP Server initialized successfully
   ```
   Press Ctrl+C to stop.

### "Smart Connections directory not found"

Make sure your Obsidian vault has:
- Smart Connections plugin installed
- Embeddings generated (check `.smart-env/multi/` directory exists and has files)

### Need help?

Check the full `README.md` for detailed documentation and troubleshooting steps.

## What's Next?

Once connected, Claude can:
- 🔍 Search your Obsidian documents semantically
- 🕸️ Discover hidden connections between notes
- 📊 Analyze your knowledge graph
- 📝 Read and extract specific sections from notes
- 💡 Answer questions using your entire knowledge base

All of this happens **locally** using the embeddings already stored in your vault!
