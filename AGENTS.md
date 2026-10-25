# Repository conventions

## Commit attribution

Every commit must name both the agent and the model that produced it. End the
commit message with these two trailer lines:

```text
Agent: <agent name>
Model: <model name (model-id)>
```

Use the actual agent and model; do not omit either line. If the change was
produced by DeepSeek Harness with DeepSeek-V4.1-Flash, for example:

```text
Agent: DeepSeek Harness
Model: DeepSeek-V4.1-Flash (deepseek-flash)
```
