#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
import ora from 'ora';
import { program } from 'commander';
import inquirer from 'inquirer';

const API_URL = 'https://myyearinreview.dev/api/year-review/upload';
const CONFIG_DIR = join(homedir(), '.myyearinreview');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

program
  .name('myyearinreview')
  .description('Generate your Year in Review from Git commits')
  .version('1.0.0')
  .option('-k, --key <key>', 'Your upload key from myyearinreview.dev')
  .option('-y, --year <year>', 'Year to analyze (default: previous year)', String(new Date().getFullYear() - 1))
  .option('-d, --dir <directory>', 'Directory to scan for git repos (default: current)', '.')
  .option('-e, --email <email>', 'Filter commits by author email')
  .option('--depth <depth>', 'How deep to scan for repos (default: 2)', '2')
  .parse();

const options = program.opts();

async function main() {
  console.log(chalk.bold.green('\n  MyYearInReview CLI\n'));
  console.log(chalk.gray('  Generate your Year in Review from Git commits\n'));

  let uploadKey = options.key || loadSavedKey();

  if (!uploadKey) {
    console.log(chalk.yellow('  No upload key found.\n'));
    console.log(chalk.white('  Get your key at: ') + chalk.cyan('https://myyearinreview.dev/dashboard\n'));

    const { key } = await inquirer.prompt([{
      type: 'input',
      name: 'key',
      message: 'Enter your upload key:',
      validate: (input) => input.startsWith('usr_') ? true : 'Key should start with usr_'
    }]);

    uploadKey = key;
    saveKey(uploadKey);
    console.log(chalk.green('\n  Key saved for future use.\n'));
  }

  const year = parseInt(options.year);
  const scanDir = options.dir;
  const maxDepth = parseInt(options.depth);

  console.log(chalk.white(`  Scanning for Git repos in: ${chalk.cyan(scanDir)}`));
  console.log(chalk.white(`  Year: ${chalk.cyan(year)}\n`));

  const spinner = ora('Finding Git repositories...').start();

  const repos = findGitRepos(scanDir, maxDepth);

  if (repos.length === 0) {
    spinner.fail('No Git repositories found');
    process.exit(1);
  }

  spinner.succeed(`Found ${repos.length} Git repositories`);

  // Get author email
  let authorEmail = options.email;
  if (!authorEmail) {
    try {
      authorEmail = execSync('git config user.email', { encoding: 'utf-8' }).trim();
    } catch {
      const { email } = await inquirer.prompt([{
        type: 'input',
        name: 'email',
        message: 'Enter your Git author email:',
        validate: (input) => input.includes('@') ? true : 'Please enter a valid email'
      }]);
      authorEmail = email;
    }
  }

  console.log(chalk.white(`\n  Filtering commits by: ${chalk.cyan(authorEmail)}\n`));

  // Let user select repos
  const { selectedRepos } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'selectedRepos',
    message: 'Select repositories to include:',
    choices: repos.map(r => ({ name: basename(r), value: r, checked: true })),
    validate: (input) => input.length > 0 ? true : 'Select at least one repository'
  }]);

  console.log('');
  const analyzeSpinner = ora('Analyzing commits...').start();

  const data = analyzeRepos(selectedRepos, year, authorEmail);

  analyzeSpinner.succeed(`Analyzed ${data.total_commits} commits across ${selectedRepos.length} repositories`);

  // Show summary
  console.log(chalk.white('\n  ') + chalk.bold('Summary:'));
  console.log(chalk.gray('  ─────────────────────────────'));
  console.log(chalk.white(`  Total commits:    ${chalk.green(data.total_commits.toLocaleString())}`));
  console.log(chalk.white(`  Lines added:      ${chalk.green('+' + data.total_additions.toLocaleString())}`));
  console.log(chalk.white(`  Lines deleted:    ${chalk.red('-' + data.total_deletions.toLocaleString())}`));
  console.log(chalk.white(`  Repositories:     ${chalk.cyan(data.repositories.length)}`));
  console.log(chalk.gray('  ─────────────────────────────\n'));

  if (data.total_commits === 0) {
    console.log(chalk.yellow('  No commits found for the specified year and author.\n'));
    process.exit(0);
  }

  const { confirmUpload } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirmUpload',
    message: 'Upload data and generate your Year in Review?',
    default: true
  }]);

  if (!confirmUpload) {
    console.log(chalk.yellow('\n  Upload cancelled.\n'));
    process.exit(0);
  }

  const uploadSpinner = ora('Uploading data...').start();

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: uploadKey,
        year: year,
        data: data
      })
    });

    const result = await response.json();

    if (result.success) {
      uploadSpinner.succeed('Upload complete!');
      console.log(chalk.green('\n  Your Year in Review is ready!\n'));
      console.log(chalk.white('  Preview at: ') + chalk.cyan(result.preview_url));
      console.log(chalk.gray('\n  Visit the link to preview and publish your review.\n'));
    } else {
      uploadSpinner.fail('Upload failed');
      console.log(chalk.red(`\n  Error: ${result.error}\n`));
      process.exit(1);
    }
  } catch (error) {
    uploadSpinner.fail('Upload failed');
    console.log(chalk.red(`\n  Error: ${error.message}\n`));
    process.exit(1);
  }
}

function findGitRepos(dir, maxDepth, currentDepth = 0) {
  const repos = [];

  if (currentDepth > maxDepth) return repos;

  try {
    const fullPath = join(process.cwd(), dir);

    if (existsSync(join(fullPath, '.git'))) {
      repos.push(fullPath);
    }

    if (currentDepth < maxDepth) {
      const entries = readdirSync(fullPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          repos.push(...findGitRepos(join(dir, entry.name), maxDepth, currentDepth + 1));
        }
      }
    }
  } catch (err) {
    // Skip directories we can't access
  }

  return repos;
}

function analyzeRepos(repos, year, authorEmail) {
  const allCommits = [];
  const repositories = [];
  const hourlyDistribution = new Array(24).fill(0);
  const dailyDistribution = new Array(7).fill(0);
  const fileTypes = {};

  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const repoPath of repos) {
    try {
      const repoName = basename(repoPath);
      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;

      // Get commits with stats
      const logFormat = '%H|%aI|%s|%ae';
      const gitLog = execSync(
        `git -C "${repoPath}" log --author="${authorEmail}" --since="${startDate}" --until="${endDate}" --format="${logFormat}" --shortstat 2>/dev/null`,
        { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
      );

      const lines = gitLog.split('\n');
      let repoCommits = 0;
      let repoAdditions = 0;
      let repoDeletions = 0;
      let currentCommit = null;

      for (const line of lines) {
        if (line.includes('|')) {
          const [hash, date, message, email] = line.split('|');
          if (email && email.toLowerCase() === authorEmail.toLowerCase()) {
            currentCommit = { hash, date, message, repo: repoName, additions: 0, deletions: 0 };

            const commitDate = new Date(date);
            hourlyDistribution[commitDate.getHours()]++;
            dailyDistribution[commitDate.getDay()]++;
          }
        } else if (line.includes('insertion') || line.includes('deletion')) {
          if (currentCommit) {
            const insertMatch = line.match(/(\d+) insertion/);
            const deleteMatch = line.match(/(\d+) deletion/);

            if (insertMatch) {
              currentCommit.additions = parseInt(insertMatch[1]);
              repoAdditions += currentCommit.additions;
            }
            if (deleteMatch) {
              currentCommit.deletions = parseInt(deleteMatch[1]);
              repoDeletions += currentCommit.deletions;
            }

            allCommits.push(currentCommit);
            repoCommits++;
            currentCommit = null;
          }
        } else if (currentCommit && line.trim() === '') {
          // Commit without stats
          allCommits.push(currentCommit);
          repoCommits++;
          currentCommit = null;
        }
      }

      // Get file types
      try {
        const files = execSync(
          `git -C "${repoPath}" log --author="${authorEmail}" --since="${startDate}" --until="${endDate}" --name-only --format="" 2>/dev/null`,
          { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
        );

        for (const file of files.split('\n')) {
          if (file.trim()) {
            const ext = file.split('.').pop()?.toLowerCase() || 'other';
            fileTypes[ext] = (fileTypes[ext] || 0) + 1;
          }
        }
      } catch {}

      if (repoCommits > 0) {
        repositories.push({
          name: repoName,
          commits: repoCommits,
          additions: repoAdditions,
          deletions: repoDeletions
        });

        totalAdditions += repoAdditions;
        totalDeletions += repoDeletions;
      }
    } catch (err) {
      // Skip repos with errors
    }
  }

  // Get author name from git config
  let authorName = 'Developer';
  try {
    authorName = execSync('git config user.name', { encoding: 'utf-8' }).trim();
  } catch {}

  return {
    total_commits: allCommits.length,
    total_additions: totalAdditions,
    total_deletions: totalDeletions,
    repositories: repositories.sort((a, b) => b.commits - a.commits),
    commits: allCommits.slice(0, 1000), // Limit to 1000 most recent
    hourly_distribution: hourlyDistribution,
    daily_distribution: dailyDistribution,
    file_types: fileTypes,
    author_email: authorEmail,
    author_name: authorName
  };
}

function loadSavedKey() {
  try {
    if (existsSync(CONFIG_FILE)) {
      const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
      return config.uploadKey;
    }
  } catch {}
  return null;
}

function saveKey(key) {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(CONFIG_FILE, JSON.stringify({ uploadKey: key }, null, 2));
  } catch {}
}

main().catch(console.error);
