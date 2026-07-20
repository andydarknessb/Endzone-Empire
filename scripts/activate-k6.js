'use strict';

const { spawn } = require('node:child_process');

const INSTALLER = 'C:/Users/Cory/Endzone-Empire/install-k6.ps1';
const POWERSHELL_ARGS = [
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
  INSTALLER,
];

function streamChildOutput(child) {
  child.stdout?.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr?.on('data', (chunk) => process.stderr.write(chunk));
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(command, args, {
      windowsHide: false,
      stdio: ['inherit', 'pipe', 'pipe'],
      ...options,
    });

    streamChildOutput(child);
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      resolve({ code, signal });
    });
  });
}

async function activateK6() {
  console.log(`Starting PowerShell installer: ${INSTALLER}`);
  const installerResult = await runProcess('powershell.exe', POWERSHELL_ARGS);
  if (installerResult.code !== 0) {
    const reason = installerResult.signal
      ? `terminated by ${installerResult.signal}`
      : `exited with code ${installerResult.code}`;
    throw new Error(`k6 installer failed: ${reason}`);
  }

  console.log('Installer exited cleanly. Verifying k6 version...');
  const verification = await runProcess('k6', ['version']);
  if (verification.code !== 0) {
    const reason = verification.signal
      ? `terminated by ${verification.signal}`
      : `exited with code ${verification.code}`;
    throw new Error(`k6 version verification failed: ${reason}`);
  }

  console.log('');
  console.log('STATUS: K6 Binary successfully activated. System PATH is refreshed. Pipeline fail-closed gates are now OPEN.');
}

activateK6().catch((error) => {
  console.error(`ERROR: Unable to activate k6. ${error.message}`);
  process.exitCode = 1;
});
