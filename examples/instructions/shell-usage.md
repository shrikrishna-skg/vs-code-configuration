# Shell use in Kilo

Run commands that provide necessary evidence, make an authorized change or verify the result. Keep output focused; avoid decorative separators and repetitive no-op probes.

`echo`, `true` and `:` are not globally prohibited: use them when the command needs their shell semantics. Other tool, path and role permissions still apply. After a denial, report the actual limitation or use a permitted operation for a different purpose; never bypass the denied operation through another tool.
