import { Octokit } from '@octokit/rest';
import * as fs from 'fs';
import * as path from 'path';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('GitHub not connected');
  }
  return accessToken;
}

async function getGitHubClient() {
  const accessToken = await getAccessToken();
  return new Octokit({ auth: accessToken });
}

async function uploadToGitHub() {
  console.log('Connecting to GitHub...');
  const octokit = await getGitHubClient();
  
  // Get authenticated user
  const { data: user } = await octokit.users.getAuthenticated();
  console.log(`Authenticated as: ${user.login}`);
  
  const repoName = 'coturn-docker-unraid';
  const repoDescription = 'Production-ready CoTURN TURN server Docker setup for Unraid and self-hosting. Optimized for WebRTC relay-only connections with complete IP privacy.';
  
  // Check if repo exists, if not create it
  let repo;
  try {
    const { data: existingRepo } = await octokit.repos.get({
      owner: user.login,
      repo: repoName,
    });
    repo = existingRepo;
    console.log(`Repository ${repoName} already exists`);
  } catch (error: any) {
    if (error.status === 404) {
      console.log(`Creating repository: ${repoName}`);
      const { data: newRepo } = await octokit.repos.createForAuthenticatedUser({
        name: repoName,
        description: repoDescription,
        private: false,
        auto_init: false,
      });
      repo = newRepo;
      console.log(`Repository created: ${repo.html_url}`);
    } else {
      throw error;
    }
  }
  
  // Files to upload from turn-server/
  const files = [
    'Dockerfile',
    'docker-compose.yml',
    'turnserver.conf',
    'README.md',
    '.dockerignore',
  ];
  
  const turnServerPath = path.join(process.cwd(), 'turn-server');
  
  // Upload each file
  for (const fileName of files) {
    const filePath = path.join(turnServerPath, fileName);
    
    if (!fs.existsSync(filePath)) {
      console.log(`Skipping ${fileName} - file not found`);
      continue;
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const base64Content = Buffer.from(content).toString('base64');
    
    try {
      // Check if file exists
      let sha: string | undefined;
      try {
        const { data: existingFile } = await octokit.repos.getContent({
          owner: user.login,
          repo: repoName,
          path: fileName,
        });
        if ('sha' in existingFile) {
          sha = existingFile.sha;
        }
      } catch (e) {
        // File doesn't exist, that's fine
      }
      
      await octokit.repos.createOrUpdateFileContents({
        owner: user.login,
        repo: repoName,
        path: fileName,
        message: sha ? `Update ${fileName}` : `Add ${fileName}`,
        content: base64Content,
        sha: sha,
      });
      
      console.log(`Uploaded: ${fileName}`);
    } catch (error: any) {
      console.error(`Error uploading ${fileName}:`, error.message);
    }
  }
  
  console.log(`\nDone! Repository URL: ${repo.html_url}`);
  return repo.html_url;
}

uploadToGitHub().catch(console.error);
