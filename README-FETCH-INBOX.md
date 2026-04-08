# Fetch Inbox CLI Command

The `fetch-inbox` command pulls messages from the Stalwart mail server inbox and classifies them using the message processing pipeline.

## Usage

```bash
./bin/cli fetch-inbox [options]
```

## Options

- `--user <username>` - JMAP username (default: `STALWART_USERNAME` env or "dibora")
- `--password <password>` - JMAP app password (default: `STALWART_APP_PASSWORD` env)
- `--process-all` - Fetch all available messages (default when no filter provided)
- `--since <date>` - Fetch messages received after date (ISO 8601 format)
- `--message-id <id>` - Fetch one specific message (JMAP ID or Message-ID header)
- `--dry-run` - Preview converted messages without processing/storage
- `--move-to-folders` - Automatically move messages to classified folders in Stalwart using JMAP

## Environment Variables

Required:
- `SUPABASE_URL` - Supabase database URL
- `SUPABASE_KEY` - Supabase API key
- `STALWART_APP_PASSWORD` - App password for JMAP authentication

Optional:
- `STALWART_USERNAME` - JMAP username (default: "dibora")
- `STALWART_JMAP_ENDPOINT` - JMAP endpoint URL (default: "https://mail.circulardemocracy.org/.well-known/jmap")

## Examples

### Fetch all messages
```bash
./bin/cli fetch-inbox --process-all
```

### Fetch messages since a specific date
```bash
./bin/cli fetch-inbox --since "2024-03-01"
```

### Fetch a specific message
```bash
./bin/cli fetch-inbox --message-id "abc123"
```

### Dry run to preview messages
```bash
./bin/cli fetch-inbox --dry-run --since "2024-03-01"
```

### With custom credentials
```bash
./bin/cli fetch-inbox --user myuser --password mypass --process-all
```

### Move messages to classified folders
```bash
./bin/cli fetch-inbox --since "2024-03-01" --move-to-folders
```

This will automatically organize messages in Stalwart into folders like:
- `CampaignName/inbox` - Messages classified to a specific campaign
- `Uncategorized/inbox` - Messages that couldn't be classified

## How It Works

1. **Connects to Stalwart** - Uses JMAP protocol to connect to the Stalwart mail server
2. **Fetches Messages** - Retrieves messages based on the specified filters
3. **Converts Format** - Converts JMAP email format to internal MessageInput format
4. **Classifies Messages** - Uses AI embeddings to classify messages into campaigns
5. **Stores Metadata** - Saves message metadata (no PII) to the database
6. **Moves to Folders** (if `--move-to-folders` enabled) - Automatically organizes messages in Stalwart:
   - Creates campaign-specific folders if they don't exist
   - Moves messages to appropriate subfolders based on classification
   - Caches folder IDs to optimize performance

## Message Processing

Each message is:
- Assigned to a politician based on recipient email
- Classified into a campaign using semantic similarity
- Checked for duplicates
- Stored with metadata only (sender hash, not actual email)
- Assigned a confidence score for the classification

## Folder Structure

When using `--move-to-folders`, messages are organized into the following structure:

```
├── CampaignName1/
│   └── inbox/          # All messages for Campaign 1
├── CampaignName2/
│   └── inbox/          # All messages for Campaign 2
├── adidas/
│   └── inbox/          # Example campaign folder
├── ramatex/
│   └── inbox/          # Example campaign folder
└── Uncategorized/
    └── inbox/          # Messages that couldn't be classified
```

The folder names are automatically sanitized (special characters removed, spaces converted to hyphens).

## Output

The command provides a summary showing:
- Number of messages processed
- Number of duplicates found
- Number of messages where politician was not found
- Number of failed messages
- Number of messages moved to folders (if `--move-to-folders` enabled)
- Campaign classification for each message
