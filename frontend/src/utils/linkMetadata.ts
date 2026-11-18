import { workspaceUrl } from './workspaceApi';
import { parseTimer } from './parseTiming';

export interface LinkMetadata { title?: string; description?: string; author?: string; favicon?: string; image?: string }

// One request returns text as soon as it is ready, followed by the existing cover.
export async function fetchLinkMetadata(url: string, onMetadata: (value: LinkMetadata) => void): Promise<LinkMetadata> {
  const finish = parseTimer('web_metadata');
  let published = false;
  const publish = (value: LinkMetadata) => {
    if (!published) { published = true; finish(); }
    onMetadata(value);
  };
  try {
    const response = await fetch(workspaceUrl(`/api/fetch-metadata?url=${encodeURIComponent(url)}&stream=true`), {
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // Existing backends and controlled test fixtures can still return JSON.
    if (!response.headers?.get('content-type')?.includes('application/x-ndjson') || !response.body) {
      const metadata = await response.json();
      publish(metadata);
      return metadata;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let completed: LinkMetadata | undefined;
    const consume = (line: string) => {
      if (!line.trim()) return;
      const message = JSON.parse(line);
      if (message.type === 'error') throw new Error('Metadata parsing failed');
      if (!message.metadata || typeof message.metadata !== 'object' || Array.isArray(message.metadata)) {
        throw new Error('Invalid metadata message');
      }
      if (message.type === 'metadata') publish(message.metadata);
      else if (message.type === 'complete') { publish(message.metadata); completed = message.metadata; }
    };
    try {
      while (completed === undefined) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        if (pending.length > 1_000_000) throw new Error('Metadata message too large');
        let newline: number;
        while ((newline = pending.indexOf('\n')) >= 0) {
          consume(pending.slice(0, newline));
          pending = pending.slice(newline + 1);
          if (completed !== undefined) break;
        }
        if (done) { if (pending.trim()) consume(pending); break; }
      }
      if (completed === undefined) throw new Error('Metadata stream ended before completion');
      return completed;
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } finally {
    if (!published) finish();
  }
}
