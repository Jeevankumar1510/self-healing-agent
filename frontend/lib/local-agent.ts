const LOCAL_AGENT_ORIGIN = "http://127.0.0.1:8000";

export function localAgentUrl(path: string): string {
  return `${LOCAL_AGENT_ORIGIN}/api/${path.replace(/^\/+/, "")}`;
}

export function localAgentError(error: unknown): string {
  if (error instanceof TypeError) {
    return "Could not connect to this PC's local agent. Start the Python API on the same PC where this page is open, and allow local-network access if your browser asks.";
  }
  return error instanceof Error ? error.message : "The local agent request failed.";
}
