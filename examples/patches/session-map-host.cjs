'use strict';
// Extension-host side of the Session map: fetch one session's messages through the
// Kilo SDK client and group them with session-map.cjs. Copied into dist/ by session-map.mjs.
const { buildMap } = require('./session-map.cjs');

// ponytail: fetches the whole history in one call (no limit). Very long sessions cost
// one larger response; upgrade path is paging with the SDK's limit/before options.
async function load(client, message, directory) {
  const sessionID = typeof message?.sessionID === 'string' ? message.sessionID : '';
  if (!sessionID) throw Error('No chat is open.');
  const canned = Array.isArray(message.canned)
    ? message.canned.filter(s => typeof s === 'string' && s.length > 3).map(s => s.slice(0, 500)).slice(0, 100)
    : [];
  const history = await client.session.messages({ sessionID, directory }, { throwOnError: true });
  // root and home shorten file paths in the panel (project-relative, or ~/...).
  const map = buildMap(history?.data || [], { canned, root: typeof directory === 'string' ? directory : '', home: require('node:os').homedir() });
  // The panel header shows the chat's title; a missing title is not an error.
  const info = client.session.get ? await client.session.get({ sessionID, directory }).catch(() => null) : null;
  map.title = typeof info?.data?.title === 'string' ? info.data.title.slice(0, 200) : '';
  return map;
}

module.exports = { load };
