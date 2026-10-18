# Mandatory Kilo patch installation

Never apply a patch directly to an installed extension or edit its bundles in place.
Use `node ~/.config/kilo/patches/safe-kilo-patches.mjs patch <patch.mjs> <installed-dist-targets...>`
for an individual patch, or the normal `reapply-kilo-patches.sh` for the managed batch.
Both routes stage changes, require JavaScript syntax checks, real offline rendering
of both chat bundles, successful patch checks, and idempotence before installation.
If any check fails, fix the source patch and rerun the gate; do not bypass it.

Add a focused runnable regression check for changed behavior. A rendering smoke
check proves initialization only, not every interaction or tool/provider workflow.
Do not reload VS Code while work is running. Preserve chat state and verify after
any explicitly requested reload. Keep these rules with future patch additions.
