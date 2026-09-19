# Architecture

## Components

The system has four layers:

1. **VS Code** hosts the user interface and workspace.
2. **Kilo Code** supplies the agent runtime, tools, permissions, provider routing, task delegation, and shared workspace.
3. **Engineering leads and specialists** encode responsibility boundaries in Markdown agent definitions.
4. **The optional local bridge** exposes authenticated Claude CLI profiles to Kilo through MCP.

```mermaid
flowchart TB
    subgraph Editor[VS Code]
      UI[Kilo Code UI]
      WS[Workspace]
    end
    subgraph Native[Kilo native runtime]
      CFG[kilo.jsonc]
      LEAD[Astra or Fable lead]
      DS[DeepSeek workers]
      GLM[GLM investigator]
      LUNA[Luna utility]
    end
    subgraph Local[Local CLI boundary]
      MCP[Node MCP bridge]
      CLI[Claude CLI]
    end
    UI --> CFG --> LEAD
    LEAD --> DS
    LEAD --> GLM
    LEAD --> LUNA
    LEAD --> MCP --> CLI
    LEAD <--> WS
    DS <--> WS
    CLI <--> WS
```

## Native agents versus the local CLI

Astra, Fable, DeepSeek, GLM, and Luna run as Kilo agents. They can participate in Kilo's native task hierarchy and shared-agent workflow.

The Claude CLI bridge is different. Kilo starts a small local MCP server, which launches an already authenticated Claude executable for a complete bounded task. That process can edit the same workspace, but it does not participate in Kilo's native shared board. The lead must inspect its result and resulting diff.

## Configuration boundaries

- `kilo.jsonc` selects default models, the default lead, delegation depth, display preferences, and MCP servers.
- `agent/*.md` defines model selection, permissions, step budgets, role prompts, and delegation rules.
- The bridge defines local CLI profiles and translates MCP calls into CLI invocations.
- Provider credentials live outside the repository in the keychain, Kilo auth storage, or official CLI authentication storage.

## Why the lead is the final owner

Delegation is useful for context isolation and parallel work, but it creates integration risk. Keeping one lead accountable prevents workers from independently declaring the overall task complete. The lead inspects changes, resolves cross-workstream inconsistencies, chooses final checks, and reports remaining limitations.
