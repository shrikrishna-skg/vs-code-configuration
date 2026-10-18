#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
export const before = 'let target5=ctx.getPermissionSession?.(permissionId)??sessionID,dir3=ctx.getPermissionDirectory(permissionId)??(target5?ctx.getWorkspaceDirectory(target5):void 0),claimed=ctx.isPermissionResponseClaimed?.(permissionId)??!1;';
export const recovery = '/* permission-route-recovery:v1 */if(!ctx.getPermissionDirectory(permissionId)&&!ctx.isPermissionResponseClaimed?.(permissionId)){let route=await require(require("node:path").join(__dirname,"permission-route.cjs")).recoverPermissionRoute(ctx,permissionId,sessionID);if(route!=="ready"){ctx.postMessage({type:"permissionError",permissionID:permissionId,...route==="stale"?{stale:!0}:{}});return}}';

export function patch(source, restore = false) {
  if (source.split(before).length !== 2 || source.split(recovery).length > 2)
    throw Error('Unsupported or ambiguous permission response handler.');
  if (restore) return source.replace(recovery, '');
  return source.includes(recovery) ? source : source.replace(before, recovery + before);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [target, mode = '--apply', ...extra] = process.argv.slice(2);
  if (!target || extra.length || !['--apply', '--check', '--restore'].includes(mode))
    throw Error('Usage: permission-route.mjs <extension.js> [--apply|--check|--restore]');
  const source = fs.readFileSync(target, 'utf8'), next = patch(source, mode === '--restore');
  const helper = path.join(root, 'permission-route.cjs'), installed = path.join(path.dirname(target), 'permission-route.cjs');
  if (mode === '--check') {
    if (source !== next || !fs.existsSync(installed) || !fs.readFileSync(helper).equals(fs.readFileSync(installed)))
      throw Error('Permission route recovery missing or outdated.');
  } else if (mode === '--apply') {
    fs.copyFileSync(helper, installed);
  }
  if (mode !== '--check' && source !== next) {
    const temp = target + `.permission-route-${process.pid}.js`;
    try {
      fs.writeFileSync(temp, next, { flag: 'wx', mode: fs.statSync(target).mode & 0o777 });
      const check = spawnSync(process.execPath, ['--check', temp], { encoding: 'utf8' });
      if (check.status !== 0) throw Error(check.stderr);
      if (fs.readFileSync(target, 'utf8') !== source) throw Error('Bundle changed while patching.');
      if (!fs.existsSync(target + '.pre-permission-route')) fs.copyFileSync(target, target + '.pre-permission-route');
      fs.renameSync(temp, target);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  console.log('Permission route recovery ' + mode);
}
