'use strict';

// The UI can outlive a request or the connection's in-memory route cache.
// Recover only from the backend, and never approve a different session's request.
async function recoverPermissionRoute(ctx, requestID, sessionID) {
  if (!requestID || !sessionID || !ctx.client) return 'error';
  const directories = [...new Set([
    ctx.getWorkspaceDirectory(sessionID),
    ...ctx.sessionDirectories.values(),
    ...(ctx.extraDirectories?.() ?? []),
  ].filter(Boolean))];
  let failed = directories.length === 0;
  for (const directory of directories) {
    try {
      const result = await ctx.client.permission.list({ directory }, {
        throwOnError: true, signal: AbortSignal.timeout(5000),
      });
      if (result.error || !Array.isArray(result.data)) { failed = true; continue; }
      const request = result.data.find(item => item.id === requestID);
      if (!request) continue;
      if (request.sessionID !== sessionID) return 'error';
      ctx.recordPermissionDirectory(requestID, directory, sessionID);
      return 'ready';
    } catch { failed = true; }
  }
  return failed ? 'error' : 'stale';
}

module.exports = { recoverPermissionRoute };
