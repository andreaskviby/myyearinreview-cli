# MyYearInReview CLI

Generate your Year in Review from Git commits.

## Installation

```bash
npm install -g myyearinreview
```

Or run directly with npx:

```bash
npx myyearinreview --key=YOUR_KEY
```

## Usage

1. Get your upload key from [myyearinreview.dev/dashboard](https://myyearinreview.dev/dashboard)

2. Navigate to your projects directory:
   ```bash
   cd ~/projects
   ```

3. Run the CLI:
   ```bash
   npx myyearinreview --key=usr_yourkey123
   ```

4. Select which repositories to include

5. Review and upload your data

6. Visit the preview URL to see your Year in Review!

## Options

| Option | Description |
|--------|-------------|
| `-k, --key <key>` | Your upload key |
| `-y, --year <year>` | Year to analyze (default: previous year) |
| `-d, --dir <dir>` | Directory to scan (default: current) |
| `-e, --email <email>` | Filter by author email |
| `--depth <n>` | How deep to scan for repos (default: 2) |

## Examples

Analyze 2024 commits:
```bash
npx myyearinreview --key=usr_xxx --year=2024
```

Scan a specific directory:
```bash
npx myyearinreview --key=usr_xxx --dir=~/code
```

Use a specific email:
```bash
npx myyearinreview --key=usr_xxx --email=me@example.com
```

## Privacy

- All analysis happens locally on your machine
- Only aggregated statistics are uploaded
- Your code never leaves your computer
- You control which repos to include
